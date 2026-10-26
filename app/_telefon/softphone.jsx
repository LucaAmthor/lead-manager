"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { skriptFuer, einwilligungFuer } from "@/lib/telefon/skripte";
import "./softphone.css";

// Browser-Telefon für alle Lokalpilot-Seiten: klingelt bei Lead-Anrufen, zeigt Anzeige + Leitfaden, erfasst den Kontakt.
// Status „bereit“ = Anrufe klingeln hier. Schließt man den Tab, gehen Anrufe nach der Klingelzeit an das nächste Ziel (z. B. Handy).
const STATUS_TEXT = { aus: "aus", bereit: "bereit", pause: "Pause", gespraech: "im Gespräch" };
const lsGet = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
export const national = (e) => {
  const s = String(e || "");
  if (!s.startsWith("+49")) return s;
  const r = "0" + s.slice(3);
  return r.length > 7 ? `${r.slice(0, r.length - 7)} ${r.slice(-7, -4)} ${r.slice(-4)}` : r;
};
async function api(body) {
  const r = await fetch("/api/telefon", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.detail || j.code || `Fehler ${r.status}`);
  return j;
}
const docHolen = async (sb, col, id) => {
  if (!id) return null;
  const { data } = await sb.from("lp_docs").select("data").eq("collection", col).eq("id", id).maybeSingle();
  return data ? { id, ...data.data } : null;
};

