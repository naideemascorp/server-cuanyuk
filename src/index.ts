import { cors } from "@elysiajs/cors";
import { jwt } from "@elysiajs/jwt";
import { swagger } from "@elysiajs/swagger";
import { Elysia, t } from "elysia";
import { networkInterfaces } from "node:os";
import { config } from "./config";
import { startExpirationSweep } from "./lib/scheduler";
import { resolveUploadPath } from "./lib/storage";
import { wsRegistry } from "./lib/ws";
import { prisma } from "./lib/prisma";
import { makeShareToken, verifyShareToken } from "./lib/share";
import { getClientIpFromContext } from "./lib/ip";
import { authRoutes } from "./routes/auth";
import { adminRoutes } from "./routes/admin";
import { categoryRoutes } from "./routes/categories";
import { merchantRoutes } from "./routes/merchants";
import { paymentRoutes } from "./routes/payments";
import { startTelegramBot } from "./telegram/bot";
import type { AuthUser } from "./lib/types";

const app = new Elysia()
  .decorate("authUser", null as AuthUser | null)
  .use(
    cors({
      origin: config.corsOrigins,
      credentials: true,
      allowedHeaders: ["content-type", "authorization"]
    })
  )
  .use(
    jwt({
      name: "jwt",
      secret: config.jwtSecret,
      exp: "30m"
    })
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
      select: { expires_at: true }
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

      const ip = getClientIpFromContext(ctx);
      const ipRow = await prisma.iPWhitelist.findFirst({ where: { ip } });
      if (ipRow?.status === "INACTIVE") {
        ctx.set.status = 404;
        return { ok: false };
      }

      const org = await prisma.organization.findFirst({ where: { id: verified.organizationId, status: "ACTIVE" } });
      if (!org) {
        ctx.set.status = 404;
        return { ok: false };
      }

      const hasActiveUser = await prisma.user.findFirst({
        where: { organization_id: verified.organizationId, status: "ACTIVE" },
        select: { id: true }
      });
      if (!hasActiveUser) {
        ctx.set.status = 404;
        return { ok: false };
      }

      const merchants = await prisma.merchant.findMany({
        where: { organization_id: verified.organizationId, status: "ACTIVE" },
        orderBy: [{ category: "asc" }, { name: "asc" }]
      });

      const items = await prisma.paymentItem.findMany({
        where: { organization_id: verified.organizationId, status: "ACTIVE" },
        orderBy: [{ created_date: "desc" }],
        include: { merchant: true }
      });

      const merchantRows = merchants as Array<{
        id: string;
        name: string;
        category: string;
        picture_path: string | null;
      }>;
      const itemRows = items as Array<{
        id: string;
        kind: "LINK" | "QRIS";
        status: string;
        total_amount: number;
        payment_url: string | null;
        qris_path: string | null;
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
          pictureUrl: m.picture_path ? `${config.serverPublicBaseUrl}/uploads/${m.picture_path}` : null
        })),
        items: itemRows.map((i) => ({
          id: i.id,
          kind: i.kind,
          status: i.status,
          totalAmount: i.total_amount,
          paymentUrl: i.payment_url,
          qrisUrl: i.qris_path ? `${config.serverPublicBaseUrl}/uploads/${i.qris_path}` : null,
          expiresAt: i.expires_at,
          createdDate: i.created_date,
          merchant: { id: i.merchant.id, name: i.merchant.name, category: i.merchant.category }
        }))
      };
    },
    { params: t.Object({ token: t.String({ minLength: 10 }) }) }
  )
  .get("/auth/me", async ({ authUser }) => {
    if (!authUser) return { ok: false };
    const user = await prisma.user.findFirst({
      where: { id: authUser.userId, organization_id: authUser.organizationId, status: "ACTIVE" },
      select: { id: true, username: true, email: true, organization_id: true, role: true }
    });
    if (!user) return { ok: false };
    const shareToken = makeShareToken(user.organization_id);
    return {
      ok: true,
      user: { id: user.id, username: user.username, email: user.email, organizationId: user.organization_id, role: user.role },
      shareUrl: `${config.appPublicBaseUrl}/share/${shareToken}`
    };
  })
  .guard(
    {
      beforeHandle: ({ authUser, set }) => {
        if (!authUser) {
          set.status = 401;
          return { ok: false, code: "UNAUTHORIZED" };
        }
      }
    },
    (app) =>
      app
        .use(adminRoutes)
        .use(categoryRoutes)
        .use(merchantRoutes)
        .use(paymentRoutes)
  )
  .use(authRoutes)
  .get("/health", () => ({ ok: true }))
  .get(
    "/uploads/:filename",
    async ({ params, set }) => {
      const filename = params.filename;
      if (!/^[a-f0-9-]{36}\.[a-z0-9]+$/i.test(filename)) {
        set.status = 404;
        return "not found";
      }
      const path = resolveUploadPath(filename);
      const file = Bun.file(path);
      if (!(await file.exists())) {
        set.status = 404;
        return "not found";
      }
      set.headers["cache-control"] = "public, max-age=3600";
      return file;
    },
    { params: t.Object({ filename: t.String() }) }
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
    }
  })
  .listen({
    port: Number(process.env.PORT ?? 3001),
    hostname: "0.0.0.0"
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
        create: { ip, note: "local-dev", status: "ACTIVE", created_by: "system", updated_by: "system" }
      });
    }
  } catch {}
})();

console.log(`Server on http://0.0.0.0:${app.server?.port}`);
