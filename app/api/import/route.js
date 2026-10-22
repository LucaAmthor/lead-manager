import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import daten from "@/lib/prototyp-daten.json";

// Übernimmt die Daten aus dem Prototyp (Claude-Artifact) in die leere Datenbank. Nur für Admins.
async function lage(supabase) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { user: null };
  const { data: m } = await supabase.from("lp_members").select("rolle").ilike("email", user.email).maybeSingle();
  const { count } = await supabase.from("lp_docs").select("id", { count: "exact", head: true });
  return { user, admin: m?.rolle === "admin", leer: (count ?? 0) === 0 };
}

export async function GET() {
  const supabase = await createClient();
  const l = await lage(supabase);
  if (!l.user) return NextResponse.json({ code: "not_granted" }, { status: 401 });
  return NextResponse.json({ leer: l.leer, admin: l.admin, anzahl: daten.length });
}

export async function POST() {
  const supabase = await createClient();
  const l = await lage(supabase);
  if (!l.user || !l.admin) return NextResponse.json({ code: "not_granted" }, { status: 403 });
  if (!l.leer) return NextResponse.json({ code: "nicht_leer" }, { status: 409 });
  const { error } = await supabase.from("lp_docs").upsert(daten.map((r) => ({ ...r, updated_at: new Date().toISOString() })));
  if (error) return NextResponse.json({ code: "fehler", detail: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, anzahl: daten.length });
}
