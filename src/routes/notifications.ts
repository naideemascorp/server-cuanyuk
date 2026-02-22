import { supabase } from "@/lib/supabase";
import type { AuthUser } from "@/lib/types";
import { Elysia, t } from "elysia";

type NotificationImportance = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
type RenderedNotification = {
  id: string;
  title: string;
  description: string;
  importance: NotificationImportance;
  publish_at: string;
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
        const nowIso = now.toISOString();

        const { data: user } = await supabase
          .from("users")
          .select("id, username, email, role, organization_id, created_date, notifications_read_at")
          .eq("id", authUser.userId)
          .limit(1)
          .maybeSingle();
        const readAt = user?.notifications_read_at ? new Date(user.notifications_read_at) : new Date(0);
        const username = user?.username ?? "";
        const email = user?.email ?? "";
        const name = username || (email.includes("@") ? email.split("@")[0] : email) || "there";
        const userCreated = user?.created_date ? new Date(user.created_date) : new Date(0);
        const orgId = user?.organization_id ?? "";
        let orgName = "";
        if (orgId && orgId.length > 10) {
          const { data: org } = await supabase
            .from("organizations")
            .select("display_name")
            .eq("id", orgId)
            .limit(1)
            .maybeSingle();
          orgName = org?.display_name ?? "";
        }
        const hour = now.getHours();
        const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
        const emailLocalPart = email.includes("@") ? email.split("@")[0] : email;
        const emailDomain = email.includes("@") ? email.split("@")[1] : "";
        const pad2 = (n: number) => String(n).padStart(2, "0");
        const nowTime = `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
        const weekday = [
          "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
        ][now.getDay()];
        const month = [
          "January", "February", "March", "April", "May", "June",
          "July", "August", "September", "October", "November", "December",
        ][now.getMonth()];
        const vars: Record<string, string> = {
          name, firstName: name, displayName: name, nameUpper: name.toUpperCase(),
          username, usernameUpper: username.toUpperCase(), email, emailLocalPart, emailDomain,
          role: user?.role ?? "", roleLower: (user?.role ?? "").toLowerCase(),
          organizationId: user?.organization_id ?? "", organizationName: orgName,
          userId: user?.id ?? "", greeting, appName: "Cuan Yuk", brandName: "Cuan Yuk",
          productName: "Cuan Yuk", now: nowIso, nowTime, weekday: weekday ?? "",
          month: month ?? "", timestamp: nowIso, date: nowIso.slice(0, 10),
          createdAt: userCreated.toISOString(), year: String(now.getFullYear()),
          nowEpochMs: String(now.getTime()), nowHour: String(now.getHours()),
          nowMinute: String(now.getMinutes()), nowSecond: String(now.getSeconds()),
        };

        if (orgId && orgId.length > 10) {
          const { data: hasWelcome } = await supabase
            .from("notifications")
            .select("id")
            .eq("organization_id", orgId)
            .eq("is_welcome", true)
            .limit(1)
            .maybeSingle();
          if (!hasWelcome) {
            const { data: welcomeTemplate } = await supabase
              .from("notification_templates")
              .select("title, description")
              .eq("key", "WELCOME")
              .eq("status", "ACTIVE")
              .limit(1)
              .maybeSingle();
            if (welcomeTemplate) {
              try {
                await supabase.from("notifications").insert({
                  organization_id: orgId,
                  title: welcomeTemplate.title,
                  description: welcomeTemplate.description,
                  importance: "LOW",
                  status: "ACTIVE",
                  publish_at: nowIso,
                  is_welcome: true,
                  recipient_organization_ids: [],
                  recipient_roles: [],
                  created_by: "system",
                  updated_by: "system",
                });
              } catch { }
            }
          }
        }


        const { data: allNotifs } = await supabase
          .from("notifications")
          .select("id, title, description, importance, publish_at, recipient_organization_ids, recipient_roles")
          .eq("status", "ACTIVE")
          .lte("publish_at", nowIso)
          .order("publish_at", { ascending: false })
          .limit(50);

        const notifs = allNotifs ?? [];

        const notifIds = notifs.map((n: { id: string }) => n.id);
        const { data: recipientRows } = notifIds.length
          ? await supabase
            .from("notification_recipients")
            .select("notification_id, user_id")
            .in("notification_id", notifIds)
          : { data: [] };
        const recipientMap = new Map<string, Set<string>>();
        for (const r of recipientRows ?? []) {
          if (!recipientMap.has(r.notification_id)) recipientMap.set(r.notification_id, new Set());
          recipientMap.get(r.notification_id)!.add(r.user_id);
        }

        const isAudience = (n: {
          id: string;
          recipient_organization_ids: string[];
          recipient_roles: string[];
        }) => {
          const recipients = recipientMap.get(n.id);
          const hasNoTargeting =
            (!recipients || recipients.size === 0) &&
            (!n.recipient_organization_ids || n.recipient_organization_ids.length === 0) &&
            (!n.recipient_roles || n.recipient_roles.length === 0);
          if (hasNoTargeting) return true;
          if (recipients?.has(authUser.userId)) return true;
          if (orgId && n.recipient_organization_ids?.includes(orgId)) return true;
          if (user?.role && n.recipient_roles?.includes(user.role)) return true;
          return false;
        };

        const filtered = notifs.filter(isAudience);
        const renderedFromDb: RenderedNotification[] = filtered.map((n) => ({
          id: n.id,
          title: renderTemplate(n.title, vars),
          description: renderTemplate(n.description, vars),
          importance: n.importance as NotificationImportance,
          publish_at: n.publish_at,
        }));
        const merged: RenderedNotification[] = renderedFromDb
          .filter((n) => new Date(n.publish_at).getTime() <= now.getTime())
          .sort((a, b) => new Date(b.publish_at).getTime() - new Date(a.publish_at).getTime())
          .slice(0, 10);


        const unreadCount = merged.filter(
          (n) => new Date(n.publish_at).getTime() > readAt.getTime(),
        ).length;


        const { data: allFuture } = await supabase
          .from("notifications")
          .select("id, publish_at, recipient_organization_ids, recipient_roles")
          .eq("status", "ACTIVE")
          .gt("publish_at", nowIso)
          .order("publish_at", { ascending: true })
          .limit(20);

        const nextNotif = (allFuture ?? []).find(isAudience);

        return {
          unreadCount,
          readAt: readAt.toISOString(),
          nextPublishAt: nextNotif?.publish_at ?? null,
          notifications: merged.map((n) => ({
            id: n.id,
            title: n.title,
            description: n.description,
            importance: n.importance,
            publishAt: n.publish_at,
          })),
        };
      })
      .post(
        "/read",
        async (ctx) => {
          const authUser = (ctx as unknown as { authUser: AuthUser }).authUser;
          const now = new Date().toISOString();
          await supabase
            .from("users")
            .update({ notifications_read_at: now, updated_by: authUser.userId })
            .eq("id", authUser.userId);
          return { ok: true, readAt: now };
        },
        { body: t.Optional(t.Object({})) },
      ),
);
