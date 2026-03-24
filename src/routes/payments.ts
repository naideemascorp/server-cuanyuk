import { config } from "../config";
import { supabase } from "../lib/supabase";
import type { AuthUser } from "../lib/types";
import { wsRegistry } from "../lib/ws";
import { Elysia, t } from "elysia";

const parseExpiry = (value: string | null, defaultsToMinutes?: number) => {
  if (!value || value.trim() === "") {
    if (!defaultsToMinutes) return null;
    return new Date(Date.now() + defaultsToMinutes * 60 * 1000).toISOString();
  }
  const v = value.trim().toLowerCase();
  if (v === "lifetime" || v === "none") return null;
  const m = RegExp(/^(\d+)\s*(m|h|d)$/).exec(v);
  if (!m) throw new Error("INVALID_EXPIRATION");
  const n = Number(m[1]);
  const unit = m[2];
  const ms = unit === "m" ? n * 60_000 : unit === "h" ? n * 3_600_000 : n * 86_400_000;
  return new Date(Date.now() + ms).toISOString();
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
    const { data: items } = await supabase
      .from("payment_items")
      .select("id, kind, status, total_amount, payment_url, qris_path, qris_mime, expires_at, created_date, merchant_id")
      .eq("organization_id", authUser.organizationId)
      .in("status", ["ACTIVE", "INACTIVE"])
      .order("created_date", { ascending: false });

    const itemRows = items ?? [];
    const merchantIds = [...new Set(itemRows.map((i: { merchant_id: string }) => i.merchant_id))];
    const { data: merchantsData } = merchantIds.length
      ? await supabase.from("merchants").select("id, name, category").in("id", merchantIds)
      : { data: [] };
    const merchantMap = new Map((merchantsData ?? []).map((m: { id: string; name: string; category: string }) => [m.id, m]));

    const rows = itemRows as Array<{
      id: string;
      kind: "LINK" | "QRIS";
      status: string;
      total_amount: number;
      payment_url: string | null;
      qris_path: string | null;
      qris_mime: string | null;
      expires_at: string | null;
      created_date: string;
      merchant_id: string;
    }>;
    return {
      items: rows.map((i) => {
        const merchant = merchantMap.get(i.merchant_id) ?? { id: i.merchant_id, name: "", category: "" };
        return {
          id: i.id,
          kind: i.kind,
          status: i.status,
          totalAmount: i.total_amount,
          paymentUrl: i.payment_url,
          qrisUrl:
            i.qris_mime || i.qris_path ? `${config.serverPublicBaseUrl}/assets/qris/${i.id}` : null,
          expiresAt: i.expires_at,
          createdDate: i.created_date,
          merchant: { id: merchant.id, name: merchant.name, category: merchant.category },
        };
      }),
    };
  })
  .get("/active", async (ctx) => {
    const authUser = (ctx as unknown as { authUser: AuthUser }).authUser;
    const { data: items } = await supabase
      .from("payment_items")
      .select("id, kind, status, total_amount, payment_url, qris_path, qris_mime, expires_at, created_date, merchant_id")
      .eq("organization_id", authUser.organizationId)
      .eq("status", "ACTIVE")
      .order("created_date", { ascending: false });

    const itemRows = items ?? [];
    const merchantIds = [...new Set(itemRows.map((i: { merchant_id: string }) => i.merchant_id))];
    const { data: merchantsData } = merchantIds.length
      ? await supabase.from("merchants").select("id, name, category").in("id", merchantIds)
      : { data: [] };
    const merchantMap = new Map((merchantsData ?? []).map((m: { id: string; name: string; category: string }) => [m.id, m]));

    const rows = itemRows as Array<{
      id: string;
      kind: "LINK" | "QRIS";
      status: string;
      total_amount: number;
      payment_url: string | null;
      qris_path: string | null;
      qris_mime: string | null;
      expires_at: string | null;
      created_date: string;
      merchant_id: string;
    }>;
    return {
      items: rows.map((i) => {
        const merchant = merchantMap.get(i.merchant_id) ?? { id: i.merchant_id, name: "", category: "" };
        return {
          id: i.id,
          kind: i.kind,
          status: i.status,
          totalAmount: i.total_amount,
          paymentUrl: i.payment_url,
          qrisUrl:
            i.qris_mime || i.qris_path ? `${config.serverPublicBaseUrl}/assets/qris/${i.id}` : null,
          expiresAt: i.expires_at,
          createdDate: i.created_date,
          merchant: { id: merchant.id, name: merchant.name, category: merchant.category },
        };
      }),
    };
  })
  .post(
    "/link",
    async (ctx) => {
      const authUser = (ctx as unknown as { authUser: AuthUser }).authUser;
      const body = ctx.body;
      const set = ctx.set;
      const expiresAt = parseExpiry(body.expiration ?? null, 12 * 60);
      const { data: item } = await supabase
        .from("payment_items")
        .insert({
          organization_id: authUser.organizationId,
          merchant_id: body.merchantId,
          kind: "LINK",
          payment_url: body.paymentUrl.trim(),
          total_amount: Math.max(0, Math.trunc(body.totalAmount)),
          expires_at: expiresAt,
          created_by: authUser.userId,
          updated_by: authUser.userId,
        })
        .select("id")
        .single();
      wsRegistry.broadcast({ type: "items:changed" });
      set.status = 201;
      return { id: item?.id };
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
      const hexData = `\\x${Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("")}`;

      const { data: item } = await supabase
        .from("payment_items")
        .insert({
          organization_id: authUser.organizationId,
          merchant_id: body.merchantId,
          kind: "QRIS",
          qris_path: null,
          qris_mime: mime,
          qris_data: hexData,
          total_amount: Math.max(0, Math.trunc(body.totalAmount)),
          expires_at: expiresAt,
          created_by: authUser.userId,
          updated_by: authUser.userId,
        })
        .select("id")
        .single();
      wsRegistry.broadcast({ type: "items:changed" });
      set.status = 201;
      return { id: item?.id };
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
      await supabase
        .from("payment_items")
        .update({ status: "INACTIVE", inactivated_at: new Date().toISOString(), updated_by: authUser.userId })
        .eq("id", params.id)
        .eq("organization_id", authUser.organizationId);
      wsRegistry.broadcast({ type: "items:changed" });
      set.status = 204;
    },
    { params: t.Object({ id: t.String() }) },
  );
