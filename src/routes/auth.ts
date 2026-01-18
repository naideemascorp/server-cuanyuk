import { Elysia, t } from "elysia";
import { randomBytes, randomUUID } from "node:crypto";
import { config } from "../config";
import { hashPassword, verifyPassword } from "../lib/auth";
import { getClientIpFromContext } from "../lib/ip";
import { sendEmailVerification, sendPasswordResetEmail } from "../lib/mailer";
import { prisma } from "../lib/prisma";

const oneDayMs = 24 * 60 * 60 * 1000;
const withTimeout = async <T>(promise: Promise<T>, ms: number): Promise<T> => {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("TIMEOUT")), ms))
  ]);
};

export const authRoutes = new Elysia({ prefix: "/auth" })
  .get("/signup-allowed", async (ctx) => {
    const accept = ctx.request.headers.get("accept") ?? "";
    const wantsHtml = accept.includes("text/html");

    const ip = getClientIpFromContext(ctx as any);
    try {
      const whitelisted = await withTimeout(prisma.iPWhitelist.findFirst({ where: { ip, status: "ACTIVE" } }), 1200);
      const allowed = Boolean(whitelisted);

      if (!wantsHtml) return { allowed };
      if (!allowed) {
        return new Response("Not Found", {
          status: 404,
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "no-store"
          }
        });
      }

      const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Sign Up</title>
    <style>
      :root { color-scheme: dark; }
      body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; background: radial-gradient(900px 600px at 15% 10%, rgba(157,124,255,.22), transparent 55%), radial-gradient(900px 600px at 85% 20%, rgba(124,255,214,.18), transparent 58%), linear-gradient(180deg, #090a0f, #0b0f1d); color: rgba(250,250,255,.92); }
      .shell { min-height: 100vh; display: grid; place-items: center; padding: 28px 18px; }
      .panel { width: min(760px, 100%); border: 1px solid rgba(250,250,255,.14); border-radius: 26px; background: linear-gradient(180deg, rgba(16,20,34,.74), rgba(10,12,20,.54)); box-shadow: 0 28px 70px rgba(0,0,0,.65); overflow: hidden; position: relative; }
      .panel::after { content: ""; position: absolute; inset: -2px; background: linear-gradient(135deg, rgba(124,255,214,.36), rgba(157,124,255,.26), rgba(255,124,207,.16)); opacity: .28; filter: blur(18px); z-index: 0; }
      .inner { position: relative; z-index: 1; padding: 22px; display: grid; gap: 16px; }
      h1 { margin: 0; font-size: 34px; letter-spacing: -0.02em; line-height: 1.05; }
      .sub { color: rgba(250,250,255,.62); line-height: 1.5; }
      .pill { display: inline-flex; gap: 10px; align-items: center; padding: 10px 12px; border-radius: 999px; border: 1px solid rgba(255,255,255,.16); background: rgba(0,0,0,.2); font-size: 13px; color: rgba(250,250,255,.76); }
      .grid { display: grid; grid-template-columns: repeat(12, 1fr); gap: 14px; }
      .card { border: 1px solid rgba(255,255,255,.12); border-radius: 18px; background: linear-gradient(180deg, rgba(14,18,32,.9), rgba(10,12,20,.64)); overflow: hidden; }
      .cardInner { padding: 16px; display: grid; gap: 10px; }
      label { color: rgba(255,255,255,.72); font-size: 12px; letter-spacing: .12em; text-transform: uppercase; }
      input { width: 100%; padding: 12px 14px; border-radius: 14px; border: 1px solid rgba(255,255,255,.14); background: rgba(0,0,0,.22); color: rgba(250,250,255,.92); outline: none; }
      input:focus { border-color: rgba(157,124,255,.55); }
      button { appearance: none; border: 1px solid rgba(255,255,255,.14); background: rgba(0,0,0,.22); color: rgba(250,250,255,.92); padding: 11px 14px; border-radius: 14px; cursor: pointer; transition: transform .15s ease, border-color .15s ease, background .15s ease; }
      button:hover { transform: translateY(-1px); border-color: rgba(124,255,214,.34); background: rgba(0,0,0,.3); }
      button.primary { border-color: rgba(124,255,214,.28); background: linear-gradient(135deg, rgba(124,255,214,.16), rgba(157,124,255,.12)); }
      .msg { font-size: 14px; color: rgba(250,250,255,.78); line-height: 1.45; }
      .err { color: rgba(255,124,207,.92); }
      .ok { color: rgba(124,255,214,.92); }
      @media (max-width: 720px) { h1 { font-size: 28px; } .inner { padding: 18px; } }
    </style>
  </head>
  <body>
    <div class="shell">
      <div class="panel">
        <div class="inner">
          <div>
            <h1>Sign Up</h1>
            <div class="sub">This is the backend sign-up page. IP allow-list is enforced.</div>
          </div>
          <div class="pill">Client IP detected: <span id="ip">${ip}</span> • Signup allowed: <span id="allowed">${allowed ? "YES" : "NO"}</span></div>
          <div class="grid">
            <div class="card" style="grid-column: span 7;">
              <div class="cardInner">
                <form id="form" class="grid" style="grid-template-columns: repeat(12, 1fr);">
                  <div style="grid-column: span 12; display: grid; gap: 8px;">
                    <label>Username</label>
                    <input id="username" name="username" autocomplete="username" minlength="3" maxlength="64" required />
                  </div>
                  <div style="grid-column: span 12; display: grid; gap: 8px;">
                    <label>Email</label>
                    <input id="email" name="email" autocomplete="email" maxlength="320" required />
                  </div>
                  <div style="grid-column: span 12; display: grid; gap: 8px;">
                    <label>Password</label>
                    <input id="password" name="password" type="password" autocomplete="new-password" minlength="8" maxlength="256" required />
                  </div>
                  <div style="grid-column: span 12; display: flex; gap: 10px; align-items: center; justify-content: space-between; flex-wrap: wrap;">
                    <button class="primary" type="submit" ${allowed ? "" : "disabled"}>Create Account</button>
                    <a class="pill" href="/" style="text-decoration: none;">Back</a>
                  </div>
                  <div id="msg" class="msg" style="grid-column: span 12;"></div>
                </form>
              </div>
            </div>
            <div class="card" style="grid-column: span 5;">
              <div class="cardInner">
                <div style="font-weight: 650; letter-spacing: -0.01em;">Next Steps</div>
                <div class="sub">After signing up, check your inbox for the verification link. Login is blocked until verified.</div>
                <div style="height: 1px; background: rgba(255,255,255,.12);"></div>
                <div class="sub">Recommended UX is on the frontend at <b>http://localhost:3000/sign-up</b>.</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <script>
      const allowed = ${allowed ? "true" : "false"};
      const msg = document.getElementById("msg");
      const form = document.getElementById("form");
      const setMsg = (t, cls) => { msg.textContent = t; msg.className = "msg " + (cls || ""); };
      if (!allowed) setMsg("Your IP is not whitelisted. Ask an admin to allow-list this IP before signing up.", "err");
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!allowed) return;
        setMsg("Sending…");
        const payload = {
          username: document.getElementById("username").value,
          email: document.getElementById("email").value,
          password: document.getElementById("password").value
        };
        const res = await fetch("/auth/signup", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload)
        });
        const text = await res.text();
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch {}
        if (!res.ok || !data || data.ok !== true) {
          const code = (data && data.code) ? data.code : ("HTTP_" + res.status);
          setMsg("Sign up failed: " + code, "err");
          return;
        }
        setMsg("Created. Check your email for the verification link.", "ok");
        form.reset();
      });
    </script>
  </body>
