import { supabase } from "@/lib/supabase";
import type { AuthUser } from "@/lib/types";
import { Elysia, t } from "elysia";

export const adminRoutes = new Elysia({ prefix: "/api/admin" }).guard(
  {
    beforeHandle: async (ctx) => {
      const authUser = (ctx as unknown as { authUser: AuthUser | null }).authUser;
      const set = ctx.set;
      const u = authUser;
      if (!u) {
        set.status = 401;
        return { ok: false, code: "UNAUTHORIZED" };
      }
      const { data: user } = await supabase
        .from("users")
        .select("role")
        .eq("id", u.userId)
        .eq("organization_id", u.organizationId)
        .eq("status", "ACTIVE")
        .limit(1)
        .maybeSingle();
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
        const { data: entries } = await supabase
          .from("ip_whitelist")
          .select("id, ip, note, status, created_date, updated_date")
          .order("updated_date", { ascending: false })
          .limit(200);
        const rows = (entries ?? []) as Array<{
          id: string;
          ip: string;
          note: string | null;
          status: string;
          created_date: string;
          updated_date: string;
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

          const { data: saved } = await supabase
            .from("ip_whitelist")
            .upsert(
              {
                ip,
                note,
                status,
                created_by: authUser.userId,
                updated_by: authUser.userId,
              },
              { onConflict: "ip" },
            )
            .select()
            .single();
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
      .get("/devices", async () => {
        const { data: entries } = await supabase
          .from("device_whitelist")
          .select("id, device_id, note, status, created_date, updated_date")
          .order("updated_date", { ascending: false })
          .limit(200);
        const rows = (entries ?? []) as Array<{
          id: string;
          device_id: string;
          note: string | null;
          status: string;
          created_date: string;
          updated_date: string;
        }>;
        return {
          entries: rows.map((e) => ({
            id: e.id,
            ip: e.device_id,
            note: e.note,
            status: e.status,
            createdDate: e.created_date,
            updatedDate: e.updated_date,
          })),
        };
      })
      .post(
        "/devices",
        async (ctx) => {
          const authUser = (ctx as unknown as { authUser: AuthUser }).authUser;
          const body = ctx.body;
          const set = ctx.set;
          const deviceId = body.ip.trim();
          const note = body.note?.trim() || null;
          const status = body.status;

          const { data: saved } = await supabase
            .from("device_whitelist")
            .upsert(
              {
                device_id: deviceId,
                note,
                status,
                created_by: authUser.userId,
                updated_by: authUser.userId,
              },
              { onConflict: "device_id" },
            )
            .select()
            .single();
          set.status = 201;
          return { entry: saved };
        },
        {
          body: t.Object({
            ip: t.String({ minLength: 8, maxLength: 120 }),
            status: t.Union([t.Literal("ACTIVE"), t.Literal("INACTIVE")]),
            note: t.Optional(t.String({ maxLength: 200 })),
          }),
        },
      )
      .get("/notifications", async (ctx) => {
        const { data: entries } = await supabase
          .from("notifications")
          .select("id, title, description, is_welcome, importance, publish_at, status, created_date, updated_date, recipient_organization_ids, recipient_roles")
          .order("is_welcome", { ascending: false })
          .order("publish_at", { ascending: false })
          .limit(200);
        const notifs = entries ?? [];
        const notifIds = notifs.map((n: { id: string }) => n.id);
        const { data: recipientRows } = notifIds.length
          ? await supabase
            .from("notification_recipients")
            .select("notification_id, user_id")
            .in("notification_id", notifIds)
          : { data: [] };
        const recipientMap = new Map<string, string[]>();
        for (const r of recipientRows ?? []) {
          if (!recipientMap.has(r.notification_id)) recipientMap.set(r.notification_id, []);
          recipientMap.get(r.notification_id)!.push(r.user_id);
        }
        const rows = notifs as Array<{
          id: string;
          title: string;
          description: string;
          is_welcome: boolean;
          importance: string;
          publish_at: string;
          status: string;
          created_date: string;
          updated_date: string;
          recipient_organization_ids: string[];
          recipient_roles: string[];
        }>;
        return {
          entries: rows.map((e) => ({
            id: e.id,
            title: e.title,
            description: e.description,
            isWelcome: Boolean(e.is_welcome),
            importance: e.importance,
            publishAt: e.publish_at,
            status: e.status,
            createdDate: e.created_date,
            updatedDate: e.updated_date,
            recipientUserIds: recipientMap.get(e.id) ?? [],
            recipientOrganizationIds: e.recipient_organization_ids ?? [],
            recipientRoles: e.recipient_roles ?? [],
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
          const publishAt = new Date(body.publishAt).toISOString();
          const isWelcome = Boolean(body.isWelcome);
          const rawRecipientIds = body.recipientUserIds ?? [];
          const rawRecipientOrgIds = body.recipientOrganizationIds ?? [];
          const rawRecipientRoles = body.recipientRoles ?? [];
          if (!Number.isFinite(new Date(body.publishAt).getTime())) {
            set.status = 400;
            return { ok: false, code: "INVALID_PUBLISH_AT" };
          }

          const saveNotification = async (notifId: string | null) => {
            let row: { id: string } | null = null;
            if (notifId) {
              const { data } = await supabase
                .from("notifications")
                .update({
                  title,
                  description,
                  importance,
                  status,
                  publish_at: publishAt,
                  is_welcome: isWelcome,
                  recipient_organization_ids: rawRecipientOrgIds,
                  recipient_roles: rawRecipientRoles,
                  updated_by: authUser.userId,
                })
                .eq("id", notifId)
                .select()
                .single();
              row = data;
            } else {
              const { data } = await supabase
                .from("notifications")
                .insert({
                  organization_id: authUser.organizationId,
                  title,
                  description,
                  importance,
                  status,
                  publish_at: publishAt,
                  is_welcome: isWelcome,
                  recipient_organization_ids: rawRecipientOrgIds,
                  recipient_roles: rawRecipientRoles,
                  created_by: authUser.userId,
                  updated_by: authUser.userId,
                })
                .select()
                .single();
              row = data;
            }
            if (!row) return null;


            await supabase
              .from("notification_recipients")
              .delete()
              .eq("notification_id", row.id);

            if (rawRecipientIds.length) {
              const { data: validUsers } = await supabase
                .from("users")
                .select("id")
                .in("id", rawRecipientIds);
              if (validUsers && validUsers.length) {
                await supabase.from("notification_recipients").upsert(
                  validUsers.map((u: { id: string }) => ({
                    notification_id: row!.id,
                    user_id: u.id,
                  })),
                  { onConflict: "notification_id,user_id", ignoreDuplicates: true },
                );
              }
            }


            if (status === "ACTIVE") {
              const { data: active } = await supabase
                .from("notifications")
                .select("id")
                .eq("status", "ACTIVE")
                .eq("organization_id", authUser.organizationId)
                .eq("is_welcome", false)
                .order("publish_at", { ascending: false })
                .limit(50);
              if (active && active.length > 10) {
                const toDeactivate = active.slice(10).map((n: { id: string }) => n.id);
                await supabase
                  .from("notifications")
                  .update({ status: "INACTIVE", updated_by: authUser.userId })
                  .in("id", toDeactivate);
              }
            }
            return row;
          };

          if (isWelcome) {
            const { data: existingWelcome } = await supabase
              .from("notifications")
              .select("id")
              .eq("organization_id", authUser.organizationId)
              .eq("is_welcome", true)
              .limit(1)
              .maybeSingle();
            const saved = await saveNotification(existingWelcome?.id ?? null);
            set.status = 200;
            return { entry: saved };
          }

          if (id) {
            const { data: existing } = await supabase
              .from("notifications")
              .select("id")
              .eq("id", id)
              .limit(1)
              .maybeSingle();
            if (!existing) {
              set.status = 404;
              return { ok: false, code: "NOT_FOUND" };
            }
            const updated = await saveNotification(id);
            set.status = 200;
            return { entry: updated };
          }

          const created = await saveNotification(null);
          set.status = 201;
          return { entry: created };
        },
        {
          body: t.Object({
            id: t.Optional(t.String({ minLength: 10, maxLength: 60 })),
            title: t.String({ minLength: 2, maxLength: 120 }),
            description: t.String({ minLength: 2, maxLength: 260 }),
            isWelcome: t.Optional(t.Boolean()),
            importance: t.Union([
              t.Literal("LOW"),
              t.Literal("MEDIUM"),
              t.Literal("HIGH"),
              t.Literal("CRITICAL"),
            ]),
            status: t.Union([t.Literal("ACTIVE"), t.Literal("INACTIVE")]),
            publishAt: t.String({ minLength: 10, maxLength: 40 }),
            recipientUserIds: t.Optional(t.Array(t.String({ minLength: 10, maxLength: 60 }))),
            recipientOrganizationIds: t.Optional(
              t.Array(t.String({ minLength: 10, maxLength: 60 })),
            ),
            recipientRoles: t.Optional(t.Array(t.Union([t.Literal("USER"), t.Literal("SUPER")]))),
          }),
        },
      )
      .get("/notification-templates/welcome", async (ctx) => {
        const authUser = (ctx as unknown as { authUser: AuthUser }).authUser;
        const nowIso = new Date().toISOString();
        const { data: existing } = await supabase
          .from("notifications")
          .select("id")
          .eq("organization_id", authUser.organizationId)
          .eq("is_welcome", true)
          .limit(1)
          .maybeSingle();
        let entry: { status: string; title: string; description: string; updated_date: string } | null;
        if (existing) {
          const { data } = await supabase
            .from("notifications")
            .update({ updated_by: authUser.userId })
            .eq("id", existing.id)
            .select("status, title, description, updated_date")
            .single();
          entry = data;
        } else {
          const { data } = await supabase
            .from("notifications")
            .insert({
              organization_id: authUser.organizationId,
              title: "Welcome in, {{name}}",
              description:
                "Hey {{name}} — welcome to Cuan Yuk. You're officially in. Tap around, explore the dashboard, and start stacking wins today.",
              importance: "LOW",
              status: "ACTIVE",
              publish_at: nowIso,
              is_welcome: true,
              recipient_organization_ids: [],
              recipient_roles: [],
              created_by: authUser.userId,
              updated_by: authUser.userId,
            })
            .select("status, title, description, updated_date")
            .single();
          entry = data;
        }
        return {
          template: entry
            ? {
              key: "WELCOME",
              status: entry.status,
              title: entry.title,
              description: entry.description,
              updatedDate: entry.updated_date,
            }
            : null,
        };
      })
      .post(
        "/notification-templates/welcome",
        async (ctx) => {
          const authUser = (ctx as unknown as { authUser: AuthUser }).authUser;
          const body = ctx.body;
          const nowIso = new Date().toISOString();
          const { data: existing } = await supabase
            .from("notifications")
            .select("id")
            .eq("organization_id", authUser.organizationId)
            .eq("is_welcome", true)
            .limit(1)
            .maybeSingle();
          let entry: { status: string; title: string; description: string; updated_date: string } | null;
          if (existing) {
            const { data } = await supabase
              .from("notifications")
              .update({
                title: body.title.trim(),
                description: body.description.trim(),
                status: body.status,
                publish_at: nowIso,
                is_welcome: true,
                updated_by: authUser.userId,
              })
              .eq("id", existing.id)
              .select("status, title, description, updated_date")
              .single();
            entry = data;
          } else {
            const { data } = await supabase
              .from("notifications")
              .insert({
                organization_id: authUser.organizationId,
                title: body.title.trim(),
                description: body.description.trim(),
                importance: "LOW",
                status: body.status,
                publish_at: nowIso,
                is_welcome: true,
                recipient_organization_ids: [],
                recipient_roles: [],
                created_by: authUser.userId,
                updated_by: authUser.userId,
              })
              .select("status, title, description, updated_date")
              .single();
            entry = data;
          }
          return {
            ok: true,
            template: entry
              ? {
                key: "WELCOME",
                status: entry.status,
                title: entry.title,
                description: entry.description,
                updatedDate: entry.updated_date,
              }
              : null,
          };
        },
        {
          body: t.Object({
            title: t.String({ minLength: 2, maxLength: 200 }),
            description: t.String({ minLength: 2, maxLength: 1000 }),
            status: t.Union([t.Literal("ACTIVE"), t.Literal("INACTIVE")]),
          }),
        },
      )
      .get("/organizations", async (ctx) => {
        const { data: orgs } = await supabase
          .from("organizations")
          .select("id, display_name, status")
          .order("display_name", { ascending: true })
          .limit(500);
        return {
          organizations: (orgs ?? []).map((o: { id: string; display_name: string; status: string }) => ({
            id: o.id,
            displayName: o.display_name,
            status: o.status,
          })),
        };
      })
      .get("/users", async (ctx) => {
        const { data: users } = await supabase
          .from("users")
          .select("id, username, email, role, status, created_date, updated_date")
          .order("updated_date", { ascending: false })
          .limit(500);
        const rows = (users ?? []) as Array<{
          id: string;
          username: string;
          email: string;
          role: "USER" | "SUPER";
          status: string;
          created_date: string;
          updated_date: string;
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

          const { data: existing } = await supabase
            .from("users")
            .select("id, status")
            .eq("id", id)
            .limit(1)
            .maybeSingle();
          if (!existing) {
            set.status = 404;
            return { ok: false, code: "NOT_FOUND" };
          }

          const { data: updated } = await supabase
            .from("users")
            .update({ username, email, role, status, updated_by: authUser.userId })
            .eq("id", id)
            .select()
            .single();

          if (status === "INACTIVE") {
            const nowIso = new Date().toISOString();
            await supabase
              .from("sessions")
              .update({ status: "INACTIVE", revoked_at: nowIso, updated_by: authUser.userId })
              .eq("user_id", id)
              .eq("status", "ACTIVE");
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
