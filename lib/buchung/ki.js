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

export async function anthropic(body, { beta } = {}) {
  if (!process.env.ANTHROPIC_API_KEY) throw Object.assign(new Error("ANTHROPIC_API_KEY fehlt"), { code: "capability_disabled" });
  const headers = { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" };
  if (beta) headers["anthropic-beta"] = beta;
  for (let versuch = 0; versuch < 4; versuch++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers, body: JSON.stringify(body) });
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
  return { result, usage: { tin: data.usage?.input_tokens || 0, tout: data.usage?.output_tokens || 0, model: data.model } };
}
