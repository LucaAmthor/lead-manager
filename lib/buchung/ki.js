// KI-Aufrufe der Buchungs-Agenten auf dem Server (ohne angemeldeten Nutzer, z. B. aus dem Cron).
export const MODELL = () => process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";

export function parseJson(text) {
  const t = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    return JSON.parse(t);
  } catch {}
  const start = Math.min(...["{", "["].map((c) => t.indexOf(c)).filter((i) => i >= 0));
  const end = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
  if (Number.isFinite(start) && end > start) {
    try {
      return JSON.parse(t.slice(start, end + 1));
    } catch {}
  }
  return undefined;
}

// Prompt-Caching: Gleichbleibender Anfang (Werkzeuge + System-Prompt) und der bisherige Verlauf werden bei
// Anthropic 5 Minuten zwischengespeichert. Wiederholte Teile kosten dann nur 10 % statt 100 %, das Schreiben
// in den Cache einmalig 125 %. Lohnt sich vor allem in Schleifen (Browser-Agent, Recherche, WhatsApp-Verlauf).
// Breakpoints: 1) Ende des System-Prompts (deckt Werkzeuge + System ab), 2) letzter Block der letzten
// User-Nachricht (deckt den Verlauf ab). Die übergebenen Nachrichten werden nicht verändert.
const CACHEBAR = new Set(["text", "image", "document", "tool_result"]);
export function mitCache(body) {
  const out = { ...body };
  if (typeof body.system === "string" && body.system.trim()) {
    out.system = [{ type: "text", text: body.system, cache_control: { type: "ephemeral" } }];
  }
  const msgs = Array.isArray(body.messages) ? body.messages : [];
  const last = msgs[msgs.length - 1];
  if (last?.role === "user") {
    const content =
      typeof last.content === "string"
        ? last.content.trim() ? [{ type: "text", text: last.content }] : []
        : (last.content || []).map((b) => ({ ...b }));
    for (let i = content.length - 1; i >= 0; i--) {
      if (CACHEBAR.has(content[i].type)) {
        content[i] = { ...content[i], cache_control: { type: "ephemeral" } };
        out.messages = [...msgs.slice(0, -1), { ...last, content }];
        break;
      }
    }
  }
  return out;
}

// Token-Zahlen einer Antwort: tin = alle Eingabe-Tokens (ungecacht + Cache lesen + Cache schreiben),
// tcr/tcw = davon aus dem Cache gelesen / in den Cache geschrieben
export function tokens(u = {}) {
  const tcr = u.cache_read_input_tokens || 0;
  const tcw = u.cache_creation_input_tokens || 0;
  return { tin: (u.input_tokens || 0) + tcr + tcw, tcr, tcw, tout: u.output_tokens || 0 };
}

// Kosten in € (Sonnet: 3 $/15 $ je 1 Mio. Tokens, Cache lesen 0,30 $, Cache schreiben 3,75 $), 1 $ ≈ 0,92 €
export function kiKostenEur(u = {}) {
  const tcr = u.tcr || 0;
  const tcw = u.tcw || 0;
  const ungecacht = Math.max(0, (u.tin || 0) - tcr - tcw);
  const usd = (ungecacht * 3 + tcw * 3.75 + tcr * 0.3 + (u.tout || 0) * 15) / 1e6 + (u.suchen || 0) * 0.01;
  return Math.round(usd * 0.92 * 100) / 100;
}

export async function anthropic(body, { beta } = {}) {
  if (!process.env.ANTHROPIC_API_KEY) throw Object.assign(new Error("ANTHROPIC_API_KEY fehlt"), { code: "capability_disabled" });
  const headers = { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" };
  if (beta) headers["anthropic-beta"] = beta;
  for (let versuch = 0; versuch < 4; versuch++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers, body: JSON.stringify(mitCache(body)) });
    if ([429, 500, 502, 503, 529].includes(res.status)) {
      await new Promise((r) => setTimeout(r, 3000 * (versuch + 1)));
      continue;
    }
    if (!res.ok) throw Object.assign(new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`), { code: "unavailable" });
    return res.json();
  }
  throw Object.assign(new Error("Anthropic überlastet"), { code: "rate_limited" });
}

// Ein JSON-Ergebnis plus Token-Zahlen (für die Kostenrechnung je Kampagne)
// dateien: [{ base64, mediaType, name }] – PDFs und Bilder aus Mail-Anhängen, die die KI mitlesen soll
export async function kiJson(prompt, { system, maxTokens = 4000, dateien = [] } = {}) {
  const bloecke = (dateien || []).slice(0, 5).map((d) =>
    d.mediaType === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: d.base64 }, title: d.name || "Anhang" }
      : { type: "image", source: { type: "base64", media_type: d.mediaType, data: d.base64 } }
  );
  const data = await anthropic({
    model: MODELL(),
    max_tokens: maxTokens,
    system:
      (system ? system + "\n\n" : "") +
      "Du arbeitest in der Software Lokalpilot als Buchungs-Agent für Zeitungsanzeigen. Antworte ausschließlich mit gültigem JSON, ohne Erklärtext und ohne Markdown-Codeblock.",
    messages: [{ role: "user", content: bloecke.length ? [...bloecke, { type: "text", text: prompt }] : prompt }],
  });
  const text = (data.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
  const result = parseJson(text);
  if (result === undefined) throw Object.assign(new Error("KI-Antwort war kein JSON"), { code: "invalid_json" });
  return { result, usage: { ...tokens(data.usage), model: data.model } };
}
