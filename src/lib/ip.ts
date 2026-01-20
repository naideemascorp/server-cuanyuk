const stripPort = (ip: string) => {
  const raw = ip.trim();
  if (!raw) return "";
  const unquoted = raw.replace(/^"|"$/g, "");
  const bracketMatch = unquoted.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracketMatch) return bracketMatch[1] ?? "";
  const v4WithPort = unquoted.match(/^(\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?$/);
  if (v4WithPort) return v4WithPort[1] ?? "";
  return unquoted;
};

const normalizeIp = (raw: string) => {
  const s = stripPort(raw);
  const m = s.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  return (m?.[1] ?? s).trim();
};

const isIPv4 = (ip: string) => /^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip);

const parseIPv4 = (ip: string) => {
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4) return null;
  for (const p of parts) if (!Number.isInteger(p) || p < 0 || p > 255) return null;
  return parts as [number, number, number, number];
};

const isPrivateOrReserved = (ipRaw: string) => {
  const ip = normalizeIp(ipRaw);
  if (!ip) return true;
  if (ip === "0.0.0.0") return true;

  if (isIPv4(ip)) {
    const p = parseIPv4(ip);
    if (!p) return true;
    const [a, b] = p;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
  }

  const s = ip.toLowerCase();
  if (s === "::1") return true;
  if (s.startsWith("fe80:")) return true;
  if (s.startsWith("fc") || s.startsWith("fd")) return true;
  return false;
};

const parseForwarded = (headers: Headers) => {
  const fwd = headers.get("forwarded");
  if (!fwd) return [];
  const parts = fwd.split(",").map((s) => s.trim());
  const out: string[] = [];
  for (const p of parts) {
    const m = p.match(/for=(?:"?\[?([^;\]"]+)\]?"?)/i);
    if (m?.[1]) out.push(m[1]);
  }
  return out;
};

export const getClientIp = (headers: Headers, fallback?: string | null) => {
  const candidates: string[] = [];
  const cf = headers.get("cf-connecting-ip");
  if (cf) candidates.push(cf);
  const trueClient = headers.get("true-client-ip");
  if (trueClient) candidates.push(trueClient);
  const realIp = headers.get("x-real-ip");
  if (realIp) candidates.push(realIp);
  const xff = headers.get("x-forwarded-for");
  if (xff)
    candidates.push(
      ...xff
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
  candidates.push(...parseForwarded(headers));

  const normalized = candidates.map(normalizeIp).filter(Boolean);
  const best = normalized.find((ip) => !isPrivateOrReserved(ip));
  return best ?? normalized[0] ?? fallback ?? "0.0.0.0";
};

type RequestIPServer = {
  requestIP?: (req: Request) => { address?: string } | null | undefined;
};

export const getClientIpFromContext = (ctx: { request: Request; server?: unknown }) => {
  const headersIp = getClientIp(ctx.request.headers, null);
  if (headersIp && headersIp !== "0.0.0.0") return headersIp;

  const server = ctx.server as RequestIPServer | undefined;
  if (server?.requestIP) {
    const ip = server.requestIP(ctx.request);
    if (ip?.address) return ip.address;
  }

  return "0.0.0.0";
};
