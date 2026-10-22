import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// KI für die Agenten (Kampagnen-Agent, KI-Studio, Strategie-Agent …).
// Der Schlüssel bleibt auf dem Server; Antwort ist immer JSON plus echte Token-Zahlen.
export const maxDuration = 300;

const fehler = (code, status, extra = {}) => NextResponse.json({ code, ...extra }, { status });

function parseJson(text) {
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

export async function POST(request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fehler("not_granted", 401);
  const { data: mitglied } = await supabase.from("lp_members").select("email").limit(1);
  if (!mitglied?.length) return fehler("not_granted", 403);

  if (!process.env.ANTHROPIC_API_KEY) return fehler("capability_disabled", 503, { detail: "ANTHROPIC_API_KEY fehlt in Vercel" });
  let body;
  try {
    body = await request.json();
  } catch {
    return fehler("invalid_argument", 400);
  }
  const prompt = body?.prompt;
  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 200000) return fehler("invalid_argument", 400);

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5",
      max_tokens: 8000,
      system: "Du arbeitest in der Software Lokalpilot. Antworte ausschließlich mit gültigem JSON, ohne Erklärtext und ohne Markdown-Codeblock.",
      messages: [{ role: "user", content: prompt }],
    }),
    signal: request.signal,
  });
  if (res.status === 429 || res.status === 529) return fehler("rate_limited", 429);
  if (!res.ok) return fehler("unavailable", 502, { detail: (await res.text()).slice(0, 500) });
  const data = await res.json();
  const text = (data.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
  const result = parseJson(text);
  if (result === undefined) return fehler("invalid_json", 502);
  return NextResponse.json({
    result,
    usage: { input_tokens: data.usage?.input_tokens ?? 0, output_tokens: data.usage?.output_tokens ?? 0, model: data.model },
  });
}
