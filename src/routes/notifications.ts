import { prisma } from "@/lib/prisma";
import type { AuthUser } from "@/lib/types";
import { Elysia, t } from "elysia";

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
          select: { notifications_read_at: true },
        });
        const readAt = user?.notifications_read_at ?? new Date(0);

        const notifications = await prisma.notification.findMany({
          where: {
            status: "ACTIVE",
            publish_at: { lte: now },
          },
          orderBy: [{ publish_at: "desc" }],
          take: 10,
          select: { id: true, title: true, description: true, importance: true, publish_at: true },
        });

        const unreadCount = await prisma.notification.count({
          where: {
            status: "ACTIVE",
            publish_at: { lte: now, gt: readAt },
          },
        });

        const next = await prisma.notification.findFirst({
          where: {
            status: "ACTIVE",
            publish_at: { gt: now },
          },
          orderBy: [{ publish_at: "asc" }],
          select: { publish_at: true },
        });

        return {
          unreadCount,
          readAt: readAt.toISOString(),
          nextPublishAt: next?.publish_at ? next.publish_at.toISOString() : null,
          notifications: notifications.map((n) => ({
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
