import { PrismaClient } from "@prisma/client";
import { config } from "../config";

const withSchema = (raw: string, schema: string) => {
  const url = new URL(raw);
  url.searchParams.set("schema", schema);
  return url.toString();
};

export const prisma = new PrismaClient({
  log: ["error", "warn"],
  datasources: { db: { url: withSchema(config.databaseUrl, config.databaseSchema) } }
});
