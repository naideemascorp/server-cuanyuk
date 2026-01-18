import { Elysia, t } from "elysia";
import { config } from "../config";
import { prisma } from "../lib/prisma";
import { storeUpload } from "../lib/storage";
import { wsRegistry } from "../lib/ws";

const parseExpiry = (value: string | null, defaultsToMinutes?: number) => {
  if (!value || value.trim() === "") {
    if (!defaultsToMinutes) return null;
    return new Date(Date.now() + defaultsToMinutes * 60 * 1000);
  }
  const v = value.trim().toLowerCase();
  if (v === "lifetime" || v === "none") return null;
  const m = v.match(/^(\d+)\s*(m|h|d)$/);
  if (!m) throw new Error("INVALID_EXPIRATION");
  const n = Number(m[1]);
  const unit = m[2];
  const ms = unit === "m" ? n * 60_000 : unit === "h" ? n * 3_600_000 : n * 86_400_000;
  return new Date(Date.now() + ms);
};

export const paymentRoutes = new Elysia({ prefix: "/payments" })
  .get("/all", async (ctx) => {
    const authUser = (ctx as any).authUser as { userId: string; organizationId: string };
    const items = await prisma.paymentItem.findMany({
      where: { organization_id: authUser.organizationId, status: { in: ["ACTIVE", "INACTIVE"] } },
      orderBy: [{ created_date: "desc" }],
      include: { merchant: true }
    });
    return {
      items: items.map((i: any) => ({
        id: i.id,
        kind: i.kind,
        status: i.status,
        totalAmount: i.total_amount,
        paymentUrl: i.payment_url,
        qrisUrl: i.qris_path ? `${config.serverPublicBaseUrl}/uploads/${i.qris_path}` : null,
        expiresAt: i.expires_at,
        createdDate: i.created_date,
        merchant: { id: i.merchant.id, name: i.merchant.name, category: i.merchant.category }
      }))
    };
  })
  .get("/active", async (ctx) => {
    const authUser = (ctx as any).authUser as { userId: string; organizationId: string };
    const items = await prisma.paymentItem.findMany({
      where: { organization_id: authUser.organizationId, status: "ACTIVE" },
      orderBy: [{ created_date: "desc" }],
      include: { merchant: true }
    });
    return {
      items: items.map((i: any) => ({
        id: i.id,
        kind: i.kind,
        status: i.status,
        totalAmount: i.total_amount,
        paymentUrl: i.payment_url,
        qrisUrl: i.qris_path ? `${config.serverPublicBaseUrl}/uploads/${i.qris_path}` : null,
        expiresAt: i.expires_at,
        createdDate: i.created_date,
        merchant: { id: i.merchant.id, name: i.merchant.name, category: i.merchant.category }
      }))
    };
  })
  .post(
    "/link",
    async (ctx) => {
      const authUser = (ctx as any).authUser as { userId: string; organizationId: string };
      const body = (ctx as any).body as { merchantId: string; paymentUrl: string; totalAmount: number; expiration?: string };
      const set = (ctx as any).set as { status: number };
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
          updated_by: authUser.userId
        }
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
        expiration: t.Optional(t.String({ maxLength: 20 }))
      })
    }
  )
  .post(
    "/qris",
    async (ctx) => {
      const authUser = (ctx as any).authUser as { userId: string; organizationId: string };
      const body = (ctx as any).body as { merchantId: string; imageBase64: string; totalAmount: number; expiration?: string };
      const set = (ctx as any).set as { status: number };
      const expiresAt = parseExpiry(body.expiration ?? null, 12 * 60);
      const b64 = body.imageBase64;
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const stored = await storeUpload(bytes, "png");

      const item = await prisma.paymentItem.create({
        data: {
          organization_id: authUser.organizationId,
          merchant_id: body.merchantId,
          kind: "QRIS",
          qris_path: stored.filename,
          total_amount: Math.max(0, Math.trunc(body.totalAmount)),
          expires_at: expiresAt,
          created_by: authUser.userId,
          updated_by: authUser.userId
        }
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
        expiration: t.Optional(t.String({ maxLength: 20 }))
      })
    }
  )
  .post(
    "/deactivate/:id",
    async (ctx) => {
      const authUser = (ctx as any).authUser as { userId: string; organizationId: string };
      const params = (ctx as any).params as { id: string };
      const set = (ctx as any).set as { status: number };
      await prisma.paymentItem.updateMany({
        where: { id: params.id, organization_id: authUser.organizationId },
        data: { status: "INACTIVE", inactivated_at: new Date(), updated_by: authUser.userId }
      });
      wsRegistry.broadcast({ type: "items:changed" });
      set.status = 204;
      return;
    },
    { params: t.Object({ id: t.String() }) }
  );
