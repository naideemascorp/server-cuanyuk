import { config } from "../config";
import { sendSmtpMail } from "./smtp";

const baseEmailHtml = (opts: {
  title: string;
  preview: string;
  heading: string;
  bodyHtml: string;
  buttonText: string;
  buttonUrl: string;
}) => {
  const { title, preview, heading, bodyHtml, buttonText, buttonUrl } = opts;
  const safeUrl = buttonUrl.replaceAll('"', "%22");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <meta name="supported-color-schemes" content="light" />
    <title>${title}</title>
  </head>
  <body style="margin:0;padding:0;background:#f4f5f7;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;color:#1a1a2e;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${preview}</div>
    <div style="padding:28px 16px;">
      <div style="max-width:640px;margin:0 auto;border-radius:22px;overflow:hidden;border:1px solid rgba(0,0,0,.08);background:#ffffff;box-shadow:0 4px 24px rgba(0,0,0,.06)">
        <div style="padding:18px 18px 0">
          <div style="height:10px;border-radius:999px;background:linear-gradient(90deg,#e06caf,#7c6cff,#4cd6a0)"></div>
        </div>
        <div style="padding:18px 22px 22px">
          <div style="font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#7c6cff;font-weight:700">Cuan Yuk!</div>
          <h1 style="margin:10px 0 0;font-size:26px;letter-spacing:-.02em;color:#1a1a2e">${heading}</h1>
          <div style="margin-top:12px;font-size:15px;line-height:1.6;color:#4a4a5a">${bodyHtml}</div>
          <div style="margin-top:18px">
            <a href="${safeUrl}" style="display:inline-block;text-decoration:none;padding:12px 20px;border-radius:14px;background:linear-gradient(135deg,#7c6cff,#4cd6a0);color:#ffffff;font-weight:800;letter-spacing:-.01em;font-size:15px">${buttonText}</a>
          </div>
          <div style="margin-top:16px;font-size:12.5px;line-height:1.55;color:#8a8a9a">
            If the button doesn't work, open this link:<br />
            <a href="${safeUrl}" style="color:#7c6cff">${safeUrl}</a>
          </div>
        </div>
      </div>
      <div style="max-width:640px;margin:14px auto 0;text-align:center;font-size:12px;color:#8a8a9a">
        ${new Date().getFullYear()} &copy; Cuan Yuk!
      </div>
    </div>
  </body>
</html>`;
};

export const sendEmailVerification = async (to: string, verificationUrl: string) => {
  await sendSmtpMail(
    {
      host: config.smtp.host,
      port: config.smtp.port,
      user: config.smtp.user,
      pass: config.smtp.pass,
    },
    {
      from: config.smtp.from,
      to,
      subject: "Verify your email",
      text: `Verify your email: ${verificationUrl}`,
      html: baseEmailHtml({
        title: "Verify your email",
        preview: "Verify your email to activate your account.",
        heading: "Verify your email",
        bodyHtml: "Tap the button below to verify your email and activate your account.",
        buttonText: "Verify Email",
        buttonUrl: verificationUrl,
      }),
    },
  );
};

export const sendPasswordResetEmail = async (to: string, resetUrl: string) => {
  await sendSmtpMail(
    {
      host: config.smtp.host,
      port: config.smtp.port,
      user: config.smtp.user,
      pass: config.smtp.pass,
    },
    {
      from: config.smtp.from,
      to,
      subject: "Reset your password",
      text: `Reset your password: ${resetUrl}`,
      html: baseEmailHtml({
        title: "Reset your password",
        preview: "Use this link to reset your password (expires in 1 day).",
        heading: "Reset your password",
        bodyHtml: "We received a request to reset your password. This link expires in 1 day.",
        buttonText: "Reset Password",
        buttonUrl: resetUrl,
      }),
    },
  );
};
