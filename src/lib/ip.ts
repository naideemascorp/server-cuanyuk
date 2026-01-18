export const getClientIp = (headers: Headers, fallback?: string | null) => {
  const xff = headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() ?? fallback ?? "0.0.0.0";
  const realIp = headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return fallback ?? "0.0.0.0";
};

export const getClientIpFromContext = (ctx: { request: Request; server?: any }) => {
  const headersIp = getClientIp(ctx.request.headers, null);
  if (headersIp && headersIp !== "0.0.0.0") return headersIp;

  const server = ctx.server;
  if (server?.requestIP) {
    const ip = server.requestIP(ctx.request);
    if (ip?.address) return ip.address;
  }

  return "0.0.0.0";
};
