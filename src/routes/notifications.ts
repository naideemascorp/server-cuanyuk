import { prisma } from "@/lib/prisma";
import type { AuthUser } from "@/lib/types";
import { Elysia, t } from "elysia";

type NotificationImportance = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
type RenderedNotification = {
  id: string;
  title: string;
  description: string;
  importance: NotificationImportance;
  publish_at: Date;
};

const renderTemplate = (raw: string, vars: Record<string, string>) =>
  raw.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, keyRaw: string) => {
    const key = keyRaw.trim();
    return Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : "";
  });

export const notificationRoutes = new Elysia({ prefix: "/notifications" }).guard(
  {
    beforeHandle: async (ctx) => {
      const authUser = (ctx as unknown as { authUser: AuthUser | null }).authUser;
      const set = ctx.set;
      if (!authUser) {
        set.status = 401;
        return { ok: false, code: "UNAUTHORIZED" };
      }
    },
  },
  (app) =>
    app
      .get("/", async (ctx) => {
        const authUser = (ctx as unknown as { authUser: AuthUser }).authUser;
        const now = new Date();

        const user = await prisma.user.findFirst({
          where: { id: authUser.userId },
          select: {
            id: true,
            username: true,
            email: true,
            role: true,
            organization_id: true,
            created_date: true,
            notifications_read_at: true,
          },
        });
        const readAt = user?.notifications_read_at ?? new Date(0);
        const username = user?.username ?? "";
        const email = user?.email ?? "";
        const name = username || (email.includes("@") ? email.split("@")[0] : email) || "there";
        const userCreated = user?.created_date ?? new Date(0);
        const vars: Record<string, string> = {
          name,
          username,
          email,
          role: user?.role ?? "",
          organizationId: user?.organization_id ?? "",
          userId: user?.id ?? "",
          now: now.toISOString(),
          timestamp: now.toISOString(),
          date: now.toISOString().slice(0, 10),
          createdAt: userCreated.toISOString(),
        };

        const welcomeTemplate = await prisma.notificationTemplate.findFirst({
          where: { key: "WELCOME", status: "ACTIVE" },
          select: { title: true, description: true },
        });

        const notifications = await prisma.notification.findMany({
          where: {
            status: "ACTIVE",
            publish_at: { lte: now },
            OR: [
              { recipients: { none: {} } },
              { recipients: { some: { user_id: authUser.userId } } },
            ],
          },
          orderBy: [{ publish_at: "desc" }],
          take: 10,
          select: { id: true, title: true, description: true, importance: true, publish_at: true },
        });

        const welcomeExpiresAt = new Date(userCreated.getTime() + 31 * 24 * 60 * 60 * 1000);
        const includeWelcome =
          Boolean(welcomeTemplate) &&
          Number.isFinite(userCreated.getTime()) &&
          userCreated.getTime() > 0 &&
          now.getTime() < welcomeExpiresAt.getTime();

        const renderedFromDb: RenderedNotification[] = notifications.map((n) => ({
          id: n.id,
          title: renderTemplate(n.title, vars),
          description: renderTemplate(n.description, vars),
          importance: n.importance as unknown as NotificationImportance,
          publish_at: n.publish_at,
        }));

        const welcome: RenderedNotification[] =
          includeWelcome && welcomeTemplate
            ? [
                {
                  id: `WELCOME:${user?.id ?? "USER"}`,
                  title: renderTemplate(welcomeTemplate.title, vars),
                  description: renderTemplate(welcomeTemplate.description, vars),
                  importance: "LOW",
                  publish_at: userCreated,
                },
              ]
            : [];

        const merged: RenderedNotification[] = [...welcome, ...renderedFromDb]
          .filter((n) => n.publish_at.getTime() <= now.getTime())
          .sort((a, b) => b.publish_at.getTime() - a.publish_at.getTime())
          .slice(0, 10);

        const unreadDbCount = await prisma.notification.count({
          where: {
            status: "ACTIVE",
            publish_at: { lte: now, gt: readAt },
            OR: [
              { recipients: { none: {} } },
              { recipients: { some: { user_id: authUser.userId } } },
            ],
          },
        });
        const unreadWelcome = includeWelcome && userCreated.getTime() > readAt.getTime() ? 1 : 0;
        const unreadCount = unreadDbCount + unreadWelcome;

        const next = await prisma.notification.findFirst({
          where: {
            status: "ACTIVE",
            publish_at: { gt: now },
            OR: [
              { recipients: { none: {} } },
              { recipients: { some: { user_id: authUser.userId } } },
            ],
          },
          orderBy: [{ publish_at: "asc" }],
          select: { publish_at: true },
        });

        return {
          unreadCount,
          readAt: readAt.toISOString(),
          nextPublishAt: next?.publish_at ? next.publish_at.toISOString() : null,
          notifications: merged.map((n) => ({
            id: n.id,
            title: n.title,
            description: n.description,
            importance: n.importance,
            publishAt: n.publish_at.toISOString(),
          })),
        };
      })
      .post(
        "/read",
        async (ctx) => {
          const authUser = (ctx as unknown as { authUser: AuthUser }).authUser;
          const now = new Date();
          await prisma.user.update({
            where: { id: authUser.userId },
            data: { notifications_read_at: now, updated_by: authUser.userId },
          });
          return { ok: true, readAt: now };
        },
        { body: t.Optional(t.Object({})) },
      ),
);
