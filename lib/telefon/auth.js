import { createClient } from "@/lib/supabase/server";

// Angemeldet und als Mitglied eingetragen?
export async function istMitglied() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("lp_members").select("email").limit(1);
  return data?.length ? user : null;
}
