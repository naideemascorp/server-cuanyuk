import { config } from "@/config";
import { prisma } from "@/lib/prisma";
import type { AuthUser } from "@/lib/types";
import { wsRegistry } from "@/lib/ws";
import { Elysia, t } from "elysia";

const parseExpiry = (value: string | null, defaultsToMinutes?: number) => {
  if (!value || value.trim() === "") {
    if (!defaultsToMinutes) return null;
    return new Date(Date.now() + defaultsToMinutes * 60 * 1000);
  }
  const v = value.trim().toLowerCase();
  if (v === "lifetime" || v === "none") return null;
  const m = RegExp(/^(\d+)\s*(m|h|d)$/).exec(v);
  if (!m) throw new Error("INVALID_EXPIRATION");
  const n = Number(m[1]);
  const unit = m[2];
  const ms = unit === "m" ? n * 60_000 : unit === "h" ? n * 3_600_000 : n * 86_400_000;
  return new Date(Date.now() + ms);
};

const sniffExt = (bytes: Uint8Array) => {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  )
    return "png";
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) return "jpg";
  if (bytes.length >= 6) {
    const h = String.fromCodePoint(bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5]);
    if (h === "GIF87a" || h === "GIF89a") return "gif";
  }
  return "png";
};

const extToMime = (ext: string) => {
  if (ext === "jpg") return "image/jpeg";
  if (ext === "gif") return "image/gif";
  return "image/png";
};

export const paymentRoutes = new Elysia({ prefix: "/payments" })
  .get("/all", async (ctx) => {
    const authUser = (ctx as unknown as { authUser: AuthUser }).authUser;
    const items = await prisma.paymentItem.findMany({
      where: { organization_id: authUser.organizationId, status: { in: ["ACTIVE", "INACTIVE"] } },
      orderBy: [{ created_date: "desc" }],
      select: {
        id: true,
        kind: true,
        status: true,
        total_amount: true,
        payment_url: true,
        qris_path: true,
        qris_mime: true,
        expires_at: true,
        created_date: true,
        merchant: { select: { id: true, name: true, category: true } },
      },
    });
    const rows = items as Array<{
      id: string;
      kind: "LINK" | "QRIS";
      status: string;
      total_amount: number;
      payment_url: string | null;
      qris_path: string | null;
      qris_mime: string | null;
      expires_at: Date | null;
      created_date: Date;
      merchant: { id: string; name: string; category: string };
    }>;
    return {
      items: rows.map((i) => ({
        id: i.id,
        kind: i.kind,
        status: i.status,
        totalAmount: i.total_amount,
        paymentUrl: i.payment_url,
        qrisUrl:
          i.qris_mime || i.qris_path ? `${config.serverPublicBaseUrl}/assets/qris/${i.id}` : null,
        expiresAt: i.expires_at,
        createdDate: i.created_date,
        merchant: { id: i.merchant.id, name: i.merchant.name, category: i.merchant.category },
      })),
    };
  })
  .get("/active", async (ctx) => {
    const authUser = (ctx as unknown as { authUser: AuthUser }).authUser;
    const items = await prisma.paymentItem.findMany({
      where: { organization_id: authUser.organizationId, status: "ACTIVE" },
      orderBy: [{ created_date: "desc" }],
      select: {
        id: true,
        kind: true,
        status: true,
        total_amount: true,
        payment_url: true,
        qris_path: true,
        qris_mime: true,
        expires_at: true,
        created_date: true,
        merchant: { select: { id: true, name: true, category: true } },
      },
    });
    const rows = items as Array<{
      id: string;
      kind: "LINK" | "QRIS";
      status: string;
      total_amount: number;
      payment_url: string | null;
      qris_path: string | null;
      qris_mime: string | null;
      expires_at: Date | null;
      created_date: Date;
      merchant: { id: string; name: string; category: string };
    }>;
    return {
      items: rows.map((i) => ({
        id: i.id,
        kind: i.kind,
        status: i.status,
        totalAmount: i.total_amount,
        paymentUrl: i.payment_url,
        qrisUrl:
          i.qris_mime || i.qris_path ? `${config.serverPublicBaseUrl}/assets/qris/${i.id}` : null,
        expiresAt: i.expires_at,
        createdDate: i.created_date,
        merchant: { id: i.merchant.id, name: i.merchant.name, category: i.merchant.category },
      })),
    };
  })
  .post(
    "/link",
    async (ctx) => {
      const authUser = (ctx as unknown as { authUser: AuthUser }).authUser;
      const body = ctx.body;
      const set = ctx.set;
      const expiresAt = parseExpiry(body.expiration ?? null, 12 * 60);
      const item = await prisma.paymentItem.create({
        data: {
          organization_id: authUser.organizationId,
          merchant_id: body.merchantId,
          kind: "LINK",
          payment_url: body.paymentUrl.trim(),
          total_amount: Math.max(0, Math.trunc(body.totalAmount)),
          expires_at: expiresAt,
          created_by: authUser.userId,
          updated_by: authUser.userId,
        },
      });
      wsRegistry.broadcast({ type: "items:changed" });
      set.status = 201;
      return { id: item.id };
    },
    {
      body: t.Object({
        merchantId: t.String({ minLength: 1 }),
        paymentUrl: t.String({ minLength: 8, maxLength: 2048 }),
        totalAmount: t.Number({ minimum: 0, maximum: 2_000_000_000 }),
        expiration: t.Optional(t.String({ maxLength: 20 })),
      }),
    },
  )
  .post(
    "/qris",
    async (ctx) => {
      const authUser = (ctx as unknown as { authUser: AuthUser }).authUser;
      const body = ctx.body;
      const set = ctx.set;
      const expiresAt = parseExpiry(body.expiration ?? null, 12 * 60);
      const b64 = body.imageBase64;
      const bytes = Uint8Array.from(atob(b64), (c) => c.codePointAt(0) ?? 0);
      if (bytes.length > 3_000_000) throw new Error("IMAGE_TOO_LARGE");
      const ext = sniffExt(bytes);
      const mime = extToMime(ext);
      const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      const data = new Uint8Array(ab);

      const item = await prisma.paymentItem.create({
        data: {
          organization_id: authUser.organizationId,
          merchant_id: body.merchantId,
          kind: "QRIS",
          qris_path: null,
          qris_mime: mime,
          qris_data: data,
          total_amount: Math.max(0, Math.trunc(body.totalAmount)),
          expires_at: expiresAt,
          created_by: authUser.userId,
          updated_by: authUser.userId,
        },
      });
      wsRegistry.broadcast({ type: "items:changed" });
      set.status = 201;
      return { id: item.id };
    },
    {
      body: t.Object({
        merchantId: t.String({ minLength: 1 }),
        imageBase64: t.String({ minLength: 64 }),
        totalAmount: t.Number({ minimum: 0, maximum: 2_000_000_000 }),
        expiration: t.Optional(t.String({ maxLength: 20 })),
      }),
    },
  )
  .post(
    "/deactivate/:id",
    async (ctx) => {
      const authUser = (ctx as unknown as { authUser: AuthUser }).authUser;
      const params = ctx.params;
      const set = ctx.set;
      await prisma.paymentItem.updateMany({
        where: { id: params.id, organization_id: authUser.organizationId },
        data: { status: "INACTIVE", inactivated_at: new Date(), updated_by: authUser.userId },
      });
      wsRegistry.broadcast({ type: "items:changed" });
      set.status = 204;
    },
    { params: t.Object({ id: t.String() }) },
  );
