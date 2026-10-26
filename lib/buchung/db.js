import { createClient } from "@supabase/supabase-js";

// Server-Zugriff für die Agenten (Cron, Webhook, Hintergrund-Läufe). Nutzt den Service-Schlüssel und umgeht damit
// die Zugriffsregeln. Nur in Serverfunktionen verwenden, nie im Browser.
let sb = null;
export function adminDb() {
  if (sb) return sb;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw Object.assign(new Error("SUPABASE_SERVICE_ROLE_KEY fehlt in Vercel"), { code: "capability_disabled" });
  sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return sb;
}

const rid = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => (b % 36).toString(36)).join("");

export async function liste(col, filter) {
  const { data, error } = await adminDb().from("lp_docs").select("id, data").eq("collection", col);
  if (error) throw error;
  const rows = (data || []).map((r) => ({ id: r.id, ...r.data }));
  return filter ? rows.filter(filter) : rows;
}

export async function holen(col, id) {
  const { data, error } = await adminDb().from("lp_docs").select("data").eq("collection", col).eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? { id, ...data.data } : null;
}

export async function anlegen(col, data, id = rid()) {
  const { error } = await adminDb().from("lp_docs").insert({ collection: col, id, data, updated_by: "buchungs-agent" });
  if (error) throw error;
  return { id, ...data };
}

export async function aendern(col, id, patch) {
  const { data, error } = await adminDb().rpc("lp_merge", { p_collection: col, p_id: id, p_patch: patch });
  if (error) throw error;
  return { id, ...data };
}

// Eintrag an den Verlauf einer Buchung hängen (atomar genug für unsere Last: liest, hängt an, schreibt)
export async function verlauf(buchungId, text, art = "info", extra = {}) {
  const b = await holen("buchungen", buchungId);
  if (!b) return null;
  const v = [...(b.verlauf || []), { t: Date.now(), art, text: String(text).slice(0, 2000) }].slice(-200);
  return aendern("buchungen", buchungId, { verlauf: v, ...extra });
}

export async function einstellungen() {
  const allg = (await holen("einstellungen", "allgemein")) || {};
  const b = (await holen("einstellungen", "buchung")) || {};
  return {
    allgemein: allg,
    automatik: !!b.automatik,
    testmodus: b.testmodus !== false, // Standard: Testmodus an
    testEmpfaenger: b.testEmpfaenger || "",
    vorlaufTage: num(b.vorlaufTage, 21),
    mindestVorlaufTage: num(b.mindestVorlaufTage, 4),
    preisToleranzProzent: num(b.preisToleranzProzent, 15),
    // Allgemeiner Höchstpreis: € je 1.000 Exemplare für eine 1/4 Seite (andere Formate nach Fläche). Leer = aus.
    maxTkpViertelseite: b.maxTkpViertelseite === undefined ? 25 : b.maxTkpViertelseite === null || b.maxTkpViertelseite === "" ? null : num(b.maxTkpViertelseite, null),
    monatsLimit: b.monatsLimit == null || b.monatsLimit === "" ? null : num(b.monatsLimit, null),
    nachfassenNachTagen: num(b.nachfassenNachTagen, 2),
    zielRabattProzent: num(b.zielRabattProzent, 15), // so viel unter Liste/Angebot versucht der Agent einmal nachzuverhandeln (0 = aus)
    druckSpezifikation: b.druckSpezifikation || "",
    abstandMinMin: num(b.abstandMinMin, 20), // Antwort frühestens … Minuten nach Eingang (wirkt menschlicher)
    abstandMaxMin: num(b.abstandMaxMin, 90), // … und spätestens nach … Minuten (zufällig dazwischen)
    geschaeftszeiten: b.geschaeftszeiten !== false, // nur Mo–Fr 8:00–17:30 senden // leer = Standard aus agent.js
    absenderName: b.absenderName || (allg.marke ? `${allg.marke} Anzeigen` : "Lokalpilot Anzeigen"),
    firma: b.firma || {},
    marke: allg.marke || "Modernisieren24",
    limit: allg.limit == null || allg.limit === "" ? null : num(allg.limit, null),
    kiPreise: allg.kiPreise || null,
  };
}

export function num(x, d = 0) {
  const s = String(x ?? "").trim();
  const n = typeof x === "number" ? x : parseFloat(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
  return Number.isFinite(n) ? n : d;
}

// ---------- Tresor ----------
export async function geheimnis(key) {
  const { data } = await adminDb().from("lp_secrets").select("value").eq("key", key).maybeSingle();
  return data?.value || null;
}
export async function geheimnisSetzen(key, value) {
  const { error } = await adminDb().from("lp_secrets").upsert({ key, value, updated_at: new Date().toISOString() });
  if (error) throw error;
}

// ---------- Belege (privater Bucket lp-buchung) ----------
export async function belegLaden(pfad) {
  const { data, error } = await adminDb().storage.from("lp-buchung").download(pfad);
  if (error) throw error;
  return Buffer.from(await data.arrayBuffer());
}

export async function belegSpeichern(pfad, inhalt, contentType) {
  const { error } = await adminDb().storage.from("lp-buchung").upload(pfad, inhalt, { contentType, upsert: true });
  if (error) throw error;
  return pfad;
}

export async function loeschen(col, id) {
  const { error } = await adminDb().from("lp_docs").delete().eq("collection", col).eq("id", id);
  if (error) throw error;
  return true;
}
