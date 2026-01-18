import nodemailer from "nodemailer";
import { config } from "../config";

export const mailer = nodemailer.createTransport({
  host: config.smtp.host,
  port: config.smtp.port,
  auth: {
    user: config.smtp.user,
    pass: config.smtp.pass
  }
});

const baseEmailHtml = (opts: { title: string; preview: string; heading: string; bodyHtml: string; buttonText: string; buttonUrl: string }) => {
  const { title, preview, heading, bodyHtml, buttonText, buttonUrl } = opts;
  const safeUrl = buttonUrl.replaceAll('"', "%22");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${title}</title>
  </head>
  <body style="margin:0;padding:0;background:#0b0e16;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;color:#fafaff;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${preview}</div>
    <div style="padding:28px 16px;">
      <div style="max-width:640px;margin:0 auto;border-radius:22px;overflow:hidden;border:1px solid rgba(255,255,255,.14);background:linear-gradient(180deg,rgba(22,30,52,.86),rgba(12,14,22,.76));box-shadow:0 24px 70px rgba(0,0,0,.55)">
        <div style="padding:18px 18px 0">
          <div style="height:10px;border-radius:999px;background:linear-gradient(90deg,rgba(255,124,207,.85),rgba(157,124,255,.85),rgba(124,255,214,.85))"></div>
        </div>
        <div style="padding:18px 22px 22px">
          <div style="font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:rgba(250,250,255,.62)">Cuan Yuk!</div>
          <h1 style="margin:10px 0 0;font-size:26px;letter-spacing:-.02em">${heading}</h1>
          <div style="margin-top:12px;font-size:15px;line-height:1.6;color:rgba(250,250,255,.78)">${bodyHtml}</div>
          <div style="margin-top:18px">
            <a href="${safeUrl}" style="display:inline-block;text-decoration:none;padding:12px 16px;border-radius:14px;border:1px solid rgba(255,255,255,.18);background:radial-gradient(circle at 15% 20%,rgba(255,124,207,.28),transparent 58%),radial-gradient(circle at 85% 30%,rgba(124,255,214,.2),transparent 58%),linear-gradient(135deg,rgba(157,124,255,.26),rgba(255,255,255,.06));color:#fafaff;font-weight:800;letter-spacing:-.01em">${buttonText}</a>
          </div>
          <div style="margin-top:16px;font-size:12.5px;line-height:1.55;color:rgba(250,250,255,.62)">
            If the button doesn’t work, open this link:<br />
            <a href="${safeUrl}" style="color:rgba(124,255,214,.92)">${safeUrl}</a>
          </div>
        </div>
      </div>
      <div style="max-width:640px;margin:14px auto 0;text-align:center;font-size:12px;color:rgba(250,250,255,.52)">
        ${new Date().getFullYear()} © Cuan Yuk!
      </div>
    </div>
  </body>
</html>`;
};

export const sendEmailVerification = async (to: string, verificationUrl: string) => {
  await mailer.sendMail({
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
      buttonUrl: verificationUrl
    })
  });
};

export const sendPasswordResetEmail = async (to: string, resetUrl: string) => {
  await mailer.sendMail({
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
      buttonUrl: resetUrl
    })
  });
};
