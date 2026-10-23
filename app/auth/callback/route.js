import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Ziel des Login-Links aus der E-Mail.
// Neu: Link mit token_hash (E-Mail-Vorlage in Supabase) – funktioniert in jedem Browser.
// Alt: ?code=… (PKCE) – funktioniert nur im selben Browser, in dem der Code angefordert wurde.
export async function GET(request) {
  const { searchParams, origin } = new URL(request.url);
  const supabase = await createClient();
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") || "email";
  if (tokenHash) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error) return NextResponse.redirect(`${origin}/`);
    return NextResponse.redirect(`${origin}/login?fehler=abgelaufen`);
  }
  const code = searchParams.get("code");
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}/`);
  }
  return NextResponse.redirect(`${origin}/login?fehler=link`);
}
