const required = (key: string): string => {
  const value = process.env[key];
  if (!value) throw new Error(`Missing env: ${key}`);
  return value;
};

export const config = {
  databaseUrl: required("DATABASE_URL"),
  databaseSchema: process.env.DATABASE_SCHEMA ?? "public",
  appPublicBaseUrl: required("APP_PUBLIC_BASE_URL"),
  serverPublicBaseUrl: required("SERVER_PUBLIC_BASE_URL"),
  jwtSecret: required("JWT_SECRET"),
  smtp: {
    host: required("SMTP_HOST"),
    port: Number(required("SMTP_PORT")),
    user: required("SMTP_USER"),
    pass: required("SMTP_PASS"),
    from: required("MAIL_FROM")
  },
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN
};
