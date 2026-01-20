import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const uploadsDir = join(process.cwd(), "uploads");

export const ensureUploadsDir = async () => {
  await mkdir(uploadsDir, { recursive: true });
};

export const storeUpload = async (bytes: Uint8Array, ext: string) => {
  await ensureUploadsDir();
  const safeExt = ext.startsWith(".") ? ext : `.${ext}`;
  const filename = `${randomUUID()}${safeExt}`;
  const absolutePath = join(uploadsDir, filename);
  await writeFile(absolutePath, bytes);
  return { filename, absolutePath };
};

export const resolveUploadPath = (filename: string) => join(uploadsDir, filename);
