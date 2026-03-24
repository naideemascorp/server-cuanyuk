import { unlink } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { config } from "@/config";
import { ok as apiOk, failBug, isApiResponse } from "@/lib/api-response";
import { getDeviceIdFromContext } from "@/lib/device";
import { getClientIpFromContext } from "@/lib/ip";
import { startExpirationSweep } from "@/lib/scheduler";
import { makeShareToken, verifyShareToken } from "@/lib/share";
import { resolveUploadPath } from "@/lib/storage";
import { supabase } from "@/lib/supabase";
import { verifySessionToken } from "@/lib/token";
import type { AuthUser } from "@/lib/types";
import { wsRegistry } from "@/lib/ws";
import { adminRoutes } from "@/routes/admin";
import { authRoutes } from "@/routes/auth";
import { cashRoutes } from "@/routes/cash";
import { categoryRoutes } from "@/routes/categories";
import { merchantRoutes } from "@/routes/merchants";
import { notificationRoutes } from "@/routes/notifications";
import { paymentRoutes } from "@/routes/payments";
import { startTelegramBot } from "@/telegram/bot";
import { Elysia, t } from "elysia";

const pickCorsOrigin = (originHeader: string | null): string | null => {
  if (!originHeader) return null;
  const origin = originHeader.trim();
  if (!origin) return null;
  for (const allowed of config.corsOrigins) {
    if (typeof allowed === "string") {
      if (origin === allowed) return origin;
    } else if (allowed instanceof RegExp) {
      if (allowed.test(origin)) return origin;
    }
  }
  return null;
};

const buildHeaders = (setHeaders: Record<string, string | number | undefined>) => {
  const headers = new Headers();
  for (const [k, v] of Object.entries(setHeaders)) {
    if (typeof v === "string") headers.set(k, v);
    else if (typeof v === "number") headers.set(k, String(v));
  }
  return headers;
};

const jsonResponse = (
  data: unknown,
  set: { status?: number | string; headers: Record<string, string | number | undefined> },
) => {
  const statusNumber = typeof set.status === "number" ? set.status : Number(set.status ?? 200);
  const headers = buildHeaders(set.headers);
  if (!headers.has("content-type")) headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data), {
    status: Number.isFinite(statusNumber) ? statusNumber : 200,
    headers,
  });
};

