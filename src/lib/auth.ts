import { supabase } from "@/lib/supabase";

export const hashPassword = async (plain: string) => Bun.password.hash(plain);

export const verifyPassword = async (plain: string, hash: string) =>
  Bun.password.verify(plain, hash);

export const assertLoginAllowed = (user: { email_verified_at: string | null; status: string }) => {
  if (!user.email_verified_at) throw new Error("EMAIL_NOT_VERIFIED");
  if (user.status !== "ACTIVE") throw new Error("USER_INACTIVE");
};

export const getUserByUsername = async (organizationId: string, username: string) => {
  const { data } = await supabase
    .from("users")
    .select("*")
    .eq("organization_id", organizationId)
    .ilike("username", username)
    .limit(1)
    .maybeSingle();
  return data;
};
