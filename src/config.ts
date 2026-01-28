const required = (key: string): string => {
  const value = process.env[key];
  if (!value) throw new Error(`Missing env: ${key}`);
  return value;
};

const maybeUrl = (raw: string): URL | null => {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
};

const normalizeOrigin = (raw: string): string | null => {
  const u = maybeUrl(raw);
  if (!u) return null;
  return `${u.protocol}//${u.host}`;
};

const toggleWww = (origin: string): string | null => {
  const u = maybeUrl(origin);
  if (!u) return null;
  const host = u.host;
  const nextHost = host.startsWith("www.") ? host.slice(4) : `www.${host}`;
  return `${u.protocol}//${nextHost}`;
};

const computeCorsOrigins = (appPublicBaseUrl: string): Array<string | RegExp> => {
  const base = normalizeOrigin(appPublicBaseUrl);
  const rawExtra = (process.env.CORS_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(normalizeOrigin)
    .filter((x): x is string => Boolean(x));

  const set = new Set<string>();
  if (base) set.add(base);
  if (base) {
    const alt = toggleWww(base);
    if (alt) set.add(alt);
  }
  for (const o of rawExtra) set.add(o);
  const tauriAndLocalOrigins: RegExp[] = [
    /^tauri:\/\/localhost$/i,
    /^https?:\/\/tauri\.localhost(?::\d+)?$/i,
    /^https?:\/\/localhost(?::\d+)?$/i,
    /^https?:\/\/127\.0\.0\.1(?::\d+)?$/i,
  ];
  return [...Array.from(set), ...tauriAndLocalOrigins];
};

const computeCookiePolicy = (appPublicBaseUrl: string, serverPublicBaseUrl: string) => {
  const app = maybeUrl(appPublicBaseUrl);
  const srv = maybeUrl(serverPublicBaseUrl);
  const appIsHttps = app?.protocol === "https:";
  const crossSite = Boolean(app?.hostname && srv?.hostname && app.hostname !== srv.hostname);
  const sameSite: "lax" | "none" = crossSite ? "none" : "lax";
  const secure = sameSite === "none" ? Boolean(appIsHttps) : false;
  return { sameSite, secure };
};

export const config = {
  databaseUrl: required("DATABASE_URL"),
  databaseSchema: process.env.DATABASE_SCHEMA ?? "public",
  appPublicBaseUrl: required("APP_PUBLIC_BASE_URL"),
  serverPublicBaseUrl: required("SERVER_PUBLIC_BASE_URL"),
  corsOrigins: computeCorsOrigins(required("APP_PUBLIC_BASE_URL")),
  cookie: computeCookiePolicy(required("APP_PUBLIC_BASE_URL"), required("SERVER_PUBLIC_BASE_URL")),
  jwtSecret: required("JWT_SECRET"),
  smtp: {
    host: required("SMTP_HOST"),
    port: Number(required("SMTP_PORT")),
    user: required("SMTP_USER"),
    pass: required("SMTP_PASS"),
    from: required("MAIL_FROM"),
  },
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
};
