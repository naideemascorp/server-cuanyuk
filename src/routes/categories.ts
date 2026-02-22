import { supabase } from "@/lib/supabase";
import type { AuthUser } from "@/lib/types";
import { Elysia, t } from "elysia";

export const categoryRoutes = new Elysia({ prefix: "/categories" })
  .get("/", async (ctx) => {
    const authUser = (ctx as unknown as { authUser: AuthUser }).authUser;
    const [catsResult, merchantsResult] = await Promise.all([
      supabase
        .from("categories")
        .select("id, name")
        .eq("organization_id", authUser.organizationId)
        .eq("status", "ACTIVE")
        .neq("name", "Cash In/Out")
        .order("name", { ascending: true }),
      supabase
        .from("merchants")
        .select("category")
        .eq("organization_id", authUser.organizationId)
        .eq("status", "ACTIVE")
        .neq("category", "Cash In/Out"),
    ]);

    const cats = catsResult.data ?? [];
    const merchants = merchantsResult.data ?? [];

    const merged = new Map<string, { id: string | null; name: string }>();
    for (const c of cats) merged.set(c.name, { id: c.id, name: c.name });
    for (const m of merchants) {
      const n = (m.category || "").trim();
      if (!n) continue;
      if (n === "Cash In/Out") continue;
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
      const { data: created } = await supabase
        .from("categories")
        .upsert(
          {
            organization_id: authUser.organizationId,
            name,
            status: "ACTIVE",
            created_by: authUser.userId,
            updated_by: authUser.userId,
          },
          { onConflict: "organization_id,name" },
        )
        .select("id, name")
        .single();
      set.status = 201;
      return { category: created };
    },
    { body: t.Object({ name: t.String({ minLength: 2, maxLength: 80 }) }) },
  );
