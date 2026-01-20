import { hashPassword } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const run = async () => {
  const ips = ["127.0.0.1", "::1"];
  const extra = process.env.SEED_WHITELIST_IP;
  if (extra) ips.push(extra);

  for (const ip of ips) {
    await prisma.iPWhitelist.upsert({
      where: { ip },
      update: { status: "ACTIVE", updated_by: "system" },
      create: { ip, note: "seed", status: "ACTIVE", created_by: "system", updated_by: "system" },
    });
  }

  const shouldCreateTestUser =
    (process.env.SEED_CREATE_TEST_USER ?? "").toLowerCase() === "true" ||
    process.env.SEED_CREATE_TEST_USER === "1";
  if (!shouldCreateTestUser) return;

  const testUsername = "testingaccount";
  const testEmail = process.env.SEED_SUPER_EMAIL?.trim() || "testingaccount@cuanyuk.com";
  const testPassword = "helloworld26";

  const organization =
    (await prisma.organization.findFirst({
      where: { status: "ACTIVE" },
      orderBy: { created_date: "asc" },
    })) ??
    (await prisma.organization.create({
      data: {
        display_name: "Workspace",
        status: "ACTIVE",
        created_by: "system",
        updated_by: "system",
      },
    }));

  const passwordHash = await hashPassword(testPassword);

  const existing = await prisma.user.findFirst({
    where: { organization_id: organization.id, username: testUsername },
    select: { id: true },
  });

  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        email: testEmail,
        password_hash: passwordHash,
        email_verified_at: new Date(),
        status: "ACTIVE",
        role: "SUPER",
        updated_by: "system",
      },
    });
    return;
  }

  await prisma.user.create({
    data: {
      organization_id: organization.id,
      username: testUsername,
      email: testEmail,
      password_hash: passwordHash,
      email_verified_at: new Date(),
      status: "ACTIVE",
      role: "SUPER",
      created_by: "system",
      updated_by: "system",
    },
  });
};

run()
  .then(async () => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
