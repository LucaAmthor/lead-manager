"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Seite „WhatsApp“: alle Chats, KI antwortet selbst; ein Mensch übernimmt, wenn nötig.
const SAMMLUNGEN = ["wa_chats", "wa_nachrichten", "kontakte", "einstellungen"];
const STATUS = { offen: "offen", braucht_mensch: "braucht euch", fertig: "Angaben komplett", erledigt: "erledigt" };
const zeit = (t) => (t ? new Date(t).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");

function useDaten() {
  const [d, setD] = useState(() => Object.fromEntries(SAMMLUNGEN.map((c) => [c, new Map()])));
  const sb = useMemo(() => createClient(), []);
  useEffect(() => {
    let aus = false;
    sb.from("lp_docs").select("collection, id, data").in("collection", SAMMLUNGEN).then(({ data }) => {
      if (aus) return;
      const neu = Object.fromEntries(SAMMLUNGEN.map((c) => [c, new Map()]));
      (data || []).forEach((r) => neu[r.collection].set(r.id, { id: r.id, ...r.data }));
      setD(neu);
    });
    const ch = sb.channel("lp-whatsapp").on("postgres_changes", { event: "*", schema: "public", table: "lp_docs" }, (p) => {
      const col = p.new?.collection || p.old?.collection;
      if (!SAMMLUNGEN.includes(col)) return;
      setD((alt) => { const m = new Map(alt[col]); if (p.eventType === "DELETE") m.delete(p.old.id); else m.set(p.new.id, { id: p.new.id, ...p.new.data }); return { ...alt, [col]: m }; });
    }).subscribe();
    return () => { aus = true; sb.removeChannel(ch); };
  }, [sb]);
  return { sb, d, arr: (c) => [...d[c].values()] };
}
async function aktion(body) {
  const r = await fetch("/api/whatsapp/aktion", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.detail || j.code || `Fehler ${r.status}`);
  return j;
}

export default function WhatsApp({ email }) {
  const { sb, d, arr } = useDaten();
  const [env, setEnv] = useState(null);
  const [filter, setFilter] = useState("offen");
  const [aktiv, setAktiv] = useState(null);
  const [text, setText] = useState("");
  const [toast, setToast] = useState("");
  const unten = useRef(null);
  const melden = useCallback((t) => { setToast(t); setTimeout(() => setToast(""), 4000); }, []);
  useEffect(() => { fetch("/api/whatsapp/aktion").then((r) => r.json()).then((j) => setEnv(j.env)).catch(() => {}); }, []);

  const chats = arr("wa_chats").sort((a, b) => (b.letzte || 0) - (a.letzte || 0));
  const sichtbar = chats.filter((c) => (filter === "offen" ? c.status !== "erledigt" : filter === "mensch" ? c.status === "braucht_mensch" : true));
  const chat = aktiv ? d.wa_chats.get(aktiv) : null;
  const nachrichten = chat ? arr("wa_nachrichten").filter((n) => n.chatId === chat.id).sort((a, b) => a.zeit - b.zeit) : [];
  const kontakt = chat?.kontaktId ? d.kontakte.get(chat.kontaktId) : null;
  const fensterZu = chat?.letzteEingehend && Date.now() - chat.letzteEingehend > 24 * 36e5;
  const brauchen = chats.filter((c) => c.status === "braucht_mensch").length;
  const wa = d.einstellungen.get("whatsapp") || {};

  useEffect(() => { unten.current?.scrollIntoView({ block: "end" }); }, [nachrichten.length, aktiv]);
  useEffect(() => { if (chat?.ungelesen) aktion({ aktion: "gelesen", chatId: chat.id }).catch(() => {}); }, [chat?.id, chat?.ungelesen]);

  async function tun(body, ok) { try { await aktion(body); if (ok) melden(ok); return true; } catch (e) { melden("Fehler: " + e.message); return false; } }
  async function senden() { if (!text.trim()) return; if (await tun({ aktion: "senden", chatId: chat.id, text })) setText(""); }
  async function zusatzSpeichern(v) {
    const { error } = await sb.from("lp_docs").upsert({ collection: "einstellungen", id: "whatsapp", data: { ...wa, id: undefined, zusatz: v }, updated_at: new Date().toISOString() });
    melden(error ? "Fehler: " + error.message : "Gespeichert");
  }

  return (
    <div className="bk">
      <header className="bk-kopf">
        <a href="/" className="bk-zurueck">← Lokalpilot</a>
        <div>
          <h1>WhatsApp</h1>
          <p>Die KI antwortet sofort, fragt die Angaben ab und holt die Einwilligung ein. Braucht es einen Menschen, landet der Chat unter „braucht euch“. Sobald ihr selbst schreibt, pausiert die KI in diesem Chat.</p>
        </div>
      </header>
      <section className="bk-kpis">
        <div className={"bk-kpi " + (brauchen ? "crit" : "")}><b>{brauchen}</b><span>brauchen euch</span></div>
        <div className="bk-kpi"><b>{chats.filter((c) => c.status !== "erledigt").length}</b><span>offene Chats</span></div>
        <div className="bk-kpi"><b>{chats.filter((c) => c.status === "fertig").length}</b><span>Angaben komplett</span></div>
        <div className="bk-kpi"><b>{chats.filter((c) => Date.now() - (c.start || 0) < 7 * 864e5).length}</b><span>neu (7 Tage)</span></div>
        <div className="bk-kpi"><b>{chats.length}</b><span>Chats gesamt</span></div>
      </section>
      {env && !env.whatsapp && (
        <section className="bk-karte bk-setup">
          <h2>Einrichtung</h2>
          <ul>
            <li>Meta Business Manager: Unternehmen verifizieren, WhatsApp-Konto anlegen, Telefonnummer hinzufügen (eine Nummer, die noch nicht in der WhatsApp-App genutzt wird) und Anzeigename freigeben lassen.</li>
            <li>System-Benutzer mit dauerhaftem Token anlegen (Berechtigungen whatsapp_business_messaging, whatsapp_business_management).</li>
            <li>In Vercel eintragen: WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_APP_SECRET (App-Einstellungen → Allgemein), WHATSAPP_VERIFY_TOKEN (beliebige Zeichenkette). Neu deployen.</li>
            <li>Meta App → WhatsApp → Konfiguration → Webhook: {env.appUrl || "https://<app>"}/api/whatsapp mit demselben Verify-Token, Feld „messages“ abonnieren.</li>
            <li>In Lokalpilot unter Einstellungen die WhatsApp-Nummer eintragen, dann zeigen die Anzeigen einen WhatsApp-QR mit Code.</li>
          </ul>
        </section>
      )}
      <section className="bk-karte">
        <div className="wa-raster">
          <div>
            <div className="bk-tabs" style={{ marginBottom: 8 }}>{[["offen", "Offen"], ["mensch", `Braucht euch (${brauchen})`], ["alle", "Alle"]].map(([k, l]) => <button key={k} className={filter === k ? "an" : ""} onClick={() => setFilter(k)}>{l}</button>)}</div>
            <div className="wa-liste">
              {!sichtbar.length ? <p className="bk-leer">Keine Chats.</p> : sichtbar.map((c) => (
                <button key={c.id} className={"wa-eintrag" + (c.id === aktiv ? " an" : "")} onClick={() => setAktiv(c.id)}>
                  <b>{c.name || c.telefon}</b>
                  {c.ungelesen ? <span className="wa-zahl">{c.ungelesen}</span> : <span className="bk-zeit">{zeit(c.letzte)}</span>}
                  <small>{c.status === "braucht_mensch" ? "⚠ " : ""}{[c.kategorie, c.code].filter(Boolean).join(" · ")}{c.kategorie || c.code ? " – " : ""}{c.letzteText}</small>
                </button>
              ))}
            </div>
          </div>
          <div className="wa-chat">
            {!chat ? <p className="bk-leer">Chat links auswählen.</p> : (
              <>
                <div className="wa-kopf">
                  <div>
                    <h2>{chat.name || chat.telefon}</h2>
                    <div className="bk-hint">{chat.telefon} · {[chat.kategorie, chat.code, chat.referral ? "Meta-Anzeige" : ""].filter(Boolean).join(" · ") || "keine Anzeige zugeordnet"} · <span className={"tf-st " + (chat.status === "braucht_mensch" ? "verpasst" : chat.status === "fertig" ? "beendet" : "")}>{STATUS[chat.status] || chat.status}</span></div>
                    {chat.uebergabeGrund && chat.status === "braucht_mensch" && <div className="crit" style={{ fontSize: 13 }}>Grund: {chat.uebergabeGrund}</div>}
                  </div>
                  <div className="tf-zeile">
                    <button className="b small ghost" onClick={() => tun({ aktion: "modus", chatId: chat.id, modus: chat.modus === "ki" ? "mensch" : "ki" }, chat.modus === "ki" ? "KI pausiert" : "KI übernimmt")}>{chat.modus === "ki" ? "KI pausieren" : "An KI zurückgeben"}</button>
                    <button className="b small ghost" onClick={() => tun({ aktion: "erledigt", chatId: chat.id, wert: chat.status !== "erledigt" }, "Gespeichert")}>{chat.status === "erledigt" ? "Wieder öffnen" : "Erledigt"}</button>
                    <button className="b small ghost" onClick={() => window.dispatchEvent(new CustomEvent("lp-anrufen", { detail: { nummer: chat.telefon } }))}>Anrufen</button>
                  </div>
                </div>
                {kontakt && (
                  <div className="wa-felder">
                    <span><b>Kontakt:</b> {kontakt.name || "–"}{kontakt.plz ? `, ${kontakt.plz}` : ""}{kontakt.ort ? ` ${kontakt.ort}` : ""} · Einwilligung {kontakt.einwilligung ? <b className="good">ja</b> : "noch nicht"} · {kontakt.qualifiziert ? <b className="good">qualifiziert</b> : "nicht qualifiziert"}</span>
                    {Object.entries(kontakt.antworten || {}).map(([f, v]) => <span key={f} className="muted">{f}: {v}</span>)}
                  </div>
                )}
                <div className="wa-verlauf">
                  {nachrichten.map((n) => (
                    <div key={n.id} className={"wa-blase " + n.richtung}>{n.text}<small>{zeit(n.zeit)}{n.richtung === "aus" ? ` · ${n.von === "ki" ? "KI" : n.von}${n.status && n.status !== "gesendet" ? " · " + n.status : ""}${n.fehler ? " · " + n.fehler : ""}` : ""}</small></div>
                  ))}
                  <div ref={unten} />
                </div>
                <div className="wa-eingabe">
                  <textarea rows={2} value={text} disabled={fensterZu} placeholder={fensterZu ? "24-Stunden-Fenster zu: erst wieder, wenn der Kunde schreibt. Am besten anrufen." : "Antwort schreiben (übernimmt den Chat von der KI) …"} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) senden(); }} />
                  <button className="b primary" disabled={fensterZu || !text.trim()} onClick={senden}>Senden</button>
                </div>
              </>
            )}
          </div>
        </div>
      </section>
      <details className="bk-karte bk-einst">
        <summary><h2>Hinweise für die KI</h2></summary>
        <p className="bk-hint">Zusätzliche Regeln, die die KI in jedem Chat beachtet (z. B. „Wir vermitteln nur in Niedersachsen“). Leitfaden-Fragen je Kategorie stehen unter Telefon → Einstellungen und gelten auch hier.</p>
        <ZusatzFeld wert={wa.zusatz || ""} speichern={zusatzSpeichern} />
      </details>
      {toast && <div className="bk-toast">{toast}</div>}
      <p className="bk-fuss">Angemeldet als {email}</p>
    </div>
  );
}

function ZusatzFeld({ wert, speichern }) {
  const [v, setV] = useState(wert);
  useEffect(() => setV(wert), [wert]);
  return (
    <div>
      <label><textarea rows={4} value={v} onChange={(e) => setV(e.target.value)} /></label>
      <div className="bk-aktionen"><button className="b small primary" onClick={() => speichern(v)}>Speichern</button></div>
    </div>
  );
}
