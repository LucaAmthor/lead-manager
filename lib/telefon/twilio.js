import { createHmac, timingSafeEqual } from "node:crypto";
import { geheimnis, geheimnisSetzen } from "@/lib/buchung/db";

// Twilio ohne SDK: REST über fetch, Webhook-Signatur und Zugangs-Token für das Browser-Telefon selbst gebaut.
// Nötig in Vercel: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, APP_URL. Den Rest (API-Key, TwiML-App) legt „Einrichten“ an.
const API = "https://api.twilio.com/2010-04-01";
const NUMBERS_API = "https://numbers.twilio.com/v2";

export const sid = () => process.env.TWILIO_ACCOUNT_SID || "";
const token = () => process.env.TWILIO_AUTH_TOKEN || "";
export const konfiguriert = () => !!(sid() && token());
export const appUrl = () => String(process.env.APP_URL || "").replace(/\/+$/, "");

function pruefen() {
  if (!konfiguriert()) throw Object.assign(new Error("TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN fehlen in Vercel"), { code: "capability_disabled" });
  if (!appUrl()) throw Object.assign(new Error("APP_URL fehlt in Vercel"), { code: "capability_disabled" });
}

async function anfrage(url, { method = "GET", form } = {}) {
  pruefen();
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: "Basic " + Buffer.from(`${sid()}:${token()}`).toString("base64"),
      ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: form ? new URLSearchParams(Object.entries(form).filter(([, v]) => v != null && v !== "")).toString() : undefined,
    cache: "no-store",
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(`Twilio ${res.status}: ${j.message || j.detail || "Fehler"}`), { code: "twilio", status: res.status, twilio: j });
  return j;
}
export const rest = (pfad, opts) => anfrage(`${API}/Accounts/${sid()}${pfad}`, opts);

