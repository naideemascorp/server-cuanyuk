const encodeBase64Url = (bytes: Uint8Array) =>
  Buffer.from(bytes)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");

const decodeBase64Url = (s: string): Uint8Array => {
  const padded = s
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(s.length / 4) * 4, "=");
  return new Uint8Array(Buffer.from(padded, "base64"));
};

const text = new TextEncoder();

const hmacSha256 = async (secret: string, input: string): Promise<Uint8Array> => {
  const key = await crypto.subtle.importKey(
    "raw",
    text.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, text.encode(input));
  return new Uint8Array(sig);
};

export type SessionTokenPayload = {
  sub: string;
  org: string;
  jti: string;
  exp: number;
};

export const signSessionToken = async (
  payload: Omit<SessionTokenPayload, "exp">,
  secret: string,
  expiresInSeconds: number,
) => {
  const header = { alg: "HS256", typ: "JWT" } as const;
  const full: SessionTokenPayload = {
    ...payload,
    exp: Math.trunc(Date.now() / 1000) + Math.trunc(expiresInSeconds),
  };

  const headerB64 = encodeBase64Url(text.encode(JSON.stringify(header)));
  const payloadB64 = encodeBase64Url(text.encode(JSON.stringify(full)));
  const signingInput = `${headerB64}.${payloadB64}`;
  const sig = await hmacSha256(secret, signingInput);
  const sigB64 = encodeBase64Url(sig);
  return `${signingInput}.${sigB64}`;
};

export const verifySessionToken = async (
  token: string,
  secret: string,
): Promise<SessionTokenPayload | null> => {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  if (!h || !p || !s) return null;

  const signingInput = `${h}.${p}`;
  const expected = await hmacSha256(secret, signingInput);
  const actual = decodeBase64Url(s);
  if (actual.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  if (diff !== 0) return null;

  try {
    const decoded = JSON.parse(Buffer.from(decodeBase64Url(p)).toString("utf8")) as unknown;
    if (!decoded || typeof decoded !== "object") return null;
    const rec = decoded as Record<string, unknown>;
    const sub = typeof rec.sub === "string" ? rec.sub : null;
    const org = typeof rec.org === "string" ? rec.org : null;
    const jti = typeof rec.jti === "string" ? rec.jti : null;
    const exp = typeof rec.exp === "number" ? rec.exp : null;
    if (!sub || !org || !jti || !exp) return null;
    if (Math.trunc(Date.now() / 1000) >= exp) return null;
    return { sub, org, jti, exp };
  } catch {
    return null;
  }
};
