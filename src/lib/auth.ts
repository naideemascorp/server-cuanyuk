import bcrypt from "bcryptjs";
import { prisma } from "./prisma";

export const hashPassword = async (plain: string) => bcrypt.hash(plain, 12);

export const verifyPassword = async (plain: string, hash: string) => bcrypt.compare(plain, hash);

export const assertLoginAllowed = (user: { email_verified_at: Date | null; status: string }) => {
  if (!user.email_verified_at) throw new Error("EMAIL_NOT_VERIFIED");
  if (user.status !== "ACTIVE") throw new Error("USER_INACTIVE");
};

export const getUserByUsername = async (organizationId: string, username: string) =>
  prisma.user.findFirst({
    where: {
      organization_id: organizationId,
      username: { equals: username, mode: "insensitive" }
    }
  });

