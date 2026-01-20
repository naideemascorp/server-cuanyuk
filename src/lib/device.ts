export const getDeviceIdFromContext = (ctx: { request: Request }) => {
  const raw = ctx.request.headers.get("x-device-id");
  if (!raw) return null;
  const v = raw.trim();
  if (!v) return null;
  if (!/^[a-z0-9-]{8,120}$/i.test(v)) return null;
  return v;
};
