import { prisma } from "@/lib/prisma";

export const hashPassword = async (plain: string) => Bun.password.hash(plain);

export const verifyPassword = async (plain: string, hash: string) =>
  Bun.password.verify(plain, hash);

export const assertLoginAllowed = (user: { email_verified_at: Date | null; status: string }) => {
  if (!user.email_verified_at) throw new Error("EMAIL_NOT_VERIFIED");
  if (user.status !== "ACTIVE") throw new Error("USER_INACTIVE");
};

export const getUserByUsername = async (organizationId: string, username: string) =>
  prisma.user.findFirst({
    where: {
      organization_id: organizationId,
      username: { equals: username, mode: "insensitive" },
    },
  });