</html>`;

      return new Response(html, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store"
        }
      });
    } catch {
      if (!wantsHtml) return { allowed: false, ok: false, code: "DB_NOT_READY" };

      const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Sign Up</title>
    <style>
      :root { color-scheme: dark; }
      body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; background: #090a0f; color: rgba(250,250,255,.92); }
      .shell { min-height: 100vh; display: grid; place-items: center; padding: 28px 18px; }
      .card { width: min(760px, 100%); border: 1px solid rgba(255,255,255,.14); border-radius: 18px; padding: 18px; background: rgba(10,12,20,.7); }
      h1 { margin: 0 0 10px 0; font-size: 28px; letter-spacing: -0.02em; }
      .sub { color: rgba(250,250,255,.68); line-height: 1.5; }
      code { color: rgba(124,255,214,.92); }
    </style>
  </head>
  <body>
    <div class="shell">
      <div class="card">
        <h1>Backend Sign Up</h1>
        <div class="sub">Database is not ready (tables/migrations missing or DB unreachable). Apply migrations, then reload this page.</div>
        <div class="sub" style="margin-top: 10px;">If you are using Prisma migrations, run: <code>bunx prisma migrate deploy</code> in the server folder.</div>
      </div>
    </div>
  </body>
</html>`;

      return new Response(html, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store"
        },
        status: 503
      });
    }
  })
  .post(
    "/signup",
    async (ctx) => {
      const body = (ctx as any).body as { username: string; email: string; password: string };
      const set = (ctx as any).set as { status: number };
      const ip = getClientIpFromContext(ctx as any);
      let whitelisted: { organization_id: string | null } | null = null;
      try {
        whitelisted = await withTimeout(
          prisma.iPWhitelist.findFirst({
          where: { ip, status: "ACTIVE" },
          select: { organization_id: true }
          }),
          1200
        );
      } catch {
        set.status = 503;
        return { ok: false, code: "DB_NOT_READY" };
      }
      if (!whitelisted) {
        set.status = 403;
        return { ok: false, code: "SIGNUP_IP_NOT_ALLOWED" };
      }

      const existingOrg = whitelisted.organization_id
        ? await prisma.organization.findFirst({
            where: { id: whitelisted.organization_id, status: "ACTIVE" }
          })
        : null;

      const organization =
        existingOrg ??
        (await prisma.organization.create({
          data: {
            display_name: "Workspace",
            created_by: "system",
            updated_by: "system"
          }
        }));

      const username = body.username.trim();
      const email = body.email.trim().toLowerCase();
      const passwordHash = await hashPassword(body.password);

      const user = await prisma.user.create({
        data: {
          organization_id: organization.id,
          username,
          email,
          password_hash: passwordHash,
          status: "PENDING",
          created_by: "system",
          updated_by: "system"
        }
      });

      const token = randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + oneDayMs);

      await prisma.emailVerificationToken.create({
        data: {
          user_id: user.id,
          token,
          expires_at: expiresAt,
          status: "ACTIVE",
          created_by: user.id,
          updated_by: user.id
        }
      });

      const verifyUrl = `${config.appPublicBaseUrl}/verify-email?token=${token}`;
      await sendEmailVerification(user.email, verifyUrl);

      set.status = 201;
      return { ok: true };
    },
    {
      body: t.Object({
        username: t.String({ minLength: 3, maxLength: 64 }),
        email: t.String({ format: "email", maxLength: 320 }),
        password: t.String({ minLength: 8, maxLength: 256 })
      })
    }
  )
  .get(
    "/verify-email",
    async ({ query, set }) => {
      const token = query.token.trim();
      const row = await prisma.emailVerificationToken.findFirst({
        where: { token, status: "ACTIVE" },
        include: { user: true }
      });
      if (!row) {
        set.status = 400;
        return { ok: false, code: "TOKEN_INVALID" };
      }
      if (row.consumed_at) {
        return { ok: true, alreadyVerified: true };
      }
      if (row.expires_at.getTime() < Date.now()) {
        await prisma.emailVerificationToken.update({
          where: { id: row.id },
          data: { status: "INACTIVE", updated_by: "system" }
        });
        set.status = 400;
        return { ok: false, code: "TOKEN_EXPIRED" };
      }

      await prisma.$transaction([
        prisma.emailVerificationToken.update({
          where: { id: row.id },
          data: { consumed_at: new Date(), status: "INACTIVE", updated_by: "system" }
        }),
        prisma.user.update({
          where: { id: row.user_id },
          data: { email_verified_at: new Date(), status: "ACTIVE", updated_by: "system" }
        })
      ]);

      return { ok: true };
    },
    { query: t.Object({ token: t.String({ minLength: 10 }) }) }
  )
  .post(
    "/password-reset/request",
    async (ctx) => {
      const body = (ctx as any).body as { email?: string };
      const set = (ctx as any).set as { status: number };
      const email = (body.email ?? "").trim().toLowerCase();
      if (!email.includes("@")) {
        set.status = 400;
        return { ok: false, code: "INVALID_INPUT" };
      }

      const user = await prisma.user.findFirst({
        where: { email },
        select: { id: true, email: true }
      });
      if (!user) {
        set.status = 404;
        return { ok: false, code: "USER_NOT_FOUND" };
      }

      const now = Date.now();
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const sentToday = await (prisma as any).passwordResetToken.count({
        where: { user_id: user.id, created_date: { gte: startOfDay } }
      });
      if (sentToday >= 3) {
        const retryAt = new Date(startOfDay.getTime() + oneDayMs);
        set.status = 429;
        return { ok: false, code: "RESEND_LIMIT", retryAt: retryAt.toISOString() };
      }

      const last = await (prisma as any).passwordResetToken.findFirst({
        where: { user_id: user.id },
        orderBy: { created_date: "desc" },
        select: { created_date: true }
      });
      if (last) {
        const nextAllowedAt = last.created_date.getTime() + 60_000;
        if (now < nextAllowedAt) {
          set.status = 429;
          return { ok: false, code: "RESEND_COOLDOWN", nextAllowedAt: new Date(nextAllowedAt).toISOString() };
        }
      }

      const token = randomBytes(32).toString("hex");
      const expiresAt = new Date(now + oneDayMs);
      await prisma.$transaction([
        (prisma as any).passwordResetToken.updateMany({
          where: { user_id: user.id, status: "ACTIVE" },
          data: { status: "INACTIVE", updated_by: "system" }
        }),
        (prisma as any).passwordResetToken.create({
          data: {
            user_id: user.id,
            token,
            expires_at: expiresAt,
            status: "ACTIVE",
            created_by: user.id,
            updated_by: user.id
          }
        })
      ]);

      const resetUrl = `${config.appPublicBaseUrl}/reset-password/${token}`;
      await sendPasswordResetEmail(user.email, resetUrl);

      set.status = 201;
      return {
        ok: true,
        nextAllowedAt: new Date(Date.now() + 60_000).toISOString(),
        remainingToday: Math.max(0, 3 - (sentToday + 1))
      };
    },
    { body: t.Object({ email: t.Optional(t.String({ maxLength: 320 })) }) }
  )
  .post(
    "/password-reset/confirm",
    async (ctx) => {
      const body = (ctx as any).body as { token?: string; newPassword?: string };
      const set = (ctx as any).set as { status: number };
      const token = (body.token ?? "").trim();
      const newPassword = (body.newPassword ?? "").trim();
      if (token.length < 10 || newPassword.length < 8) {
        set.status = 400;
        return { ok: false, code: "INVALID_INPUT" };
      }

      const row = await (prisma as any).passwordResetToken.findFirst({
        where: { token, status: "ACTIVE" },
        include: { user: true }
      });
      if (!row || row.consumed_at) {
        set.status = 400;
        return { ok: false, code: "TOKEN_INVALID" };
      }
      if (row.expires_at.getTime() < Date.now()) {
        await (prisma as any).passwordResetToken.update({
          where: { id: row.id },
          data: { status: "INACTIVE", updated_by: "system" }
        });
        set.status = 400;
        return { ok: false, code: "TOKEN_EXPIRED" };
      }

      const passwordHash = await hashPassword(newPassword);
      const now = new Date();
      await prisma.$transaction([
        (prisma as any).passwordResetToken.update({
          where: { id: row.id },
          data: { consumed_at: now, status: "INACTIVE", updated_by: "system" }
        }),
        prisma.user.update({
          where: { id: row.user_id },
          data: { password_hash: passwordHash, updated_by: "system" }
        }),
        prisma.session.updateMany({
          where: { user_id: row.user_id, status: "ACTIVE" },
          data: { status: "INACTIVE", revoked_at: now, updated_by: "system" }
        })
      ]);

      return { ok: true };
    },
    {
      body: t.Object({
        token: t.String({ minLength: 10 }),
        newPassword: t.String({ minLength: 8, maxLength: 256 })
      })
    }
  )
  .post(
    "/signin",
    async (ctx) => {
      const body = (ctx as any).body as { identifier?: string; email?: string; password?: string };
      const jwt = (ctx as any).jwt as { sign: (payload: unknown) => Promise<string> };
      const cookie = (ctx as any).cookie as any;
      const set = (ctx as any).set as { status: number };
      const identifierRaw = (body?.identifier ?? body?.email ?? "").trim();
      const passwordRaw = (body?.password ?? "").trim();
      if (identifierRaw.length < 2 || passwordRaw.length === 0) {
        set.status = 400;
        return { ok: false, code: "INVALID_INPUT" };
      }

      const email = identifierRaw.toLowerCase();
      const username = identifierRaw;
      const usernameLower = identifierRaw.toLowerCase();
      const user = (await prisma.user.findFirst({
        where: { OR: [{ email }, { username }, { username: usernameLower }] },
        select: ({
          id: true,
          email_verified_at: true,
          status: true,
          password_hash: true,
          organization_id: true,
          username: true,
          email: true,
          role: true
        } as any)
      })) as any;
      if (!user) {
        set.status = 401;
        return { ok: false, code: "USER_NOT_FOUND" };
      }
      if (!user.email_verified_at) {
        set.status = 403;
        return { ok: false, code: "EMAIL_NOT_VERIFIED" };
      }
      if (user.status !== "ACTIVE") {
        set.status = 401;
        return { ok: false, code: "USER_NOT_FOUND" };
      }
      const ok = await verifyPassword(passwordRaw, user.password_hash);
      if (!ok) {
        set.status = 401;
        return { ok: false, code: "INVALID_CREDENTIALS" };
      }

      const jwtId = randomUUID();
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
      await prisma.session.create({
        data: {
          user_id: user.id,
          jwt_id: jwtId,
          expires_at: expiresAt,
          status: "ACTIVE",
          created_by: user.id,
          updated_by: user.id
        }
      });

      const token = await jwt.sign({
        sub: user.id,
        org: user.organization_id,
        jti: jwtId
      });

      cookie.session.set({
        value: token,
        httpOnly: true,
        sameSite: config.cookie.sameSite,
        secure: config.cookie.secure,
        path: "/",
        expires: expiresAt
      });

      return {
        ok: true,
        user: { id: user.id, username: user.username, email: user.email, organizationId: user.organization_id, role: user.role }
      };
    },
    {
      body: t.Object({
        identifier: t.Optional(t.String({ maxLength: 320 })),
        email: t.Optional(t.String({ maxLength: 320 })),
        password: t.Optional(t.String({ maxLength: 256 }))
      })
    }
  )
  .post("/signout", async ({ cookie, set }) => {
    cookie.session.remove();
    set.status = 204;
    return;
  });
