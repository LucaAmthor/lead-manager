import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Bild-Agent: erzeugt aus dem gespeicherten Bild-Prompt einer Anzeige ein Motiv über die Higgsfield-API,
// legt es im Supabase-Bildspeicher ab und hängt es an die Anzeige.
export const maxDuration = 300;

const API = "https://api.higgsfield.ai";
const fehler = (code, status, extra = {}) => NextResponse.json({ code, ...extra }, { status });
const schlafen = (ms) => new Promise((r) => setTimeout(r, ms));

function hfKey() {
  if (process.env.HIGGSFIELD_KEY) return process.env.HIGGSFIELD_KEY;
  if (process.env.HIGGSFIELD_API_KEY_ID && process.env.HIGGSFIELD_API_KEY_SECRET) return `${process.env.HIGGSFIELD_API_KEY_ID}:${process.env.HIGGSFIELD_API_KEY_SECRET}`;
  return null;
}

export async function POST(request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fehler("not_granted", 401);
  const key = hfKey();
  if (!key) return fehler("capability_disabled", 503, { detail: "Higgsfield-Schlüssel fehlt in Vercel" });

  const body = await request.json().catch(() => ({}));
  const anzeigeId = body.anzeigeId;
  if (!anzeigeId) return fehler("invalid_argument", 400);
  const { data: row, error: e1 } = await supabase.from("lp_docs").select("data").eq("collection", "anzeigen").eq("id", anzeigeId).maybeSingle();
  if (e1 || !row) return fehler("not_found", 404);
  const motiv = row.data.motiv || {};
  const prompt = String(motiv.bildPrompt || body.prompt || "").slice(0, 2048);
  if (prompt.length < 2) return fehler("invalid_argument", 400, { detail: "Anzeige hat keinen Bild-Prompt" });

  const model = process.env.HIGGSFIELD_MODEL || "ideogram/v4.0";
  const headers = { Authorization: `Key ${key}`, "Content-Type": "application/json" };
  const submit = await fetch(`${API}/${model}`, {
    method: "POST",
    headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify({ prompt, aspect_ratio: "3:4", rendering_speed: "QUALITY" }),
  });
  if (submit.status === 402) return fehler("kein_guthaben", 402, { detail: "Higgsfield-Guthaben aufladen" });
  if (submit.status === 429) return fehler("rate_limited", 429);
  if (!submit.ok) return fehler("unavailable", 502, { detail: (await submit.text()).slice(0, 400) });
  const job = await submit.json();
  const statusUrl = job.status_url || `${API}/requests/${job.request_id}/status`;

  let ergebnis = null;
  for (let i = 0; i < 80; i++) {
    await schlafen(i < 5 ? 2000 : 3000);
    const s = await fetch(statusUrl, { headers });
    if (!s.ok) continue;
    const j = await s.json();
    if (j.status === "completed") { ergebnis = j; break; }
    if (["failed", "nsfw", "canceled"].includes(j.status)) return fehler("bild_" + j.status, 502);
  }
  const bildUrl = ergebnis?.images?.[0]?.url;
  if (!bildUrl) return fehler("timeout", 504);

  const bild = await fetch(bildUrl);
  if (!bild.ok) return fehler("unavailable", 502, { detail: "Bild konnte nicht geladen werden" });
  const type = bild.headers.get("content-type") || "image/png";
  const ext = /jpe?g/.test(type) ? "jpg" : /webp/.test(type) ? "webp" : "png";
  const path = `ki/${anzeigeId}-${Date.now()}.${ext}`;
  const { error: e2 } = await supabase.storage.from("lp-bilder").upload(path, await bild.arrayBuffer(), { contentType: type });
  if (e2) return fehler("speicher", 500, { detail: e2.message });
  const url = supabase.storage.from("lp-bilder").getPublicUrl(path).data.publicUrl;

  const preis = Number(process.env.HIGGSFIELD_PREIS_EUR || 0.03);
  const neu = { ...motiv, typ: "bild", bildUrl: url, bildAssetId: path, higgsfieldRequestId: job.request_id, bildModell: model, bildEur: preis, bildErzeugtAm: new Date().toISOString() };
  const { error: e3 } = await supabase.rpc("lp_merge", { p_collection: "anzeigen", p_id: anzeigeId, p_patch: { motiv: neu } });
  if (e3) return fehler("speichern", 500, { detail: e3.message });
  return NextResponse.json({ ok: true, url });
}
