import { unlink } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { config } from "@/config";
import { getDeviceIdFromContext } from "@/lib/device";
import { getClientIpFromContext } from "@/lib/ip";
import { prisma } from "@/lib/prisma";
import { startExpirationSweep } from "@/lib/scheduler";
import { makeShareToken, verifyShareToken } from "@/lib/share";
import { resolveUploadPath } from "@/lib/storage";
import type { AuthUser } from "@/lib/types";
import { wsRegistry } from "@/lib/ws";
import { adminRoutes } from "@/routes/admin";
import { authRoutes } from "@/routes/auth";
import { categoryRoutes } from "@/routes/categories";
import { merchantRoutes } from "@/routes/merchants";
import { notificationRoutes } from "@/routes/notifications";
import { paymentRoutes } from "@/routes/payments";
import { startTelegramBot } from "@/telegram/bot";
import { cors } from "@elysiajs/cors";
import { jwt } from "@elysiajs/jwt";
import { swagger } from "@elysiajs/swagger";
import { Elysia, t } from "elysia";

const app = new Elysia()
  .decorate("authUser", null as AuthUser | null)
  .use(
    cors({
      origin: config.corsOrigins,
      credentials: true,
      allowedHeaders: ["content-type", "authorization", "x-device-id"],
    }),
  )
  .use(
    jwt({
      name: "jwt",
      secret: config.jwtSecret,
      exp: "30m",
    }),
  )
  .use(swagger({ path: "/docs" }))
  .derive(async ({ request, jwt, cookie }) => {
    const authHeader = request.headers.get("authorization");
    const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    const rawCookieValue = cookie.session?.value;
    const cookieToken = typeof rawCookieValue === "string" ? rawCookieValue : null;
    const token = bearer ?? cookieToken ?? null;

    if (!token) return { authUser: null };
    const payload = await jwt.verify(token);
    if (!payload || typeof payload !== "object") return { authUser: null };
    const p = payload as Record<string, unknown>;
    const sub = typeof p.sub === "string" ? p.sub : undefined;
    const org = typeof p.org === "string" ? p.org : undefined;
    const jti = typeof p.jti === "string" ? p.jti : undefined;
    if (!sub || !org || !jti) return { authUser: null };

    const session = await prisma.session.findFirst({
      where: { user_id: sub, jwt_id: jti, status: "ACTIVE" },
      select: { expires_at: true },
    });
    if (!session || session.expires_at.getTime() < Date.now()) {
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
        const deviceRow = await prisma.deviceWhitelist.findFirst({
          where: { device_id: deviceId },
        });
        if (deviceRow?.status === "INACTIVE") {
          ctx.set.status = 404;
          return { ok: false };
        }
      } else {
        const ip = getClientIpFromContext(ctx);
        const ipRow = await prisma.iPWhitelist.findFirst({ where: { ip } });
        if (ipRow?.status === "INACTIVE") {
          ctx.set.status = 404;
          return { ok: false };
        }
      }

      const org = await prisma.organization.findFirst({
        where: { id: verified.organizationId, status: "ACTIVE" },
      });
      if (!org) {
        ctx.set.status = 404;
        return { ok: false };
      }

      const hasActiveUser = await prisma.user.findFirst({
        where: { organization_id: verified.organizationId, status: "ACTIVE" },
        select: { id: true },
      });
      if (!hasActiveUser) {
        ctx.set.status = 404;
        return { ok: false };
      }

      const merchants = await prisma.merchant.findMany({
        where: { organization_id: verified.organizationId, status: "ACTIVE" },
        orderBy: [{ category: "asc" }, { name: "asc" }],
        select: { id: true, name: true, category: true, picture_path: true, picture_mime: true },
      });

      const items = await prisma.paymentItem.findMany({
        where: { organization_id: verified.organizationId, status: "ACTIVE" },
        orderBy: [{ created_date: "desc" }],
        select: {
          id: true,
          kind: true,
          status: true,
          total_amount: true,
          payment_url: true,
          qris_path: true,
          qris_mime: true,
          expires_at: true,
          created_date: true,
          merchant: { select: { id: true, name: true, category: true } },
        },
      });

      const merchantRows = merchants as Array<{
        id: string;
        name: string;
        category: string;
        picture_path: string | null;
        picture_mime: string | null;
      }>;
      const itemRows = items as Array<{
        id: string;
        kind: "LINK" | "QRIS";
        status: string;
        total_amount: number;
        payment_url: string | null;
        qris_path: string | null;
        qris_mime: string | null;
        expires_at: Date | null;
        created_date: Date;
        merchant: { id: string; name: string; category: string };
      }>;

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
        items: itemRows.map((i) => ({
          id: i.id,
          kind: i.kind,
          status: i.status,
          totalAmount: i.total_amount,
          paymentUrl: i.payment_url,
          qrisUrl:
            i.qris_mime || i.qris_path ? `${config.serverPublicBaseUrl}/assets/qris/${i.id}` : null,
          expiresAt: i.expires_at,
          createdDate: i.created_date,
          merchant: { id: i.merchant.id, name: i.merchant.name, category: i.merchant.category },
        })),
      };
    },
    { params: t.Object({ token: t.String({ minLength: 10 }) }) },
  )
  .get("/auth/me", async ({ authUser }) => {
    if (!authUser) return { ok: false };
    const user = await prisma.user.findFirst({
      where: { id: authUser.userId, organization_id: authUser.organizationId, status: "ACTIVE" },
      select: { id: true, username: true, email: true, organization_id: true, role: true },
    });
    if (!user) return { ok: false };
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
        .use(paymentRoutes),
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
      const row = await prisma.merchant.findFirst({
        where: { id: params.id, status: "ACTIVE" },
        select: { picture_data: true, picture_mime: true, picture_path: true },
      });
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
          await prisma.merchant.update({
            where: { id: params.id },
            data: {
              picture_data: next,
              picture_mime: nextMime,
              picture_path: null,
              updated_by: "system",
            },
          });
          void unlink(path).catch(() => {});
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
      const row = await prisma.paymentItem.findFirst({
        where: { id: params.id, status: "ACTIVE", kind: "QRIS" },
        select: { qris_data: true, qris_mime: true, qris_path: true },
      });
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
          await prisma.paymentItem.update({
            where: { id: params.id },
            data: { qris_data: next, qris_mime: nextMime, qris_path: null, updated_by: "system" },
          });
          void unlink(path).catch(() => {});
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
      } catch {}
    },
  })
  .listen({
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
      await prisma.iPWhitelist.upsert({
        where: { ip },
        update: { status: "ACTIVE", updated_by: "system" },
        create: {
          ip,
          note: "local-dev",
          status: "ACTIVE",
          created_by: "system",
          updated_by: "system",
        },
      });
    }
  } catch {}
})();

console.log(`Server on http://0.0.0.0:${app.server?.port}`);
