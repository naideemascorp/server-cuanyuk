import { Elysia, t } from "elysia";
import { prisma } from "../lib/prisma";
import type { AuthUser } from "../lib/types";

export const categoryRoutes = new Elysia({ prefix: "/categories" })
  .get("/", async (ctx) => {
    const authUser = (ctx as unknown as { authUser: AuthUser }).authUser;
    const [cats, merchants] = await Promise.all([
      prisma.category.findMany({
        where: { organization_id: authUser.organizationId, status: "ACTIVE" },
        orderBy: [{ name: "asc" }],
        select: { id: true, name: true }
      }),
      prisma.merchant.findMany({
        where: { organization_id: authUser.organizationId, status: "ACTIVE" },
        select: { category: true }
      })
    ]);

    const merged = new Map<string, { id: string | null; name: string }>();
    for (const c of cats) merged.set(c.name, { id: c.id, name: c.name });
    for (const m of merchants) {
      const n = (m.category || "").trim();
      if (!n) continue;
      if (!merged.has(n)) merged.set(n, { id: null, name: n });
    }

    return { categories: Array.from(merged.values()).sort((a, b) => a.name.localeCompare(b.name)) };
  })
  .post(
    "/",
    async (ctx) => {
      const authUser = (ctx as unknown as { authUser: AuthUser }).authUser;
      const body = ctx.body;
      const set = ctx.set;
      const name = body.name.trim();
      const created = await prisma.category.upsert({
        where: { organization_id_name: { organization_id: authUser.organizationId, name } },
        create: {
          organization_id: authUser.organizationId,
          name,
          status: "ACTIVE",
          created_by: authUser.userId,
          updated_by: authUser.userId
        },
        update: { status: "ACTIVE", updated_by: authUser.userId },
        select: { id: true, name: true }
      });
      set.status = 201;
      return { category: created };
    },
    { body: t.Object({ name: t.String({ minLength: 2, maxLength: 80 }) }) }
  );
