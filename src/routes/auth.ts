import { randomBytes, randomUUID } from "node:crypto";
import { config } from "@/config";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { getDeviceIdFromContext } from "@/lib/device";
import { sendEmailVerification, sendPasswordResetEmail } from "@/lib/mailer";
import { supabase } from "@/lib/supabase";
import { signSessionToken } from "@/lib/token";
import { Elysia, t } from "elysia";

const oneDayMs = 24 * 60 * 60 * 1000;
const withTimeout = async <T>(fn: () => PromiseLike<T>, ms: number): Promise<T> => {
  return await Promise.race([
    Promise.resolve(fn()),
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("TIMEOUT")), ms)),
  ]);
};

export const authRoutes = new Elysia({ prefix: "/auth" })
  .get("/signup-allowed", async (ctx) => {
    const accept = ctx.request.headers.get("accept") ?? "";
    const wantsHtml = accept.includes("text/html");

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
            <div class="sub">This is the backend sign-up page. Device allow-list is enforced.</div>
          </div>
          <div class="pill">Device ID: <span id="device">—</span> • Signup allowed: <span id="allowed">—</span></div>
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
                    <button id="submitBtn" class="primary" type="submit" disabled>Create Account</button>
                    <a class="pill" href="/" style="text-decoration: none;">Back</a>
                  </div>
                  <div id="msg" class="msg" style="grid-column: span 12;"></div>
                </form>
              </div>
            </div>
            <div class="card" style="grid-column: span 5;">
              <div class="cardInner">
                <div style="font-weight: 650; letter-spacing: -0.01em;">Next Steps</div>
                <div class="sub">After signing up, check your inbox for the verification link. Sign in is blocked until verified.</div>
                <div style="height: 1px; background: rgba(255,255,255,.12);"></div>
                <div class="sub">Recommended UX is on the frontend at <b>http://localhost:3000/sign-up</b>.</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <script>
      const makeUuidV4 = () => {
        const cryptoObj = globalThis.crypto;
        if (cryptoObj?.randomUUID) return cryptoObj.randomUUID();
        const bytes = new Uint8Array(16);
        cryptoObj.getRandomValues(bytes);
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
        return \`\${hex.slice(0, 8)}-\${hex.slice(8, 12)}-\${hex.slice(12, 16)}-\${hex.slice(16, 20)}-\${hex.slice(20)}\`;
      };

      const getOrCreateDeviceId = () => {
        try {
          const existing = localStorage.getItem("device_id");
          if (existing && existing.trim()) return existing.trim();
          const created = makeUuidV4();
          localStorage.setItem("device_id", created);
          return created;
        } catch {
          return null;
        }
      };

      const deviceId = getOrCreateDeviceId();
      const deviceEl = document.getElementById("device");
      const allowedEl = document.getElementById("allowed");
      const submitBtn = document.getElementById("submitBtn");
      const msg = document.getElementById("msg");
      const form = document.getElementById("form");

      const setAllowedUi = (allowed) => {
        allowedEl.textContent = allowed ? "YES" : "NO";
        submitBtn.disabled = !allowed;
        if (!allowed)
          msg.textContent =
            "This device is not allow-listed. Ask an admin to allow-list this device ID before signing up.";
        if (allowed) msg.textContent = "";
      };

      if (deviceId) deviceEl.textContent = deviceId;
      if (!deviceId) {
        allowedEl.textContent = "NO";
        msg.textContent = "Unable to generate a device ID (storage blocked).";
      } else {
        fetch("/auth/signup-allowed", {
          headers: { accept: "application/json", "x-device-id": deviceId },
        })
          .then((r) => r.json())
          .then((data) => setAllowedUi(Boolean(data && data.allowed)))
          .catch(() => {
            allowedEl.textContent = "NO";
            msg.textContent = "Failed to reach server.";
          });
      }

      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!deviceId) return;
        if (submitBtn.disabled) return;
        msg.textContent = "Sending…";
        const payload = {
          username: document.getElementById("username").value,
          email: document.getElementById("email").value,
          password: document.getElementById("password").value,
        };
        const res = await fetch("/auth/signup", {
          method: "POST",
          headers: { "content-type": "application/json", "x-device-id": deviceId },
          body: JSON.stringify(payload),
        });
        const text = await res.text();
        let data = null;
        try {
          data = text ? JSON.parse(text) : null;
        } catch {}
        if (!res.ok || !data || data.ok !== true) {
          const code = data && data.code ? data.code : "HTTP_" + res.status;
          msg.textContent = "Sign up failed: " + code;
          return;
        }
        msg.textContent = "Created. Check your email for the verification link.";
        form.reset();
      });
    </script>
  </body>
</html>`;

    if (wantsHtml) {
      return new Response(html, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    }

    const deviceId = getDeviceIdFromContext(ctx);
    try {
      const { data: hasAnyUser } = await withTimeout(
        () => supabase.from("users").select("id").limit(1).maybeSingle(),
        1200,
      );
      const bootstrap = !hasAnyUser;
      if (bootstrap) return { allowed: true, deviceId };
      if (!deviceId) return { allowed: false, deviceId: null };

      const { data: whitelisted } = await withTimeout(
        () => supabase
          .from("device_whitelist")
          .select("id")
          .eq("device_id", deviceId)
          .eq("status", "ACTIVE")
          .limit(1)
          .maybeSingle(),
        1200,
      );
      return { allowed: Boolean(whitelisted), deviceId };
    } catch {
      return { allowed: false, ok: false, code: "DB_NOT_READY" };
    }
  })
  .post(
    "/signup",
    async (ctx) => {
      const body = ctx.body;
      const set = ctx.set;
      const deviceId = getDeviceIdFromContext(ctx);
      if (!deviceId) {
        set.status = 403;
        return { ok: false, code: "DEVICE_ID_REQUIRED" };
      }

      let whitelisted: { organization_id: string | null } | null = null;
      let bootstrap = false;
      try {
        const { data: hasAnyUser } = await withTimeout(
          () => supabase.from("users").select("id").limit(1).maybeSingle(),
          1200,
        );
        bootstrap = !hasAnyUser;
        if (!bootstrap) {
          const { data } = await withTimeout(
            () => supabase
              .from("device_whitelist")
              .select("organization_id")
              .eq("device_id", deviceId)
              .eq("status", "ACTIVE")
              .limit(1)
              .maybeSingle(),
            1200,
          );
          whitelisted = data;
        } else {
          whitelisted = { organization_id: null };
        }
      } catch {
        set.status = 503;
        return { ok: false, code: "DB_NOT_READY" };
      }
      if (!whitelisted) {
        set.status = 403;
        return { ok: false, code: "SIGNUP_DEVICE_NOT_ALLOWED" };
      }

      let organization: { id: string } | null = null;
      if (whitelisted.organization_id) {
        const { data: existingOrg } = await supabase
          .from("organizations")
          .select("*")
          .eq("id", whitelisted.organization_id)
          .eq("status", "ACTIVE")
          .limit(1)
          .maybeSingle();
        organization = existingOrg;
      }

      if (!organization) {
        const { data: newOrg } = await supabase
          .from("organizations")
          .insert({
            display_name: "Workspace",
            created_by: "system",
            updated_by: "system",
          })
          .select()
          .single();
        organization = newOrg;
      }
      if (!organization) {
        set.status = 500;
        return { ok: false, code: "ORG_CREATION_FAILED" };
      }

      if (bootstrap) {
        await supabase
          .from("device_whitelist")
          .upsert(
            {
              device_id: deviceId,
              status: "ACTIVE",
              organization_id: organization.id,
              note: "Bootstrap device",
              created_by: "system",
              updated_by: "system",
            },
            { onConflict: "device_id" },
          );
      }

      const username = body.username.trim();
      const email = body.email.trim().toLowerCase();
      const passwordHash = await hashPassword(body.password);

      const { data: user } = await supabase
        .from("users")
        .insert({
          organization_id: organization.id,
          username,
          email,
          password_hash: passwordHash,
          status: "PENDING",
          created_by: "system",
          updated_by: "system",
        })
        .select()
        .single();
      if (!user) {
        set.status = 500;
        return { ok: false, code: "USER_CREATION_FAILED" };
      }

      const token = randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + oneDayMs).toISOString();

      await supabase.from("email_verification_tokens").insert({
        user_id: user.id,
        token,
        expires_at: expiresAt,
        status: "ACTIVE",
        created_by: user.id,
        updated_by: user.id,
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
        password: t.String({ minLength: 8, maxLength: 256 }),
      }),
    },
  )
  .get(
    "/verify-email",
    async ({ query, set }) => {
      const token = query.token.trim();
      const { data: row } = await supabase
        .from("email_verification_tokens")
        .select("*, user:users(*)")
        .eq("token", token)
        .eq("status", "ACTIVE")
        .limit(1)
        .maybeSingle();
      if (!row) {
        set.status = 400;
        return { ok: false, code: "TOKEN_INVALID" };
      }
      if (row.consumed_at) {
        return { ok: true, alreadyVerified: true };
      }
      if (new Date(row.expires_at).getTime() < Date.now()) {
        await supabase
          .from("email_verification_tokens")
          .update({ status: "INACTIVE", updated_by: "system" })
          .eq("id", row.id);
        set.status = 400;
        return { ok: false, code: "TOKEN_EXPIRED" };
      }

      const nowIso = new Date().toISOString();
      await supabase
        .from("email_verification_tokens")
        .update({ consumed_at: nowIso, status: "INACTIVE", updated_by: "system" })
        .eq("id", row.id);
      await supabase
        .from("users")
        .update({ email_verified_at: nowIso, status: "ACTIVE", updated_by: "system" })
        .eq("id", row.user_id);

      return { ok: true };
    },
    { query: t.Object({ token: t.String({ minLength: 10 }) }) },
  )
  .post(
    "/password-reset/request",
    async (ctx) => {
      const body = ctx.body;
      const set = ctx.set;
      const identifierRaw = (body.identifier ?? body.email ?? "").trim();
      if (identifierRaw.length < 2) {
        set.status = 400;
        return { ok: false, code: "INVALID_INPUT" };
      }

      const email = identifierRaw.includes("@") ? identifierRaw.toLowerCase() : "";
      const username = identifierRaw;
      const usernameLower = identifierRaw.toLowerCase();


      let user: { id: string; email: string; status: string } | null = null;
      const { data: byEmail } = email
        ? await supabase
          .from("users")
          .select("id, email, status")
          .eq("email", email)
          .limit(1)
          .maybeSingle()
        : { data: null };
      user = byEmail;
      if (!user) {
        const { data: byUsername } = await supabase
          .from("users")
          .select("id, email, status")
          .eq("username", username)
          .limit(1)
          .maybeSingle();
        user = byUsername;
      }
      if (!user) {
        const { data: byUsernameLower } = await supabase
          .from("users")
          .select("id, email, status")
          .eq("username", usernameLower)
          .limit(1)
          .maybeSingle();
        user = byUsernameLower;
      }
      if (user?.status !== "ACTIVE") {
        set.status = 404;
        return { ok: false, code: "USER_NOT_FOUND" };
      }

      const now = Date.now();
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const { count: sentToday } = await supabase
        .from("password_reset_tokens")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .gte("created_date", startOfDay.toISOString());
      if ((sentToday ?? 0) >= 3) {
        const retryAt = new Date(startOfDay.getTime() + oneDayMs);
        set.status = 429;
        return { ok: false, code: "RESEND_LIMIT", retryAt: retryAt.toISOString() };
      }

      const { data: last } = await supabase
        .from("password_reset_tokens")
        .select("created_date")
        .eq("user_id", user.id)
        .order("created_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (last) {
        const nextAllowedAt = new Date(last.created_date).getTime() + 60_000;
        if (now < nextAllowedAt) {
          set.status = 429;
          return {
            ok: false,
            code: "RESEND_COOLDOWN",
            nextAllowedAt: new Date(nextAllowedAt).toISOString(),
          };
        }
      }

      const token = randomBytes(32).toString("hex");
      const expiresAt = new Date(now + oneDayMs).toISOString();
      await supabase
        .from("password_reset_tokens")
        .update({ status: "INACTIVE", updated_by: "system" })
        .eq("user_id", user.id)
        .eq("status", "ACTIVE");
      await supabase.from("password_reset_tokens").insert({
        user_id: user.id,
        token,
        expires_at: expiresAt,
        status: "ACTIVE",
        created_by: user.id,
        updated_by: user.id,
      });

      const resetUrl = `${config.appPublicBaseUrl}/reset-password/${token}`;
      await sendPasswordResetEmail(user.email, resetUrl);

      set.status = 201;
      return {
        ok: true,
        nextAllowedAt: new Date(Date.now() + 60_000).toISOString(),
        remainingToday: Math.max(0, 3 - ((sentToday ?? 0) + 1)),
      };
    },
    {
      body: t.Object({
        email: t.Optional(t.String({ maxLength: 320 })),
        identifier: t.Optional(t.String({ maxLength: 320 })),
      }),
    },
  )
  .post(
    "/password-reset/confirm",
    async (ctx) => {
      const body = ctx.body;
      const set = ctx.set;
      const token = (body.token ?? "").trim();
      const newPassword = (body.newPassword ?? "").trim();
      if (token.length < 10 || newPassword.length < 8) {
        set.status = 400;
        return { ok: false, code: "INVALID_INPUT" };
      }

      const { data: row } = await supabase
        .from("password_reset_tokens")
        .select("*, user:users(*)")
        .eq("token", token)
        .eq("status", "ACTIVE")
        .limit(1)
        .maybeSingle();
      if (!row || row.consumed_at) {
        set.status = 400;
        return { ok: false, code: "TOKEN_INVALID" };
      }
      if (new Date(row.expires_at).getTime() < Date.now()) {
        await supabase
          .from("password_reset_tokens")
          .update({ status: "INACTIVE", updated_by: "system" })
          .eq("id", row.id);
        set.status = 400;
        return { ok: false, code: "TOKEN_EXPIRED" };
      }

      const passwordHash = await hashPassword(newPassword);
      const nowIso = new Date().toISOString();
      await supabase
        .from("password_reset_tokens")
        .update({ consumed_at: nowIso, status: "INACTIVE", updated_by: "system" })
        .eq("id", row.id);
      await supabase
        .from("users")
        .update({ password_hash: passwordHash, updated_by: "system" })
        .eq("id", row.user_id);
      await supabase
        .from("sessions")
        .update({ status: "INACTIVE", revoked_at: nowIso, updated_by: "system" })
        .eq("user_id", row.user_id)
        .eq("status", "ACTIVE");

      return { ok: true };
    },
    {
      body: t.Object({
        token: t.String({ minLength: 10 }),
        newPassword: t.String({ minLength: 8, maxLength: 256 }),
      }),
    },
  )
  .post(
    "/signin",
    async (ctx) => {
      type CookieSession = {
        session: {
          set: (opts: {
            value: string;
            httpOnly: boolean;
            sameSite: "lax" | "none";
            secure: boolean;
            path: string;
            expires: Date;
          }) => void;
        };
      };

      const body = ctx.body;
      const cookie = (ctx as unknown as { cookie: CookieSession }).cookie;
      const set = ctx.set;
      const identifierRaw = (body?.identifier ?? body?.email ?? "").trim();
      const passwordRaw = (body?.password ?? "").trim();
      if (identifierRaw.length < 2 || passwordRaw.length === 0) {
        set.status = 400;
        return { ok: false, code: "INVALID_INPUT" };
      }

      const email = identifierRaw.toLowerCase();
      const username = identifierRaw;
      const usernameLower = identifierRaw.toLowerCase();


      type UserRow = {
        id: string;
        email_verified_at: string | null;
        status: string;
        password_hash: string;
        organization_id: string;
        username: string;
        email: string;
        role: string;
      };
      let user: UserRow | null = null;
      const { data: byEmail } = await supabase
        .from("users")
        .select("id, email_verified_at, status, password_hash, organization_id, username, email, role")
        .eq("email", email)
        .limit(1)
        .maybeSingle();
      user = byEmail;
      if (!user) {
        const { data: byUsername } = await supabase
          .from("users")
          .select("id, email_verified_at, status, password_hash, organization_id, username, email, role")
          .eq("username", username)
          .limit(1)
          .maybeSingle();
        user = byUsername;
      }
      if (!user) {
        const { data: byUsernameLower } = await supabase
          .from("users")
          .select("id, email_verified_at, status, password_hash, organization_id, username, email, role")
          .eq("username", usernameLower)
          .limit(1)
          .maybeSingle();
        user = byUsernameLower;
      }
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
      await supabase.from("sessions").insert({
        user_id: user.id,
        jwt_id: jwtId,
        expires_at: expiresAt.toISOString(),
        status: "ACTIVE",
        created_by: user.id,
        updated_by: user.id,
      });

      const token = await signSessionToken(
        { sub: user.id, org: user.organization_id, jti: jwtId },
        config.jwtSecret,
        30 * 60,
      );

      cookie.session.set({
        value: token,
        httpOnly: true,
        sameSite: config.cookie.sameSite,
        secure: config.cookie.secure,
        path: "/",
        expires: expiresAt,
      });

      return {
        ok: true,
        token,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          organizationId: user.organization_id,
          role: user.role,
        },
      };
    },
    {
      body: t.Object({
        identifier: t.Optional(t.String({ maxLength: 320 })),
        email: t.Optional(t.String({ maxLength: 320 })),
        password: t.Optional(t.String({ maxLength: 256 })),
      }),
    },
  )
  .post("/signout", async ({ cookie, set }) => {
    cookie.session.remove();
    set.status = 204;
  });
