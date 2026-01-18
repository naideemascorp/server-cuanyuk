import { Elysia, t } from "elysia";
import { config } from "../config";
import { prisma } from "../lib/prisma";
import { storeUpload } from "../lib/storage";

const decodeBase64 = (b64: string) => {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return bytes;
};

const sniffExt = (bytes: Uint8Array) => {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) return "jpg";
  if (bytes.length >= 6) {
    const h = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5]);
    if (h === "GIF87a" || h === "GIF89a") return "gif";
  }
  return "png";
};

export const merchantRoutes = new Elysia({ prefix: "/merchants" })
  .get("/", async (ctx) => {
    const authUser = (ctx as any).authUser as { userId: string; organizationId: string };
    const merchants = await prisma.merchant.findMany({
      where: { organization_id: authUser.organizationId, status: "ACTIVE" },
      orderBy: [{ category: "asc" }, { sort_order: "asc" }, { name: "asc" }]
    });
    return {
      merchants: merchants.map((m: any) => ({
        id: m.id,
        name: m.name,
        category: m.category,
        pictureUrl: m.picture_path ? `${config.serverPublicBaseUrl}/uploads/${m.picture_path}` : null
      }))
    };
  })
  .post(
    "/",
    async (ctx) => {
      const authUser = (ctx as any).authUser as { userId: string; organizationId: string };
      const body = (ctx as any).body as { name: string; category: string; imageBase64?: string };
      const set = (ctx as any).set as { status: number };
      let picture_path: string | null = null;
      if (body.imageBase64 && body.imageBase64.trim() !== "") {
        const bytes = decodeBase64(body.imageBase64.trim());
        if (bytes.length > 3_000_000) throw new Error("IMAGE_TOO_LARGE");
        const ext = sniffExt(bytes);
        const stored = await storeUpload(bytes, ext);
        picture_path = stored.filename;
      }
      const merchant = await prisma.merchant.create({
        data: {
          organization_id: authUser.organizationId,
          name: body.name.trim(),
          category: body.category.trim() || "General",
          picture_path,
          created_by: authUser.userId,
          updated_by: authUser.userId
        }
      });
      set.status = 201;
      return {
        merchant: {
          id: merchant.id,
          name: merchant.name,
          category: merchant.category,
          pictureUrl: merchant.picture_path ? `${config.serverPublicBaseUrl}/uploads/${merchant.picture_path}` : null
        }
      };
    },
    {
      body: t.Object({
        name: t.String({ minLength: 2, maxLength: 120 }),
        category: t.String({ minLength: 0, maxLength: 80 }),
        imageBase64: t.Optional(t.String({ minLength: 32 }))
      })
    }
  )
  .delete(
    "/:id",
    async (ctx) => {
      const authUser = (ctx as any).authUser as { userId: string; organizationId: string };
      const params = (ctx as any).params as { id: string };
      const set = (ctx as any).set as { status: number };
      await prisma.merchant.updateMany({
        where: { id: params.id, organization_id: authUser.organizationId },
        data: { status: "DELETED", updated_by: authUser.userId }
      });
      set.status = 204;
      return;
    },
    { params: t.Object({ id: t.String() }) }
  );
