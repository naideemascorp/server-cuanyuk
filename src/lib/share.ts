import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config";

const b64url = (buf: Buffer) =>
  buf.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");

export const makeShareToken = (organizationId: string) => {
  const sig = createHmac("sha256", config.jwtSecret).update(`share:${organizationId}`).digest();
  return `${organizationId}.${b64url(sig).slice(0, 32)}`;
};

export const verifyShareToken = (token: string) => {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [organizationId, sigPart] = parts;
  if (!organizationId || !sigPart) return null;

  const expected = createHmac("sha256", config.jwtSecret)
    .update(`share:${organizationId}`)
    .digest();
  const expectedPart = b64url(expected).slice(0, 32);

  const a = Buffer.from(expectedPart);
  const b = Buffer.from(sigPart);
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;

  return { organizationId };
};