export default function Softphone() {
  const sb = useMemo(() => createClient(), []);
  const [verfuegbar, setVerfuegbar] = useState(null); // null = prüfe, false = nicht eingerichtet
  const [status, setStatus] = useState("aus");
  const [offen, setOffen] = useState(false);
  const [eingehend, setEingehend] = useState(null); // { call, info }
  const [aktiv, setAktiv] = useState(null); // { call, info, start, raus }
  const [erfassen, setErfassen] = useState(null); // info des letzten Gesprächs
  const [stumm, setStumm] = useState(false);
  const [fehler, setFehler] = useState("");
  const [tick, setTick] = useState(0);
  const dev = useRef(null);
  const statusRef = useRef("aus");
  statusRef.current = status;

  // Infos zum Anruf: Anruf-Dokument (vom Server angelegt), Anzeige, Kontakt, frühere Kontakte dieser Nummer, Leitfaden
  const infoLaden = useCallback(
    async (anrufId, fallback = {}) => {
      let anruf = null;
      for (let i = 0; i < 4 && !anruf; i++) {
        anruf = await docHolen(sb, "anrufe", anrufId);
        if (!anruf) await new Promise((r) => setTimeout(r, 400));
      }
      anruf = anruf || { id: anrufId, ...fallback };
      const [anzeige, kontakt, tel, allg] = await Promise.all([
        docHolen(sb, "anzeigen", anruf.anzeigeId),
        docHolen(sb, "kontakte", anruf.kontaktId),
        docHolen(sb, "einstellungen", "telefon"),
        docHolen(sb, "einstellungen", "allgemein"),
      ]);
      let frueher = 0;
      if (anruf.von) {
        const { count } = await sb.from("lp_docs").select("id", { count: "exact", head: true }).eq("collection", "kontakte").eq("data->>telefon", anruf.von);
        frueher = Math.max(0, (count || 0) - 1);
      }
      const marke = anruf.marke || allg?.marke || "Modernisieren24";
      return { anruf, anzeige, kontakt, frueher, skript: skriptFuer(anruf.kategorie || anzeige?.kategorie, tel?.skripte, marke), einwilligung: einwilligungFuer(anruf.kategorie || anzeige?.kategorie, tel?.einwilligung) };
    },
    [sb]
  );

  const herz = useCallback((s) => api({ aktion: "herzschlag", status: s }).catch(() => {}), []);

  // Gerät (Twilio Voice SDK) anlegen
  const geraet = useCallback(async () => {
    if (dev.current) return dev.current;
    const r = await fetch("/api/telefon/token");
    if (!r.ok) { setVerfuegbar(false); throw new Error("Telefon ist noch nicht eingerichtet"); }
    const { token } = await r.json();
    const { Device } = await import("@twilio/voice-sdk");
    const d = new Device(token, { edge: ["frankfurt", "dublin"], closeProtection: "Gerade läuft ein Telefonat. Wirklich schließen?", codecPreferences: ["opus", "pcmu"] });
    d.on("tokenWillExpire", async () => {
      const t = await fetch("/api/telefon/token").then((x) => x.json()).catch(() => null);
      if (t?.token) d.updateToken(t.token);
    });
    d.on("error", (e) => setFehler(e?.message || "Telefon-Fehler"));
    d.on("incoming", async (call) => {
      if (statusRef.current !== "bereit") { call.reject(); return; }
      const anrufId = call.customParameters.get("anrufId");
      const info = await infoLaden(anrufId, { von: call.parameters.From, code: call.customParameters.get("code") });
      setEingehend({ call, info });
      setOffen(true);
      if (typeof Notification !== "undefined" && Notification.permission === "granted" && document.hidden) {
        const n = new Notification("Lead-Anruf", { body: [national(info.anruf.von), info.anruf.kategorie, info.anruf.code].filter(Boolean).join(" · "), requireInteraction: true });
        n.onclick = () => { window.focus(); n.close(); };
      }
      const weg = () => setEingehend((e) => (e?.call === call ? null : e));
      call.on("cancel", weg);
      call.on("reject", weg);
      call.on("disconnect", weg);
    });
    dev.current = d;
    return d;
  }, [infoLaden]);

  // Prüfen, ob das Telefon eingerichtet ist; gespeicherten Status wiederherstellen
  useEffect(() => {
    fetch("/api/telefon/token", { method: "GET" })
      .then((r) => {
        setVerfuegbar(r.ok);
        if (r.ok) {
          const s = lsGet("lp-tel-status", "aus");
          if (s === "bereit" || s === "pause") setStatus(s);
        }
      })
      .catch(() => setVerfuegbar(false));
  }, []);

  // Status umsetzen: bereit = registrieren (Anrufe klingeln hier), sonst abmelden
  useEffect(() => {
    if (!verfuegbar) return;
    lsSet("lp-tel-status", status);
    let aus = false;
    (async () => {
      try {
        if (status === "bereit") {
          const d = await geraet();
          if (!aus && d.state !== "registered") await d.register();
          if (typeof Notification !== "undefined" && Notification.permission === "default") Notification.requestPermission().catch(() => {});
        } else if (dev.current && dev.current.state === "registered" && !aktiv) {
          await dev.current.unregister();
        }
        setFehler("");
      } catch (e) {
        setFehler(e.message);
      }
    })();
    herz(aktiv ? "gespraech" : status);
    const t = setInterval(() => herz(aktiv ? "gespraech" : statusRef.current), 60e3);
    const weg = () => navigator.sendBeacon?.("/api/telefon", new Blob([JSON.stringify({ aktion: "herzschlag", status: "offline" })], { type: "application/json" }));
    window.addEventListener("pagehide", weg);
    return () => { aus = true; clearInterval(t); window.removeEventListener("pagehide", weg); };
  }, [status, verfuegbar, geraet, herz, aktiv]);

  // Gesprächsdauer anzeigen
  useEffect(() => {
    if (!aktiv) return;
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [aktiv]);

  const gespraechBeginnt = useCallback((call, info, raus = false) => {
    setAktiv({ call, info, start: Date.now(), raus });
    setErfassen(info);
    setStumm(false);
    setOffen(true);
    call.on("disconnect", () => setAktiv((a) => (a?.call === call ? null : a)));
    call.on("cancel", () => setAktiv((a) => (a?.call === call ? null : a)));
    call.on("error", (e) => setFehler(e?.message || "Fehler im Gespräch"));
  }, []);

  async function annehmen() {
    const { call, info } = eingehend;
    setEingehend(null);
    call.accept();
    gespraechBeginnt(call, info);
    api({ aktion: "angenommen", anrufId: info.anruf.id }).catch(() => {});
  }

  // Rückruf: andere Seiten rufen window.dispatchEvent(new CustomEvent("lp-anrufen", { detail: { nummer, anrufId } }))
  useEffect(() => {
    const f = async (e) => {
      const { nummer, anrufId } = e.detail || {};
      try {
        const d = await geraet();
        const info = anrufId ? await infoLaden(anrufId) : { anruf: { von: nummer }, skript: skriptFuer(""), einwilligung: einwilligungFuer("") };
        const call = await d.connect({ params: { To: nummer, anrufId: anrufId || "" } });
        gespraechBeginnt(call, { ...info, anruf: { ...info.anruf, von: nummer } }, true);
      } catch (err) {
        setFehler(err.message);
        setOffen(true);
      }
    };
    window.addEventListener("lp-anrufen", f);
    return () => window.removeEventListener("lp-anrufen", f);
  }, [geraet, infoLaden, gespraechBeginnt]);

  if (!verfuegbar) return null;
  const dauer = aktiv ? Math.floor((Date.now() - aktiv.start) / 1000) : 0;
  const zeigeStatus = aktiv ? "gespraech" : status;

  return (
    <div className={"sp" + (offen || eingehend || aktiv ? " offen" : "")} data-tick={tick}>
      {(offen || eingehend || aktiv) && (
        <div className="sp-panel" role="dialog" aria-label="Telefon">
          <div className="sp-kopf">
            <b>Telefon</b>
            <div className="sp-status">
              {["bereit", "pause", "aus"].map((s) => (
                <button key={s} className={status === s ? "an" : ""} onClick={() => setStatus(s)} disabled={!!aktiv}>{STATUS_TEXT[s]}</button>
              ))}
            </div>
            {!eingehend && !aktiv && <button className="sp-x" aria-label="Schließen" onClick={() => setOffen(false)}>×</button>}
          </div>
          {fehler && <p className="sp-fehler">{fehler}</p>}

          {eingehend && (
            <div className="sp-klingelt">
              <span className="sp-label">Anruf</span>
              <Kopf info={eingehend.info} />
              <div className="sp-knoepfe">
                <button className="sp-gruen" onClick={annehmen}>Annehmen</button>
                <button className="sp-rot" onClick={() => { eingehend.call.reject(); setEingehend(null); }}>Ablehnen</button>
              </div>
            </div>
          )}

          {aktiv && (
            <div className="sp-aktiv">
              <span className="sp-label">{aktiv.raus ? "Rückruf" : "Im Gespräch"} · {Math.floor(dauer / 60)}:{String(dauer % 60).padStart(2, "0")}</span>
              <Kopf info={aktiv.info} />
              <div className="sp-knoepfe">
                <button className="b small ghost" onClick={() => { aktiv.call.mute(!stumm); setStumm(!stumm); }}>{stumm ? "Mikro an" : "Stumm"}</button>
                <button className="sp-rot" onClick={() => aktiv.call.disconnect()}>Auflegen</button>
              </div>
            </div>
          )}

          {erfassen && <Erfassung key={erfassen.anruf.id + (erfassen.kontakt?.id || "")} info={erfassen} sb={sb} fertig={() => setErfassen(null)} laeuft={!!aktiv} />}

          {!eingehend && !aktiv && !erfassen && (
            <p className="sp-hinweis">
              {status === "bereit"
                ? "Bereit: Lead-Anrufe klingeln hier. Tab offen lassen. Wer nicht annimmt, wird nach der Klingelzeit weitergeleitet."
                : status === "pause"
                ? "Pause: Anrufe gehen direkt an das nächste Ziel (z. B. Handy)."
                : "Aus: Anrufe klingeln hier nicht."}
            </p>
          )}
        </div>
      )}
      <button className={"sp-pille s-" + zeigeStatus} onClick={() => setOffen(!offen)} aria-expanded={offen}>
        <span className="sp-punkt" />
        Telefon: {STATUS_TEXT[zeigeStatus]}
      </button>
    </div>
  );
}

function Kopf({ info }) {
  const { anruf, anzeige, frueher } = info;
  return (
    <div className="sp-anrufer">
      <b>{national(anruf.von) || "Unbekannt"}</b>
      {anruf.stadtAnrufer && <span>{anruf.stadtAnrufer}</span>}
      <div className="sp-tags">
        {anruf.kategorie && <span className="sp-tag k">{anruf.kategorie}</span>}
        {anruf.code && <span className="sp-tag mono">{anruf.code}</span>}
        {anruf.kanal === "social" && <span className="sp-tag">Social</span>}
        {anruf.nachlauf && <span className="sp-tag">alte Anzeige</span>}
      </div>
      <small>
        {[anzeige?.motiv?.headline && `„${anzeige.motiv.headline}“`, anruf.blatt, anruf.kampagne].filter(Boolean).join(" · ") || "Keine Anzeige zugeordnet"}
        {frueher > 0 && <><br /><b>Hat schon {frueher}× angefragt</b></>}
      </small>
    </div>
  );
}

function Erfassung({ info, sb, fertig, laeuft }) {
  const k = info.kontakt || {};
  const [w, setW] = useState(() => ({ antworten: k.antworten || {}, qualifiziert: !!k.qualifiziert, einwilligung: !!k.einwilligung, notiz: k.notiz || "", plz: k.plz || "", name: k.name || "" }));
  const [msg, setMsg] = useState("");
  const set = (patch) => setW((x) => ({ ...x, ...patch }));
  async function speichern() {
    const antworten = w.antworten;
    const name = w.name || antworten["Name"] || antworten["Name des Anrufers"] || "";
    const plzText = antworten[Object.keys(antworten).find((x) => /postleitzahl/i.test(x))] || w.plz;
    const plz = (String(plzText).match(/\b\d{5}\b/) || [""])[0];
    const patch = { antworten, name, plz, qualifiziert: w.qualifiziert, einwilligung: w.einwilligung, notiz: w.notiz, erfasstAm: Date.now() };
    // Nachweis der Einwilligung (Art. 7 Abs. 1 DSGVO): Wortlaut, Zeitpunkt, Kanal, wer gefragt hat. Nur beim ersten Häkchen setzen.
    if (w.einwilligung && !k.einwilligung) {
      const { data: u } = await sb.auth.getUser();
      Object.assign(patch, { einwilligungText: info.einwilligung, einwilligungAm: Date.now(), einwilligungKanal: "Telefon", einwilligungDurch: u?.user?.email || "", einwilligungAnruf: info.anruf.id || "" });
    }
    if (!w.einwilligung && k.einwilligung) Object.assign(patch, { einwilligungWiderrufenAm: Date.now() });
    let id = info.anruf.kontaktId;
    let error;
    if (id) ({ error } = await sb.rpc("lp_merge", { p_collection: "kontakte", p_id: id, p_patch: patch }));
    else {
      id = Math.random().toString(36).slice(2, 14);
      ({ error } = await sb.from("lp_docs").insert({ collection: "kontakte", id, data: { ...patch, anzeigeId: info.anruf.anzeigeId || "", code: info.anruf.code || "", kategorie: info.anruf.kategorie || "", kanal: "Telefon", quelle: "rueckruf", telefon: info.anruf.von || "", datum: new Date().toISOString().slice(0, 10), erloes: 0, createdAt: Date.now() } }));
    }
    if (error) setMsg("Fehler: " + error.message);
    else { setMsg("Gespeichert"); setTimeout(fertig, 700); }
  }
  return (
    <div className="sp-form">
      <details open={laeuft} className="sp-skript">
        <summary>Leitfaden</summary>
        <p>{info.skript.intro}</p>
      </details>
      {info.skript.fragen.map((f) => (
        <label key={f}>
          <span>{f}</span>
          <input value={w.antworten[f] || ""} onChange={(e) => set({ antworten: { ...w.antworten, [f]: e.target.value } })} />
        </label>
      ))}
      <div className="sp-einw">
        <p>„{info.einwilligung}“</p>
        <label className="sp-check"><input type="checkbox" checked={w.einwilligung} onChange={(e) => set({ einwilligung: e.target.checked })} /> Einwilligung erteilt</label>
      </div>
      <label className="sp-check"><input type="checkbox" checked={w.qualifiziert} onChange={(e) => set({ qualifiziert: e.target.checked })} /> Qualifizierter Lead (Eigentümer, Bedarf, erreichbar)</label>
      <label><span>Notiz</span><textarea rows={2} value={w.notiz} onChange={(e) => set({ notiz: e.target.value })} /></label>
      <details className="sp-skript"><summary>Abschluss</summary><p>{info.skript.abschluss}</p></details>
      <div className="sp-knoepfe">
        <button className="b small primary" onClick={speichern}>Kontakt speichern</button>
        {!laeuft && <button className="b small ghost" onClick={fertig}>Verwerfen</button>}
        {msg && <span className="sp-msg">{msg}</span>}
      </div>
    </div>
  );
}
