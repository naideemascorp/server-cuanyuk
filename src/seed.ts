import { hashPassword } from "./lib/auth";
import { supabase } from "./lib/supabase";

const run = async () => {
  const ips = ["127.0.0.1", "::1"];
  const extra = process.env.SEED_WHITELIST_IP;
  if (extra) ips.push(extra);

  for (const ip of ips) {
    await supabase
      .from("ip_whitelist")
      .upsert(
        { ip, note: "seed", status: "ACTIVE", created_by: "system", updated_by: "system" },
        { onConflict: "ip" },
      );
  }

  const shouldCreateTestUser =
    (process.env.SEED_CREATE_TEST_USER ?? "").toLowerCase() === "true" ||
    process.env.SEED_CREATE_TEST_USER === "1";
  if (!shouldCreateTestUser) return;

  const testUsername = "testingaccount";
  const testEmail = process.env.SEED_SUPER_EMAIL?.trim() || "testingaccount@cuanyuk.com";
  const testPassword = "helloworld26";

  const { data: existingOrg } = await supabase
    .from("organizations")
    .select("*")
    .eq("status", "ACTIVE")
    .order("created_date", { ascending: true })
    .limit(1)
    .maybeSingle();

  let organization = existingOrg;
  if (!organization) {
    const { data: newOrg } = await supabase
      .from("organizations")
      .insert({
        display_name: "Workspace",
        status: "ACTIVE",
        created_by: "system",
        updated_by: "system",
      })
      .select()
      .single();
    organization = newOrg;
  }
  if (!organization) throw new Error("Failed to create organization");

  const passwordHash = await hashPassword(testPassword);

  const { data: existing } = await supabase
    .from("users")
    .select("id")
    .eq("organization_id", organization.id)
    .eq("username", testUsername)
    .limit(1)
    .maybeSingle();

  if (existing) {
    await supabase
      .from("users")
      .update({
        email: testEmail,
        password_hash: passwordHash,
        email_verified_at: new Date().toISOString(),
        status: "ACTIVE",
        role: "SUPER",
        updated_by: "system",
      })
      .eq("id", existing.id);
    return;
  }

  await supabase.from("users").insert({
    organization_id: organization.id,
    username: testUsername,
    email: testEmail,
    password_hash: passwordHash,
    email_verified_at: new Date().toISOString(),
    status: "ACTIVE",
    role: "SUPER",
    created_by: "system",
    updated_by: "system",
  });
};

run()
  .then(() => {
    console.log("Seed complete");
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
