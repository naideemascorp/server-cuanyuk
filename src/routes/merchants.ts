import { config } from "@/config";
import { prisma } from "@/lib/prisma";
import type { AuthUser } from "@/lib/types";
import { Elysia, t } from "elysia";

const decodeBase64 = (b64: string) => {
  const bytes = Uint8Array.from(atob(b64), (c) => c.codePointAt(0) ?? 0);
  return bytes;
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

export const merchantRoutes = new Elysia({ prefix: "/merchants" })
  .get("/", async (ctx) => {
    const authUser = (ctx as unknown as { authUser: AuthUser }).authUser;
    const merchants = await prisma.merchant.findMany({
      where: { organization_id: authUser.organizationId, status: "ACTIVE" },
      orderBy: [{ category: "asc" }, { sort_order: "asc" }, { name: "asc" }],
      select: { id: true, name: true, category: true, picture_path: true, picture_mime: true },
    });
    const rows = merchants as Array<{
      id: string;
      name: string;
      category: string;
      picture_path: string | null;
      picture_mime: string | null;
    }>;
    return {
      merchants: rows.map((m) => ({
        id: m.id,
        name: m.name,
        category: m.category,
        pictureUrl:
          m.picture_mime || m.picture_path
            ? `${config.serverPublicBaseUrl}/assets/merchant/${m.id}`
            : null,
      })),
    };
  })
  .post(
    "/",
    async (ctx) => {
      const authUser = (ctx as unknown as { authUser: AuthUser }).authUser;
      const body = ctx.body;
      const set = ctx.set;
      let picture_path: string | null = null;
      let picture_mime: string | null = null;
      let picture_data: Uint8Array<ArrayBuffer> | null = null;
      if (body.imageBase64 && body.imageBase64.trim() !== "") {
        const bytes = decodeBase64(body.imageBase64.trim());
        if (bytes.length > 3_000_000) throw new Error("IMAGE_TOO_LARGE");
        const ext = sniffExt(bytes);
        picture_mime = extToMime(ext);
        const ab = bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer;
        picture_data = new Uint8Array(ab);
        picture_path = null;
      }
      const merchant = await prisma.merchant.create({
        data: {
          organization_id: authUser.organizationId,
          name: body.name.trim(),
          category: body.category.trim() || "General",
          picture_path,
          picture_mime,
          picture_data,
          created_by: authUser.userId,
          updated_by: authUser.userId,
        },
      });
      set.status = 201;
      return {
        merchant: {
          id: merchant.id,
          name: merchant.name,
          category: merchant.category,
          pictureUrl:
            merchant.picture_mime || merchant.picture_path
              ? `${config.serverPublicBaseUrl}/assets/merchant/${merchant.id}`
              : null,
        },
      };
    },
    {
      body: t.Object({
        name: t.String({ minLength: 2, maxLength: 120 }),
        category: t.String({ minLength: 0, maxLength: 80 }),
        imageBase64: t.Optional(t.String({ minLength: 32 })),
      }),
    },
  )
  .delete(
    "/:id",
    async (ctx) => {
      const authUser = (ctx as unknown as { authUser: AuthUser }).authUser;
      const params = ctx.params;
      const set = ctx.set;
      await prisma.merchant.updateMany({
        where: { id: params.id, organization_id: authUser.organizationId },
        data: { status: "DELETED", updated_by: authUser.userId },
      });
      set.status = 204;
    },
    { params: t.Object({ id: t.String() }) },
  );
