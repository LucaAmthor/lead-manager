import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Ziel des Login-Links aus der E-Mail.
export async function GET(request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}/`);
  }
  return NextResponse.redirect(`${origin}/login?fehler=link`);
}
