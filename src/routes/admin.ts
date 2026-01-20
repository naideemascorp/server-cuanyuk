import { prisma } from "@/lib/prisma";
import type { AuthUser } from "@/lib/types";
import { Elysia, t } from "elysia";

export const adminRoutes = new Elysia({ prefix: "/admin" }).guard(
  {
    beforeHandle: async (ctx) => {
      const authUser = (ctx as unknown as { authUser: AuthUser | null }).authUser;
      const set = ctx.set;
      const u = authUser;
      if (!u) {
        set.status = 401;
        return { ok: false, code: "UNAUTHORIZED" };
      }
      const user = await prisma.user.findFirst({
        where: { id: u.userId, organization_id: u.organizationId, status: "ACTIVE" },
        select: { role: true },
      });
      if (user?.role !== "SUPER") {
        set.status = 403;
        return { ok: false, code: "FORBIDDEN" };
      }
    },
  },
  (app) =>
    app
      .get("/access", async () => ({ ok: true }))
      .get("/ips", async () => {
        const entries = await prisma.iPWhitelist.findMany({
          orderBy: [{ updated_date: "desc" }],
          take: 200,
        });
        const rows = entries as Array<{
          id: string;
          ip: string;
          note: string | null;
          status: string;
          created_date: Date;
          updated_date: Date;
        }>;
        return {
          entries: rows.map((e) => ({
            id: e.id,
            ip: e.ip,
            note: e.note,
            status: e.status,
            createdDate: e.created_date,
            updatedDate: e.updated_date,
          })),
        };
      })
      .post(
        "/ips",
        async (ctx) => {
          const authUser = (ctx as unknown as { authUser: AuthUser }).authUser;
          const body = ctx.body;
          const set = ctx.set;
          const ip = body.ip.trim();
          const note = body.note?.trim() || null;
          const status = body.status;

          const saved = await prisma.iPWhitelist.upsert({
            where: { ip },
            create: {
              ip,
              note,
              status,
              created_by: authUser.userId,
              updated_by: authUser.userId,
            },
            update: { note, status, updated_by: authUser.userId },
          });
          set.status = 201;
          return { entry: saved };
        },
        {
          body: t.Object({
            ip: t.String({ minLength: 3, maxLength: 120 }),
            status: t.Union([t.Literal("ACTIVE"), t.Literal("INACTIVE")]),
            note: t.Optional(t.String({ maxLength: 200 })),
          }),
        },
      )
      .get("/notifications", async (ctx) => {
        const entries = await prisma.notification.findMany({
          orderBy: [{ publish_at: "desc" }],
          take: 200,
        });
        const rows = entries as Array<{
          id: string;
          title: string;
          description: string;
          importance: string;
          publish_at: Date;
          status: string;
          created_date: Date;
          updated_date: Date;
        }>;
        return {
          entries: rows.map((e) => ({
            id: e.id,
            title: e.title,
            description: e.description,
            importance: e.importance,
            publishAt: e.publish_at,
            status: e.status,
            createdDate: e.created_date,
            updatedDate: e.updated_date,
          })),
        };
      })
      .post(
        "/notifications",
        async (ctx) => {
          const authUser = (ctx as unknown as { authUser: AuthUser }).authUser;
          const body = ctx.body;
          const set = ctx.set;

          const id = body.id?.trim() || null;
          const title = body.title.trim();
          const description = body.description.trim();
          const importance = body.importance;
          const status = body.status;
          const publishAt = new Date(body.publishAt);
          if (!Number.isFinite(publishAt.getTime())) {
            set.status = 400;
            return { ok: false, code: "INVALID_PUBLISH_AT" };
          }

          if (id) {
            const updated = await prisma.$transaction(async (tx) => {
              const existing = await tx.notification.findFirst({
                where: { id },
                select: { id: true },
              });
              if (!existing) return null;
              const saved = await tx.notification.update({
                where: { id },
                data: {
                  title,
                  description,
                  importance,
                  status,
                  publish_at: publishAt,
                  updated_by: authUser.userId,
                },
              });
              if (status === "ACTIVE") {
                const active = await tx.notification.findMany({
                  where: { status: "ACTIVE" },
                  orderBy: [{ publish_at: "desc" }],
                  select: { id: true },
                  take: 50,
                });
                if (active.length > 10) {
                  const toDeactivate = active.slice(10).map((n: { id: string }) => n.id);
                  await tx.notification.updateMany({
                    where: { id: { in: toDeactivate } },
                    data: { status: "INACTIVE", updated_by: authUser.userId },
                  });
                }
              }
              return saved;
            });
            if (!updated) {
              set.status = 404;
              return { ok: false, code: "NOT_FOUND" };
            }
            set.status = 200;
            return { entry: updated };
          }

          const created = await prisma.$transaction(async (tx) => {
            const saved = await tx.notification.create({
              data: {
                organization_id: authUser.organizationId,
                title,
                description,
                importance,
                status,
                publish_at: publishAt,
                created_by: authUser.userId,
                updated_by: authUser.userId,
              },
            });
            if (status === "ACTIVE") {
              const active = await tx.notification.findMany({
                where: { status: "ACTIVE" },
                orderBy: [{ publish_at: "desc" }],
                select: { id: true },
                take: 50,
              });
              if (active.length > 10) {
                const toDeactivate = active.slice(10).map((n: { id: string }) => n.id);
                await tx.notification.updateMany({
                  where: { id: { in: toDeactivate } },
                  data: { status: "INACTIVE", updated_by: authUser.userId },
                });
              }
            }
            return saved;
          });
          set.status = 201;
          return { entry: created };
        },
        {
          body: t.Object({
            id: t.Optional(t.String({ minLength: 10, maxLength: 60 })),
            title: t.String({ minLength: 2, maxLength: 120 }),
            description: t.String({ minLength: 2, maxLength: 260 }),
            importance: t.Union([
              t.Literal("LOW"),
              t.Literal("MEDIUM"),
              t.Literal("HIGH"),
              t.Literal("CRITICAL"),
            ]),
            status: t.Union([t.Literal("ACTIVE"), t.Literal("INACTIVE")]),
            publishAt: t.String({ minLength: 10, maxLength: 40 }),
          }),
        },
      )
      .get("/users", async (ctx) => {
        const users = await prisma.user.findMany({
          orderBy: [{ updated_date: "desc" }],
          take: 500,
          select: {
            id: true,
            username: true,
            email: true,
            role: true,
            status: true,
            created_date: true,
            updated_date: true,
          },
        });
        const rows = users as Array<{
          id: string;
          username: string;
          email: string;
          role: "USER" | "SUPER";
          status: string;
          created_date: Date;
          updated_date: Date;
        }>;
        return {
          users: rows.map((u) => ({
            id: u.id,
            username: u.username,
            email: u.email,
            role: u.role,
            status: u.status,
            createdDate: u.created_date,
            updatedDate: u.updated_date,
          })),
        };
      })
      .post(
        "/users/:id",
        async (ctx) => {
          const authUser = (ctx as unknown as { authUser: AuthUser }).authUser;
          const set = ctx.set;
          const params = ctx.params;
          const body = ctx.body;

          const id = params.id;
          const username = body.username.trim();
          const email = body.email.trim();
          const role = body.role;
          const status = body.status;

          const existing = await prisma.user.findFirst({
            where: { id },
            select: { id: true, status: true },
          });
          if (!existing) {
            set.status = 404;
            return { ok: false, code: "NOT_FOUND" };
          }

          const updated = await prisma.user.update({
            where: { id },
            data: { username, email, role, status, updated_by: authUser.userId },
          });

          if (status === "INACTIVE") {
            const now = new Date();
            await prisma.session.updateMany({
              where: { user_id: id, status: "ACTIVE" },
              data: { status: "INACTIVE", revoked_at: now, updated_by: authUser.userId },
            });
          }

          set.status = 200;
          return { user: updated };
        },
        {
          params: t.Object({ id: t.String({ minLength: 10 }) }),
          body: t.Object({
            username: t.String({ minLength: 2, maxLength: 120 }),
            email: t.String({ minLength: 3, maxLength: 200 }),
            role: t.Union([t.Literal("USER"), t.Literal("SUPER")]),
            status: t.Union([t.Literal("ACTIVE"), t.Literal("INACTIVE")]),
          }),
        },
      ),
);