const app = new Elysia()
  .decorate("authUser", null as AuthUser | null)
  .onRequest(({ request, set }) => {
    const origin = pickCorsOrigin(request.headers.get("origin"));
    if (origin) {
      set.headers["access-control-allow-origin"] = origin;
      set.headers["access-control-allow-credentials"] = "true";
      set.headers.vary = "origin";
    }
    if (request.method === "OPTIONS") {
      if (origin) {
        set.headers["access-control-allow-methods"] = "GET,POST,PUT,PATCH,DELETE,OPTIONS";
        set.headers["access-control-allow-headers"] = "content-type,authorization,x-device-id";
      }
      set.status = 204;
      return new Response(null, { status: 204, headers: buildHeaders(set.headers) });
    }
  })
  .onError(({ error, set }) => {
    const statusNumber = typeof set.status === "number" ? set.status : Number(set.status ?? 500);
    if (!Number.isFinite(statusNumber) || statusNumber < 400) set.status = 500;
    const what = "UNHANDLED_ERROR";
    const why = error instanceof Error ? error.message : "Unknown error";
    const how = "Check server logs/stack trace and fix the exception.";
    return failBug(what, why, how);
  })
  .mapResponse(({ response, set }) => {
    if (response instanceof Response) return response;
    const statusNumber = typeof set.status === "number" ? set.status : Number(set.status ?? 200);
    if (Number.isFinite(statusNumber) && statusNumber === 204)
      return new Response(null, { status: 204 });
    if (typeof response === "string") {
      return new Response(response, {
        status: Number.isFinite(statusNumber) ? statusNumber : 200,
        headers: buildHeaders(set.headers),
      });
    }
    if (isApiResponse(response)) return jsonResponse(response, set);
    if (response && typeof response === "object") {
      const rec = response as Record<string, unknown>;
      if (typeof rec.ok === "boolean") {
        if (rec.ok) {
          const { ok: _ok, ...rest } = rec;
          return jsonResponse(apiOk(Object.keys(rest).length ? rest : undefined), set);
        }
        const { ok: _ok, code: originalCode, ...rest } = rec;
        const code = typeof originalCode === "string" ? originalCode : "REQUEST_FAILED";
        const existingStatus =
          typeof set.status === "number" ? set.status : Number(set.status ?? 0);
        set.status =
          Number.isFinite(existingStatus) && existingStatus >= 400 ? existingStatus : 400;
        const failure = failBug(code, "Request rejected.", "Validate inputs and retry.");
        const data = Object.keys(rest).length ? rest : undefined;
        return jsonResponse(data ? { ...failure, data } : failure, set);
      }
    }
    return jsonResponse(apiOk(typeof response === "undefined" ? undefined : response), set);
  })
  .derive(async ({ request, cookie }) => {
    const authHeader = request.headers.get("authorization");
    const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    const rawCookieValue = cookie.session?.value;
    const cookieToken = typeof rawCookieValue === "string" ? rawCookieValue : null;
    const token = bearer ?? cookieToken ?? null;

    if (!token) return { authUser: null };
    const payload = await verifySessionToken(token, config.jwtSecret);
    if (!payload) return { authUser: null };
    const { sub, org, jti } = payload;
    if (!sub || !org || !jti) return { authUser: null };

    const { data: session } = await supabase
      .from("sessions")
      .select("expires_at")
      .eq("user_id", sub)
      .eq("jwt_id", jti)
      .eq("status", "ACTIVE")
      .limit(1)
      .maybeSingle();
    if (!session || new Date(session.expires_at).getTime() < Date.now()) {
      return { authUser: null };
    }

    return { authUser: { userId: sub, organizationId: org } };
  })
  .get(
    "/public/dashboard/:token",
    async (ctx) => {
      const verified = verifyShareToken(ctx.params.token);
      if (!verified) {
        ctx.set.status = 404;
        return { ok: false };
      }

      const deviceId = getDeviceIdFromContext(ctx);
      if (deviceId) {
        const { data: deviceRow } = await supabase
          .from("device_whitelist")
          .select("status")
          .eq("device_id", deviceId)
          .limit(1)
          .maybeSingle();
        if (deviceRow?.status === "INACTIVE") {
          ctx.set.status = 404;
          return { ok: false };
        }
      } else {
        const ip = getClientIpFromContext(ctx);
        const { data: ipRow } = await supabase
          .from("ip_whitelist")
          .select("status")
          .eq("ip", ip)
          .limit(1)
          .maybeSingle();
        if (ipRow?.status === "INACTIVE") {
          ctx.set.status = 404;
          return { ok: false };
        }
      }

      const { data: org } = await supabase
        .from("organizations")
        .select("id")
        .eq("id", verified.organizationId)
        .eq("status", "ACTIVE")
        .limit(1)
        .maybeSingle();
      if (!org) {
        ctx.set.status = 404;
        return { ok: false };
      }

      const { data: hasActiveUser } = await supabase
        .from("users")
        .select("id")
        .eq("organization_id", verified.organizationId)
        .eq("status", "ACTIVE")
        .limit(1)
        .maybeSingle();
      if (!hasActiveUser) {
        ctx.set.status = 404;
        return { ok: false };
      }

      const { data: merchants } = await supabase
        .from("merchants")
        .select("id, name, category, picture_path, picture_mime")
        .eq("organization_id", verified.organizationId)
        .eq("status", "ACTIVE")
        .order("category", { ascending: true })
        .order("name", { ascending: true });

      const { data: items } = await supabase
        .from("payment_items")
        .select("id, kind, status, total_amount, payment_url, qris_path, qris_mime, expires_at, created_date, merchant_id")
        .eq("organization_id", verified.organizationId)
        .eq("status", "ACTIVE")
        .order("created_date", { ascending: false });

      const merchantRows = (merchants ?? []) as Array<{
        id: string; name: string; category: string;
        picture_path: string | null; picture_mime: string | null;
      }>;
      const itemRows = (items ?? []) as Array<{
        id: string; kind: "LINK" | "QRIS"; status: string;
        total_amount: number; payment_url: string | null;
        qris_path: string | null; qris_mime: string | null;
        expires_at: string | null; created_date: string; merchant_id: string;
      }>;
      const merchantMap = new Map(merchantRows.map((m) => [m.id, m]));

      return {
        ok: true,
        merchants: merchantRows.map((m) => ({
          id: m.id,
          name: m.name,
          category: m.category,
          pictureUrl:
            m.picture_mime || m.picture_path
              ? `${config.serverPublicBaseUrl}/assets/merchant/${m.id}`
              : null,
        })),
        items: itemRows.map((i) => {
          const merchant = merchantMap.get(i.merchant_id) ?? { id: i.merchant_id, name: "", category: "" };
          return {
            id: i.id,
            kind: i.kind,
            status: i.status,
            totalAmount: i.total_amount,
            paymentUrl: i.payment_url,
            qrisUrl:
              i.qris_mime || i.qris_path ? `${config.serverPublicBaseUrl}/assets/qris/${i.id}` : null,
            expiresAt: i.expires_at,
            createdDate: i.created_date,
            merchant: { id: merchant.id, name: merchant.name, category: merchant.category },
          };
        }),
      };
    },
    { params: t.Object({ token: t.String({ minLength: 10 }) }) },
  )
  .get("/auth/me", async ({ authUser, set }) => {
    if (!authUser) {
      set.status = 401;
      return { ok: false, code: "UNAUTHORIZED" };
    }
    const { data: user } = await supabase
      .from("users")
      .select("id, username, email, organization_id, role")
      .eq("id", authUser.userId)
      .eq("organization_id", authUser.organizationId)
      .eq("status", "ACTIVE")
      .limit(1)
      .maybeSingle();
    if (!user) {
      set.status = 401;
      return { ok: false, code: "UNAUTHORIZED" };
    }
    const shareToken = makeShareToken(user.organization_id);
    return {
      ok: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        organizationId: user.organization_id,
        role: user.role,
      },
      shareUrl: `${config.appPublicBaseUrl}/share/${shareToken}`,
    };
  })
  .guard(
    {
      beforeHandle: ({ authUser, set }) => {
        if (!authUser) {
          set.status = 401;
          return { ok: false, code: "UNAUTHORIZED" };
        }
      },
    },
    (app) =>
      app
        .use(notificationRoutes)
        .use(adminRoutes)
        .use(categoryRoutes)
        .use(merchantRoutes)
        .use(paymentRoutes)
        .use(cashRoutes),
  )
  .use(authRoutes)
  .get("/health", () => ({ ok: true }))
  .get(
    "/assets/merchant/:id",
    async ({ params, set }) => {
      const mimeFromName = (name: string | null) => {
        const ext = (name?.split(".").pop() ?? "").toLowerCase();
        if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
        if (ext === "gif") return "image/gif";
        if (ext === "webp") return "image/webp";
        return "image/png";
      };
      const { data: row } = await supabase
        .from("merchants")
        .select("picture_data, picture_mime, picture_path")
        .eq("id", params.id)
        .eq("status", "ACTIVE")
        .limit(1)
        .maybeSingle();
      if (!row) {
        set.status = 404;
        return "not found";
      }
      let bytes = row.picture_data as unknown as Uint8Array | null;
      let mime = row.picture_mime ?? "image/png";
      if (!bytes && row.picture_path) {
        const path = resolveUploadPath(row.picture_path);
        const file = Bun.file(path);
        if (await file.exists()) {
          const ab = await file.arrayBuffer();
          const next = new Uint8Array(ab);
          const nextMime = mimeFromName(row.picture_path);
          await supabase
            .from("merchants")
            .update({
              picture_data: `\\x${Array.from(next).map((b) => b.toString(16).padStart(2, "0")).join("")}`,
              picture_mime: nextMime,
              picture_path: null,
              updated_by: "system",
            })
            .eq("id", params.id);
          void unlink(path).catch(() => { });
          bytes = next;
          mime = nextMime;
        }
      }
      if (!bytes) {
        set.status = 404;
        return "not found";
      }
      set.headers["content-type"] = mime;
      set.headers["cache-control"] = "public, max-age=3600";
      const ab = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
      return new Response(ab);
    },
    { params: t.Object({ id: t.String({ minLength: 10 }) }) },
  )
  .get(
    "/assets/qris/:id",
    async ({ params, set }) => {
      const mimeFromName = (name: string | null) => {
        const ext = (name?.split(".").pop() ?? "").toLowerCase();
        if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
        if (ext === "gif") return "image/gif";
        if (ext === "webp") return "image/webp";
        return "image/png";
      };
      const { data: row } = await supabase
        .from("payment_items")
        .select("qris_data, qris_mime, qris_path")
        .eq("id", params.id)
        .eq("status", "ACTIVE")
        .eq("kind", "QRIS")
        .limit(1)
        .maybeSingle();
      if (!row) {
        set.status = 404;
        return "not found";
      }
      let bytes = row.qris_data as unknown as Uint8Array | null;
      let mime = row.qris_mime ?? "image/png";
      if (!bytes && row.qris_path) {
        const path = resolveUploadPath(row.qris_path);
        const file = Bun.file(path);
        if (await file.exists()) {
          const ab = await file.arrayBuffer();
          const next = new Uint8Array(ab);
          const nextMime = mimeFromName(row.qris_path);
          await supabase
            .from("payment_items")
            .update({
              qris_data: `\\x${Array.from(next).map((b) => b.toString(16).padStart(2, "0")).join("")}`,
              qris_mime: nextMime,
              qris_path: null,
              updated_by: "system",
            })
            .eq("id", params.id);
          void unlink(path).catch(() => { });
          bytes = next;
          mime = nextMime;
        }
      }
      if (!bytes) {
        set.status = 404;
        return "not found";
      }
      set.headers["content-type"] = mime;
      set.headers["cache-control"] = "public, max-age=3600";
      const ab = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
      return new Response(ab);
    },
    { params: t.Object({ id: t.String({ minLength: 10 }) }) },
  )
  .ws("/ws", {
    open(ws) {
      wsRegistry.add(ws);
      ws.send(JSON.stringify({ type: "hello", serverTime: new Date().toISOString() }));
    },
    close(ws) {
      wsRegistry.remove(ws);
    },
    async message(ws, message) {
      try {
        const parsed = JSON.parse(String(message));
        if (parsed?.type === "ping") {
          ws.send(JSON.stringify({ type: "pong" }));
          return;
        }
        if (parsed?.type === "sync") {
          wsRegistry.broadcast({ type: "items:changed" });
        }
      } catch { }
    },
  });

export default app;

if (!process.env.VERCEL) {
  app.listen({
    port: Number(process.env.PORT ?? 3001),
    hostname: "0.0.0.0",
  });

  startExpirationSweep();
  void startTelegramBot();
  void (async () => {
    try {
      const ips = new Set<string>(["127.0.0.1", "::1"]);
      const net = networkInterfaces();
      for (const entries of Object.values(net)) {
        for (const entry of entries ?? []) {
          if (!entry || entry.internal) continue;
          if (entry.address) ips.add(entry.address);
        }
      }

      for (const ip of ips) {
        await supabase
          .from("ip_whitelist")
          .upsert(
            {
              ip,
              note: "local-dev",
              status: "ACTIVE",
              created_by: "system",
              updated_by: "system",
            },
            { onConflict: "ip" },
          );
      }
    } catch { }
  })();

  console.log(`Server on http://0.0.0.0:${app.server?.port}`);
}
