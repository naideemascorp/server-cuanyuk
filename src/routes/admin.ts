import { Elysia, t } from "elysia";
import { prisma } from "../lib/prisma";
import type { AuthUser } from "../lib/types";

export const adminRoutes = new Elysia({ prefix: "/admin" })
  .guard(
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
          select: { role: true }
        });
        if (!user || user.role !== "SUPER") {
          set.status = 403;
          return { ok: false, code: "FORBIDDEN" };
        }
      }
    },
    (app) =>
      app
        .get("/ips", async () => {
          const entries = await prisma.iPWhitelist.findMany({
            orderBy: [{ updated_date: "desc" }],
            take: 200
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
              updatedDate: e.updated_date
            }))
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
                updated_by: authUser.userId
              },
              update: { note, status, updated_by: authUser.userId }
            });
            set.status = 201;
            return { entry: saved };
          },
          {
            body: t.Object({
              ip: t.String({ minLength: 3, maxLength: 120 }),
              status: t.Union([t.Literal("ACTIVE"), t.Literal("INACTIVE")]),
              note: t.Optional(t.String({ maxLength: 200 }))
            })
          }
        )
        .get("/users", async (ctx) => {
          const authUser = (ctx as unknown as { authUser: AuthUser }).authUser;
          const users = await prisma.user.findMany({
            where: { organization_id: authUser.organizationId },
            orderBy: [{ updated_date: "desc" }],
            take: 200,
            select: {
              id: true,
              username: true,
              email: true,
              role: true,
              status: true,
              created_date: true,
              updated_date: true
            }
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
              updatedDate: u.updated_date
            }))
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
              where: { id, organization_id: authUser.organizationId },
              select: { id: true, status: true }
            });
            if (!existing) {
              set.status = 404;
              return { ok: false, code: "NOT_FOUND" };
            }

            const updated = await prisma.user.update({
              where: { id },
              data: { username, email, role, status, updated_by: authUser.userId }
            });

            if (status === "INACTIVE") {
              const now = new Date();
              await prisma.session.updateMany({
                where: { user_id: id, status: "ACTIVE" },
                data: { status: "INACTIVE", revoked_at: now, updated_by: authUser.userId }
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
              status: t.Union([t.Literal("ACTIVE"), t.Literal("INACTIVE")])
            })
          }
        )
  );