// ---------- Webhook-Signatur (X-Twilio-Signature) ----------
// Twilio signiert die aufgerufene URL + alle POST-Parameter (alphabetisch, Name+Wert) mit dem Auth-Token (HMAC-SHA1).
export function signaturOk(request, params) {
  if (process.env.TWILIO_SIGNATUR_PRUEFEN === "aus") return true;
  const sig = request.headers.get("x-twilio-signature") || "";
  if (!sig || !token()) return false;
  const u = new URL(request.url);
  const kandidaten = new Set([appUrl() + u.pathname + u.search, u.origin + u.pathname + u.search]);
  const daten = Object.keys(params).sort().map((k) => k + params[k]).join("");
  for (const url of kandidaten) {
    const soll = createHmac("sha1", token()).update(url + daten, "utf8").digest("base64");
    const a = Buffer.from(soll), b = Buffer.from(sig);
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  return false;
}
export async function formDaten(request) {
  const text = await request.text();
  return Object.fromEntries(new URLSearchParams(text));
}

// ---------- TwiML ----------
const x = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const xml = x;
export function twiml(inhalt) {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${inhalt}</Response>`, { headers: { "Content-Type": "text/xml; charset=utf-8" } });
}
export const STIMME = { voice: "Polly.Vicki-Neural", language: "de-DE" };
export const sag = (text) => `<Say voice="${STIMME.voice}" language="${STIMME.language}">${x(text)}</Say>`;

// ---------- Rufnummern ----------
// E.164 → deutsche Schreibweise für Anzeigen: +4953411234567 → „05341 123 45 67“. vorwahl (z. B. „05341“) hilft beim Trennen.
export function national(e164, vorwahl = "") {
  const s = String(e164 || "").replace(/[^\d+]/g, "");
  if (!s.startsWith("+49")) return s;
  const rest = "0" + s.slice(3);
  const vw = String(vorwahl || "").replace(/\D/g, "").replace(/^0?/, "0");
  let v;
  if (vw.length > 2 && rest.startsWith(vw)) v = vw;
  else v = (rest.match(/^0(800|1\d{2}|30|40|69|89|221|211|201|231|341|351|511|531|711|911)/) || [rest.slice(0, 5)])[0];
  const n = rest.slice(v.length);
  const gruppen = n.length > 4 ? [n.slice(0, n.length - 4), n.slice(-4, -2), n.slice(-2)] : [n];
  return `${v} ${gruppen.join(" ")}`.trim();
}
// „0171 1234567“, „+49 171 …“, „0049…“ → +49…
export function e164(eingabe) {
  let s = String(eingabe || "").replace(/\(0\)/g, "").replace(/[^\d+]/g, "");
  if (s.startsWith("00")) s = "+" + s.slice(2);
  if (s.startsWith("0")) s = "+49" + s.slice(1);
  if (!s.startsWith("+")) s = "+" + s;
  if (s.startsWith("+490")) s = "+49" + s.slice(4);
  return /^\+\d{8,15}$/.test(s) ? s : "";
}

export async function freieNummernSuchen(ortsnetz, typ = "Local") {
  const vw = String(ortsnetz || "").replace(/\D/g, "").replace(/^0/, "");
  const q = new URLSearchParams({ PageSize: "30", VoiceEnabled: "true" });
  if (vw) q.set("Contains", "49" + vw);
  const j = await rest(`/AvailablePhoneNumbers/DE/${typ}.json?${q}`);
  const alle = j.available_phone_numbers || [];
  return vw ? alle.filter((n) => n.phone_number.startsWith("+49" + vw)) : alle;
}

export const webhookAdressen = () => ({
  VoiceUrl: `${appUrl()}/api/telefon/eingang`,
  VoiceMethod: "POST",
  StatusCallback: `${appUrl()}/api/telefon/status`,
  StatusCallbackMethod: "POST",
});

export async function nummerKaufen(nummer, { addressSid, bundleSid, name }) {
  return rest("/IncomingPhoneNumbers.json", {
    method: "POST",
    form: { PhoneNumber: nummer, AddressSid: addressSid, BundleSid: bundleSid, FriendlyName: name || "Lokalpilot", ...webhookAdressen() },
  });
}
export async function nummerVerbinden(pnSid, name) {
  return rest(`/IncomingPhoneNumbers/${pnSid}.json`, { method: "POST", form: { ...webhookAdressen(), ...(name ? { FriendlyName: name } : {}) } });
}
export async function eigeneNummern() {
  const j = await rest("/IncomingPhoneNumbers.json?PageSize=200");
  return j.incoming_phone_numbers || [];
}

// Freigegebene Unterlagen (Regulatory Bundle) und Adresse, die Twilio für deutsche Nummern verlangt
export async function bundles() {
  const j = await anfrage(`${NUMBERS_API}/RegulatoryCompliance/Bundles?IsoCountry=DE&PageSize=50`);
  return (j.results || []).map((b) => ({ sid: b.sid, status: b.status, name: b.friendly_name, typ: b.number_type || "", gueltigBis: b.valid_until }));
}
export async function adressen() {
  const j = await rest("/Addresses.json?IsoCountry=DE&PageSize=50");
  return (j.addresses || []).map((a) => ({ sid: a.sid, text: [a.customer_name, a.street, `${a.postal_code} ${a.city}`].filter(Boolean).join(", "), plz: a.postal_code, ort: a.city }));
}

// ---------- Browser-Telefon: API-Key + TwiML-App einmalig anlegen, Zugangs-Token je Sitzung ----------
export async function browserZugang({ anlegen = false } = {}) {
  let z = (await geheimnis("twilio:browser")) || null;
  if (z?.keySid && z?.keySecret && z?.appSid) {
    if (anlegen) await rest(`/Applications/${z.appSid}.json`, { method: "POST", form: { VoiceUrl: `${appUrl()}/api/telefon/ausgehend`, VoiceMethod: "POST" } });
    return z;
  }
  if (!anlegen) return null;
  const key = await rest("/Keys.json", { method: "POST", form: { FriendlyName: "Lokalpilot Browser-Telefon" } });
  const app = await rest("/Applications.json", {
    method: "POST",
    form: { FriendlyName: "Lokalpilot Rückruf", VoiceUrl: `${appUrl()}/api/telefon/ausgehend`, VoiceMethod: "POST" },
  });
  z = { keySid: key.sid, keySecret: key.secret, appSid: app.sid, angelegt: Date.now() };
  await geheimnisSetzen("twilio:browser", z);
  return z;
}

const b64url = (b) => Buffer.from(b).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
export function zugangsToken({ keySid, keySecret, appSid }, identitaet, sekunden = 3600) {
  const jetzt = Math.floor(Date.now() / 1000);
  const kopf = { alg: "HS256", typ: "JWT", cty: "twilio-fpa;v=1" };
  const inhalt = {
    jti: `${keySid}-${jetzt}`,
    iss: keySid,
    sub: sid(),
    iat: jetzt,
    nbf: jetzt,
    exp: jetzt + sekunden,
    grants: { identity: identitaet, voice: { incoming: { allow: true }, outgoing: { application_sid: appSid } } },
  };
  const teil = `${b64url(JSON.stringify(kopf))}.${b64url(JSON.stringify(inhalt))}`;
  return `${teil}.${b64url(createHmac("sha256", keySecret).update(teil).digest())}`;
}
// Twilio-Identität aus der E-Mail (nur Buchstaben, Ziffern, _)
export const identitaetAus = (email) => String(email || "").toLowerCase().replace(/[^a-z0-9]/g, "_").slice(0, 120);

// Mailbox-Aufnahme laden (Twilio schützt Medien mit Basic Auth)
export async function aufnahmeLaden(recordingSid) {
  pruefen();
  const res = await fetch(`${API}/Accounts/${sid()}/Recordings/${recordingSid}.mp3`, {
    headers: { Authorization: "Basic " + Buffer.from(`${sid()}:${token()}`).toString("base64") },
  });
  if (!res.ok) throw Object.assign(new Error(`Aufnahme ${res.status}`), { code: "not_found" });
  return res;
}
