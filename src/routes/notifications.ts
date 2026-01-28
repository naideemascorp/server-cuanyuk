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
        const orgId = user?.organization_id ?? "";
        const org =
          orgId && orgId.length > 10
            ? await prisma.organization.findFirst({
                where: { id: orgId },
                select: { display_name: true },
              })
            : null;
        const orgName = org?.display_name ?? "";
        const hour = now.getHours();
        const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
        const emailLocalPart = email.includes("@") ? email.split("@")[0] : email;
        const emailDomain = email.includes("@") ? email.split("@")[1] : "";
        const pad2 = (n: number) => String(n).padStart(2, "0");
        const nowTime = `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
        const weekday = [
          "Sunday",
          "Monday",
          "Tuesday",
          "Wednesday",
          "Thursday",
          "Friday",
          "Saturday",
        ][now.getDay()];
        const month = [
          "January",
          "February",
          "March",
          "April",
          "May",
          "June",
          "July",
          "August",
          "September",
          "October",
          "November",
          "December",
        ][now.getMonth()];
        const vars: Record<string, string> = {
          name,
          firstName: name,
          displayName: name,
          nameUpper: name.toUpperCase(),
          username,
          usernameUpper: username.toUpperCase(),
          email,
          emailLocalPart,
          emailDomain,
          role: user?.role ?? "",
          roleLower: (user?.role ?? "").toLowerCase(),
          organizationId: user?.organization_id ?? "",
          organizationName: orgName,
          userId: user?.id ?? "",
          greeting,
          appName: "Cuan Yuk",
          brandName: "Cuan Yuk",
          productName: "Cuan Yuk",
          now: now.toISOString(),
          nowTime,
          weekday,
          month,
          timestamp: now.toISOString(),
          date: now.toISOString().slice(0, 10),
          createdAt: userCreated.toISOString(),
          year: String(now.getFullYear()),
          nowEpochMs: String(now.getTime()),
          nowHour: String(now.getHours()),
          nowMinute: String(now.getMinutes()),
          nowSecond: String(now.getSeconds()),
        };
        if (orgId && orgId.length > 10) {
          const hasWelcome = await prisma.notification.findFirst({
            where: { organization_id: orgId, is_welcome: true },
            select: { id: true },
          });
          if (!hasWelcome) {
            const welcomeTemplate = await prisma.notificationTemplate.findFirst({
              where: { key: "WELCOME", status: "ACTIVE" },
              select: { title: true, description: true },
            });
            if (welcomeTemplate) {
              try {
                await prisma.notification.create({
                  data: {
                    organization_id: orgId,
                    title: welcomeTemplate.title,
                    description: welcomeTemplate.description,
                    importance: "LOW",
                    status: "ACTIVE",
                    publish_at: now,
                    is_welcome: true,
                    recipient_organization_ids: [],
                    recipient_roles: [],
                    created_by: "system",
                    updated_by: "system",
                  },
                });
              } catch {}
            }
          }
        }

        const audienceOr = [
          {
            recipients: { none: {} },
            recipient_organization_ids: { equals: [] as string[] },
            recipient_roles: { equals: [] as Array<"USER" | "SUPER"> },
          },
          { recipients: { some: { user_id: authUser.userId } } },
          ...(orgId ? [{ recipient_organization_ids: { has: orgId } }] : []),
          ...(user?.role ? [{ recipient_roles: { has: user.role } }] : []),
        ];

        const notifications = await prisma.notification.findMany({
          where: {
            status: "ACTIVE",
            publish_at: { lte: now },
            OR: audienceOr,
          },
          orderBy: [{ publish_at: "desc" }],
          take: 10,
          select: { id: true, title: true, description: true, importance: true, publish_at: true },
        });

        const renderedFromDb: RenderedNotification[] = notifications.map((n) => ({
          id: n.id,
          title: renderTemplate(n.title, vars),
          description: renderTemplate(n.description, vars),
          importance: n.importance as unknown as NotificationImportance,
          publish_at: n.publish_at,
        }));
        const merged: RenderedNotification[] = renderedFromDb
          .filter((n) => n.publish_at.getTime() <= now.getTime())
          .sort((a, b) => b.publish_at.getTime() - a.publish_at.getTime())
          .slice(0, 10);

        const unreadDbCount = await prisma.notification.count({
          where: {
            status: "ACTIVE",
            publish_at: { lte: now, gt: readAt },
            OR: audienceOr,
          },
        });
        const unreadCount = unreadDbCount;

        const next = await prisma.notification.findFirst({
          where: {
            status: "ACTIVE",
            publish_at: { gt: now },
            OR: audienceOr,
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
