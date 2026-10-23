"use client";
import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import markup from "@/lib/markup";
import { makeDb, sample, makeAssets } from "@/lib/lp-backend";

// Lokalpilot-Oberfläche. Die App-Logik (public/lokalpilot.js) stammt aus dem Prototyp und spricht über
// window.claude.use("db" | "sample" | "assets") mit dem Backend. Hier hängen wir sie an Supabase und die KI-Route.
export default function Lokalpilot({ email }) {
  useEffect(() => {
    if (window.__lpGeladen) return;
    window.__lpGeladen = true;
    window.__lpServer = true;
    const sb = createClient();
    window.claude = { use: async (name) => (name === "db" ? makeDb(sb) : name === "sample" ? sample : name === "assets" ? makeAssets(sb) : null) };
    const s = document.createElement("script");
    s.src = "/lokalpilot.js?v=" + (process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || "dev");
    document.body.appendChild(s);
    const fuss = document.getElementById("side-marke");
    if (fuss && !document.getElementById("lp-abmelden")) {
      const f = document.createElement("form");
      f.id = "lp-abmelden"; f.method = "post"; f.action = "/auth/abmelden"; f.className = "lp-logout";
      f.innerHTML = `<span></span><button type="submit">Abmelden</button>`;
      f.querySelector("span").textContent = email;
      fuss.after(f);
    }
    // Link zur Seite „Buchungen“ (Buchungs-Agent) in der Seitenleiste
    const nav = document.querySelector("nav.tabs");
    if (nav && !document.getElementById("lp-buchungen-link")) {
      const a = document.createElement("a");
      a.id = "lp-buchungen-link";
      a.href = "/buchungen";
      a.style.cssText = "display:flex;align-items:center;gap:10px;font:500 14px/1 var(--body);color:var(--ink-2);border-radius:9px;padding:9px 10px;text-decoration:none";
      a.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4M8 14l2.5 2.5L16 12"/></svg>Buchungen`;
      nav.appendChild(a);
    }
    // Leere Datenbank: Admin kann die Daten aus dem Prototyp mit einem Klick übernehmen
    fetch("/api/import").then((r) => (r.ok ? r.json() : null)).then((j) => {
      if (!j?.leer || !j.admin) return;
      const box = document.createElement("div");
      box.className = "lp-import";
      box.innerHTML = `<b>Datenbank ist noch leer</b><span>Daten aus dem Prototyp übernehmen? (${j.anzahl} Einträge: Wochenblätter, Punk-Serie und drei Beispielkampagnen mit Bildern)</span><div class="btns"><button class="b small primary" type="button">Übernehmen</button><button class="b small ghost" type="button">Später</button></div>`;
      const [ja, nein] = box.querySelectorAll("button");
      nein.onclick = () => box.remove();
      ja.onclick = async () => { ja.disabled = true; ja.textContent = "Übernehme …"; const r = await fetch("/api/import", { method: "POST" }); if (r.ok) location.reload(); else { ja.textContent = "Fehler – nochmal"; ja.disabled = false; } };
      document.body.appendChild(box);
    }).catch(() => {});
  }, [email]);
  return <div dangerouslySetInnerHTML={{ __html: markup }} />;
}

