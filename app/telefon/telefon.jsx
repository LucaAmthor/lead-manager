"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { skriptFuer, STANDARD_SKRIPT, STANDARD_SKRIPTE, mailboxAbfrage, EINWILLIGUNG_STANDARD, DATENSCHUTZ_HINWEIS_STANDARD } from "@/lib/telefon/skripte";
import { national } from "../_telefon/softphone";

// Seite „Telefon“: Rückrufe, Anrufliste, Auslastung der Caller, Nummernpool, Einrichtung und Einstellungen.
const SAMMLUNGEN = ["anrufe", "nummern", "anzeigen", "kontakte", "einstellungen", "telefon_praesenz", "telefon_zeit"];
const KATS = ["Wärmepumpe", "PV", "Altenpflege", "Heizung", "Badsanierung", "Treppenlift", "Küche", "Fenster & Türen", "Dach & Dämmung", "Immobilie verkaufen"];
const STATUS = { klingelt: "klingelt", laeuft: "läuft", beendet: "angenommen", verpasst: "verpasst", mailbox: "Mailbox", nicht_erreicht: "nicht erreicht", assistent: "Assistent" };
const TAGE = [[1, "Mo"], [2, "Di"], [3, "Mi"], [4, "Do"], [5, "Fr"], [6, "Sa"], [0, "So"]];
const STANDARD_ZIELE = [{ typ: "browser", name: "Browser (alle, die bereit sind)", sekunden: 20 }, { typ: "nummer", name: "Flo Handy", nummer: "", sekunden: 25 }];
const zeit = (t) => (t ? new Date(t).toLocaleString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");
const min = (s) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}` : "–");
const pct = (x) => (x == null || !isFinite(x) ? "–" : Math.round(x * 100) + " %");
const tagMs = 864e5;

function useDaten() {
  const [d, setD] = useState(() => Object.fromEntries(SAMMLUNGEN.map((c) => [c, new Map()])));
  const [bereit, setBereit] = useState(false);
  const sb = useMemo(() => createClient(), []);
  useEffect(() => {
    let aus = false;
    sb.from("lp_docs").select("collection, id, data").in("collection", SAMMLUNGEN).then(({ data }) => {
      if (aus) return;
      const neu = Object.fromEntries(SAMMLUNGEN.map((c) => [c, new Map()]));
      (data || []).forEach((r) => neu[r.collection].set(r.id, { id: r.id, ...r.data }));
      setD(neu);
      setBereit(true);
    });
    const ch = sb
      .channel("lp-telefon")
      .on("postgres_changes", { event: "*", schema: "public", table: "lp_docs" }, (p) => {
        const col = p.new?.collection || p.old?.collection;
        if (!SAMMLUNGEN.includes(col)) return;
        setD((alt) => {
          const m = new Map(alt[col]);
          if (p.eventType === "DELETE") m.delete(p.old.id);
          else m.set(p.new.id, { id: p.new.id, ...p.new.data });
          return { ...alt, [col]: m };
        });
      })
      .subscribe();
    return () => { aus = true; sb.removeChannel(ch); };
  }, [sb]);
  return { sb, bereit, d, arr: (c) => [...d[c].values()] };
}

async function aktion(body) {
  const r = await fetch("/api/telefon", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.detail || j.code || `Fehler ${r.status}`);
  return j;
}

export default function Telefon({ email }) {
  const { sb, bereit, d, arr } = useDaten();
  const [info, setInfo] = useState(null);
  const [toast, setToast] = useState("");
  const [ansicht, setAnsicht] = useState("alle");
  const melden = useCallback((t) => { setToast(t); setTimeout(() => setToast(""), 4000); }, []);
  const tun = useCallback(async (body, ok) => {
    try { const j = await aktion(body); if (ok) melden(typeof ok === "function" ? ok(j) : ok); return j; } catch (e) { melden("Fehler: " + e.message); }
  }, [melden]);
  const laden = useCallback(() => fetch("/api/telefon?detail=1").then((r) => r.json()).then(setInfo).catch(() => {}), []);
  useEffect(() => { laden(); }, [laden]);

  const cfg = d.einstellungen.get("telefon") || {};
  const status = d.einstellungen.get("telefon_status") || {};
  const allg = d.einstellungen.get("allgemein") || {};
  async function cfgSpeichern(patch) {
    const neu = { ...cfg, ...patch };
    delete neu.id;
    const { error } = await sb.from("lp_docs").upsert({ collection: "einstellungen", id: "telefon", data: neu, updated_at: new Date().toISOString() });
    melden(error ? "Fehler: " + error.message : "Gespeichert");
  }

  const jetzt = Date.now();
  const anrufe = arr("anrufe").sort((a, b) => (b.start || 0) - (a.start || 0));
  const ein = anrufe.filter((a) => a.richtung !== "aus");
  const sieben = ein.filter((a) => (a.start || 0) > jetzt - 7 * tagMs);
  const heute = ein.filter((a) => new Date(a.start).toDateString() === new Date().toDateString());
  const imDienst = sieben.filter((a) => !a.ausserhalb);
  const quote = imDienst.length ? imDienst.filter((a) => a.angenommen).length / imDienst.length : null;
  const gespraeche = sieben.filter((a) => a.angenommen && a.gespraechSek);
  const rueckrufe = ein.filter((a) => a.rueckruf === "offen");
  const praesenz = arr("telefon_praesenz").filter((p) => (p.lastSeen || 0) > jetzt - 150e3 && ["bereit", "gespraech"].includes(p.status));
  const quoteMin = (cfg.alarm?.quoteMin ?? 85) / 100;
  const alarmAktuell = status.letzterAlarm && jetzt - status.letzterAlarm < tagMs;

  const sichtbar = ansicht === "verpasst" ? ein.filter((a) => ["verpasst", "mailbox"].includes(a.status)) : ansicht === "raus" ? anrufe.filter((a) => a.richtung === "aus") : anrufe;
  const anzeige = (id) => d.anzeigen.get(id);
  const zurueckrufen = (a) => window.dispatchEvent(new CustomEvent("lp-anrufen", { detail: { nummer: a.von, anrufId: a.id } }));

  return (
    <div className="bk">
      <header className="bk-kopf">
        <a href="/" className="bk-zurueck">← Lokalpilot</a>
        <div>
          <h1>Telefon</h1>
          <p>Jede Anzeige hat ihre eigene Nummer. Anrufe klingeln bei allen, die im Browser „bereit“ sind, danach auf dem nächsten Ziel (z. B. Flos Handy), zuletzt Mailbox. Jeder Anruf wird automatisch als Kontakt der Anzeige gezählt.</p>
        </div>
      </header>

      <section className="bk-kpis">
        <Kpi wert={heute.length} label="Anrufe heute" />
        <Kpi wert={pct(quote)} label="angenommen (7 Tage)" ton={quote != null && quote < quoteMin ? "crit" : ""} />
        <Kpi wert={rueckrufe.length} label="Rückrufe offen" ton={rueckrufe.length ? "crit" : ""} />
        <Kpi wert={min(gespraeche.reduce((s, a) => s + a.gespraechSek, 0) / (gespraeche.length || 1))} label="Ø Gespräch" />
        <Kpi wert={praesenz.length} label="jetzt bereit" ton={!praesenz.length ? "crit" : ""} />
      </section>

      {(alarmAktuell || (quote != null && quote < quoteMin && imDienst.length >= 5)) && (
        <div className="tf-hinweis">
          <b>Mehr Kapazität nötig?</b> {alarmAktuell ? status.letzterAlarmText?.split("\n")[0] : `Nur ${pct(quote)} der Anrufe in den letzten 7 Tagen wurden angenommen (Ziel ${pct(quoteMin)}).`} Weitere Person auf „bereit“ stellen oder einen externen Telefondienst als Ziel eintragen (Einstellungen → Anruf-Weg).
        </div>
      )}

      <Einrichtung info={info} cfg={cfg} tun={tun} laden={laden} nummern={arr("nummern")} />

      <section className="bk-karte">
        <div className="bk-sechead"><h2>Rückrufe und Mailbox</h2><span className="bk-hint">Verpasste Anrufe und Nachrichten. „Zurückrufen“ ruft über den Browser an, mit der Anzeigen-Nummer als Absender.</span></div>
        {!rueckrufe.length ? <p className="bk-leer">Alles erledigt.</p> : (
          <div className="bk-tabelle"><table><thead><tr><th>Wann</th><th>Anrufer</th><th>Anzeige</th><th>Nachricht</th><th></th></tr></thead><tbody>
            {rueckrufe.map((a) => (
              <tr key={a.id}>
                <td>{zeit(a.start)}</td>
                <td><b>{national(a.von)}</b>{a.stadtAnrufer ? <div className="muted">{a.stadtAnrufer}</div> : null}</td>
                <td><span className="mono">{a.code || "–"}</span><div className="muted">{a.kategorie}</div></td>
                <td>{a.assistent ? <Assistent a={a.assistent} /> : a.aufnahmeSid ? <audio className="tf-audio" controls preload="none" src={`/api/telefon/aufnahme?sid=${a.aufnahmeSid}`} /> : <span className="muted">keine</span>}</td>
                <td><div className="tf-zeile"><button className="b small primary" onClick={() => zurueckrufen(a)}>Zurückrufen</button><button className="b small ghost" onClick={() => tun({ aktion: "rueckruf", anrufId: a.id }, "Erledigt")}>Erledigt</button></div></td>
              </tr>
            ))}
          </tbody></table></div>
        )}
      </section>

      <section className="bk-karte">
        <div className="bk-sechead">
          <h2>Anrufe</h2>
          <div className="bk-tabs">{[["alle", "Alle"], ["verpasst", "Verpasst"], ["raus", "Rückrufe"]].map(([k, l]) => <button key={k} className={ansicht === k ? "an" : ""} onClick={() => setAnsicht(k)}>{l}</button>)}</div>
        </div>
        {!bereit ? <p className="bk-leer">Lade …</p> : !sichtbar.length ? <p className="bk-leer">Noch keine Anrufe.</p> : (
          <div className="bk-tabelle"><table><thead><tr><th>Wann</th><th>{ansicht === "raus" ? "Angerufen" : "Anrufer"}</th><th>Anzeige</th><th>Status</th><th>Angenommen von</th><th>Dauer</th><th>Kontakt</th></tr></thead><tbody>
            {sichtbar.slice(0, 80).map((a) => {
              const k = d.kontakte.get(a.kontaktId);
              const an = anzeige(a.anzeigeId);
              return (
                <tr key={a.id}>
                  <td>{zeit(a.start)}{a.ausserhalb ? <div className="muted">außerhalb der Zeiten</div> : null}</td>
                  <td><b>{national(a.richtung === "aus" ? a.an : a.von)}</b>{a.stadtAnrufer ? <div className="muted">{a.stadtAnrufer}</div> : null}</td>
                  <td><span className="mono">{a.code || "–"}</span><div className="muted">{[a.kategorie, a.blatt || an?.stadt, a.kanal === "social" ? "Social" : ""].filter(Boolean).join(" · ")}</div></td>
                  <td><span className={"tf-st " + a.status}>{STATUS[a.status] || a.status}</span>{a.ueberlauf ? <div className="muted">Überlauf</div> : null}</td>
                  <td>{a.angenommenEmail || a.angenommenVon || "–"}</td>
                  <td className="mono">{min(a.gespraechSek)}</td>
                  <td>{k ? <>{k.name || "–"}{k.qualifiziert ? <div className="good">qualifiziert</div> : null}</> : "–"}</td>
                </tr>
              );
            })}
          </tbody></table></div>
        )}
      </section>

      <Auslastung anrufe={sieben} zeit={arr("telefon_zeit")} praesenz={arr("telefon_praesenz")} />

      <Pool nummern={arr("nummern")} anzeige={anzeige} tun={tun} cfg={cfg} />

      <Einstellungen cfg={cfg} speichern={cfgSpeichern} marke={allg.marke || "Modernisieren24"} />
      {toast && <div className="bk-toast">{toast}</div>}
      <p className="bk-fuss">Angemeldet als {email}</p>
    </div>
  );
}

function Assistent({ a }) {
  return (
    <div style={{ maxWidth: 420 }}>
      <div><b>Digitaler Assistent:</b> {a.zusammenfassung || "keine Zusammenfassung"}</div>
      {Object.entries(a.angaben || {}).map(([k, v]) => <div key={k} className="muted">{k}: {v}</div>)}
      {!!a.transkript?.length && (
        <details><summary className="linkbtn">Gespräch lesen</summary>{a.transkript.map((t, i) => <div key={i}><b>{t.wer}:</b> {t.text}</div>)}</details>
      )}
    </div>
  );
}

const Kpi = ({ wert, label, ton }) => <div className={"bk-kpi " + (ton || "")}><b>{wert}</b><span>{label}</span></div>;

function Einrichtung({ info, cfg, tun, laden, nummern }) {
  if (!info) return null;
  const t = info.twilio || {};
  const env = info.env || {};
  const bundleOk = (t.bundles || []).some((b) => b.status === "twilio-approved");
  const bundleWartet = (t.bundles || []).find((b) => ["pending-review", "in-review", "draft"].includes(b.status));
  const handy = (cfg.ziele || STANDARD_ZIELE).some((z) => z.typ === "nummer" && z.nummer && z.aktiv !== false);
  const punkte = [
    [env.twilio, "Twilio-Zugang in Vercel: TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN (Twilio Console → Account Info), danach neu deployen"],
    [env.appUrl, "APP_URL in Vercel (für die Webhooks)"],
    [env.service && env.cron, "SUPABASE_SERVICE_ROLE_KEY und CRON_SECRET (schon vom Buchungs-Agenten da)"],
    [bundleOk, bundleOk ? "Unterlagen bei Twilio freigegeben" : bundleWartet ? `Unterlagen bei Twilio eingereicht, Prüfung läuft (${bundleWartet.status})` : "Unterlagen bei Twilio einreichen: Console → Phone Numbers → Regulatory Compliance → Bundles → Create (Deutschland, Local, Business, Handelsregisterauszug SolarSale24)"],
    [(t.adressen || []).length > 0, (t.adressen || []).length ? `Adresse: ${t.adressen[0].text}` : "Adresse bei Twilio hinterlegen (Firmensitz, muss im Ortsnetz der Nummern liegen)"],
    [!!cfg.ortsnetz, cfg.ortsnetz ? `Ortsnetz ${cfg.ortsnetz}` : "Ortsnetz (Vorwahl des Firmensitzes) unten in den Einstellungen eintragen"],
    [t.browser, "Browser-Telefon eingerichtet"],
    [handy, "Handy-Ziel eingetragen (Einstellungen → Anruf-Weg)"],
    [nummern.length > 0, nummern.length ? `${nummern.length} Nummern im Pool` : "Erste Nummer kaufen oder vorhandene übernehmen"],
  ];
  const assistent = [
    [env.assistent, "Digitaler Assistent (optional): ELEVENLABS_API_KEY in Vercel (elevenlabs.io → Developers → API Keys)"],
    [env.assistentWebhook, "ElevenLabs Post-Call-Webhook auf " + (env.appUrl || "https://<app>") + "/api/telefon/assistent, Secret als ELEVENLABS_WEBHOOK_SECRET in Vercel"],
    [!!cfg.assistentAgentId, cfg.assistentAgentId ? `Assistent angelegt (${cfg.assistentAgentId})` : "Assistent anlegen (Knopf unten)"],
  ];
  const fertig = punkte.every(([ok]) => ok);
  return (
    <section className="bk-karte bk-setup">
      <div className="bk-sechead"><h2>Einrichtung</h2>{fertig ? <span className="good">Alles bereit</span> : <span className="bk-hint">Was noch fehlt</span>}</div>
      {info.twilioFehler && <p className="crit">Twilio: {info.twilioFehler}</p>}
      <ul>{punkte.map(([ok, text]) => <li key={text} className={ok ? "ok" : ""}>{ok ? "✓" : "○"} {text}</li>)}</ul>
      <h4>Digitaler Assistent</h4>
      <ul>{assistent.map(([ok, text]) => <li key={text} className={ok ? "ok" : ""}>{ok ? "✓" : "○"} {text}</li>)}</ul>
      <div className="bk-aktionen">
        {env.twilio && <button className="b small primary" onClick={async () => { const j = await tun({ aktion: "einrichten" }, (j) => `Eingerichtet (${j.nummern} Nummern verbunden)`); if (j && !t.browser) setTimeout(() => window.location.reload(), 1200); else laden(); }}>{t.browser ? "Webhooks erneuern" : "Browser-Telefon einrichten"}</button>}
        {env.twilio && <button className="b small ghost" onClick={laden}>Neu prüfen</button>}
        {env.assistent && !cfg.assistentAgentId && <button className="b small ghost" onClick={async () => { await tun({ aktion: "assistent_einrichten" }, "Assistent angelegt – im Anruf-Weg noch aktivieren"); laden(); }}>Digitalen Assistenten anlegen</button>}
      </div>
      {!!t.fremdeNummern?.length && (
        <>
          <h4>Vorhandene Twilio-Nummern übernehmen</h4>
          <div className="bk-tabelle"><table><tbody>{t.fremdeNummern.map((n) => (
            <tr key={n.sid}><td className="mono">{national(n.e164)}</td><td className="muted">{n.name}</td><td>{n.voiceUrl ? <span className="muted">Webhook: {n.voiceUrl}</span> : null}</td>
              <td><button className="b small ghost" onClick={async () => { await tun({ aktion: "uebernehmen", pnSid: n.sid }, "Übernommen"); laden(); }}>In den Pool</button></td></tr>
          ))}</tbody></table></div>
          <p className="bk-hint">Achtung: Übernehmen leitet Anrufe dieser Nummer ab sofort über Lokalpilot.</p>
        </>
      )}
    </section>
  );
}

function Auslastung({ anrufe, zeit: zeiten, praesenz }) {
  const grenze = new Date(Date.now() - 7 * tagMs).toISOString().slice(0, 10);
  const leute = new Map();
  const p = (id, email) => { if (!leute.has(id)) leute.set(id, { id, email: email || id, online: 0, gespraeche: 0, sek: 0 }); return leute.get(id); };
  zeiten.filter((z) => z.datum >= grenze).forEach((z) => { p(z.identitaet, z.email).online += Number(z.minuten) || 0; });
  anrufe.filter((a) => a.angenommen && a.angenommenVon).forEach((a) => { const x = p(a.angenommenVon, a.angenommenEmail); x.gespraeche++; x.sek += Number(a.gespraechSek) || 0; });
  praesenz.forEach((x) => { if (leute.has(x.id)) leute.get(x.id).status = (x.lastSeen || 0) > Date.now() - 150e3 ? x.status : "offline"; });
  const stunden = Array.from({ length: 24 }, (_, h) => anrufe.filter((a) => new Date(a.start).getHours() === h).length);
  const maxH = Math.max(1, ...stunden);
  return (
    <section className="bk-karte">
      <div className="bk-sechead"><h2>Auslastung (7 Tage)</h2><span className="bk-hint">Auslastung = Gesprächszeit ÷ Zeit „bereit“. Über ~60 % wird es eng, dann kommen Anrufe nicht mehr durch.</span></div>
      {!leute.size ? <p className="bk-leer">Noch keine Daten. Sobald jemand im Browser „bereit“ ist oder am Handy annimmt, erscheint es hier.</p> : (
        <div className="bk-tabelle"><table><thead><tr><th>Wer</th><th>jetzt</th><th className="num">bereit (Std.)</th><th className="num">Gespräche</th><th className="num">Gesprächszeit</th><th className="num">Auslastung</th></tr></thead><tbody>
          {[...leute.values()].sort((a, b) => b.gespraeche - a.gespraeche).map((x) => (
            <tr key={x.id}><td>{x.email}</td><td>{x.status ? <span className={"tf-st " + (x.status === "bereit" ? "frei" : x.status === "gespraech" ? "zugewiesen" : "")}>{x.status}</span> : "–"}</td>
              <td className="num">{x.online ? (x.online / 60).toFixed(1) : "–"}</td><td className="num">{x.gespraeche}</td><td className="num">{min(x.sek)}</td>
              <td className={"num " + (x.online && x.sek / 60 / x.online > 0.6 ? "crit" : "")}>{x.online ? pct(x.sek / 60 / x.online) : "–"}</td></tr>
          ))}
        </tbody></table></div>
      )}
      <h4>Anrufe nach Uhrzeit</h4>
      <div className="tf-stunden">{stunden.map((n, h) => <div key={h} className={n ? "" : "leer"} style={{ height: `${(n / maxH) * 100}%` }} title={`${h}–${h + 1} Uhr: ${n} Anrufe`} />)}</div>
      <div className="tf-achse">{stunden.map((_, h) => <span key={h}>{h % 3 === 0 ? h : ""}</span>)}</div>
    </section>
  );
}

function Pool({ nummern, anzeige, tun, cfg }) {
  const liste = nummern.sort((a, b) => String(a.status).localeCompare(String(b.status)) || String(a.e164).localeCompare(String(b.e164)));
  const z = { frei: 0, zugewiesen: 0, ruhend: 0 };
  liste.forEach((n) => { z[n.status] = (z[n.status] || 0) + 1; });
  return (
    <section className="bk-karte">
      <div className="bk-sechead">
        <h2>Nummernpool</h2>
        <span className="bk-hint">{z.zugewiesen} vergeben · {z.frei} frei · {z.ruhend} ruhen · höchstens {cfg.maxNummern ?? 30}. Nach dem Ende einer Anzeige ruht die Nummer {cfg.ruheTage ?? 42} Tage (Nachzügler zählen noch zur alten Anzeige), dann wird sie wiederverwendet.</span>
      </div>
      <div className="bk-aktionen" style={{ marginTop: 0, marginBottom: 10 }}>
        <button className="b small primary" onClick={() => tun({ aktion: "zuweisen" }, (j) => `${j.vergeben} Nummern vergeben${j.gekauft ? `, ${j.gekauft} neu gekauft` : ""}${j.fehler?.length ? " – " + j.fehler[0] : ""}`)}>Nummern jetzt vergeben</button>
        <button className="b small ghost" onClick={() => tun({ aktion: "kaufen" }, (j) => `Gekauft: ${j.nummer}`)}>Nummer kaufen (Print)</button>
        <button className="b small ghost" onClick={() => tun({ aktion: "kaufen", kanal: "social" }, (j) => `Gekauft: ${j.nummer}`)}>Nummer kaufen (Social)</button>
      </div>
      {!liste.length ? <p className="bk-leer">Noch keine Nummern. Lokalpilot kauft sie automatisch, sobald Anzeigen einen Termin haben (Einrichtung oben abschließen).</p> : (
        <div className="bk-tabelle"><table><thead><tr><th>Nummer</th><th>Status</th><th>Anzeige</th><th>Kanal</th><th>Seit / bis</th><th></th></tr></thead><tbody>
          {liste.map((n) => {
            const a = anzeige(n.anzeigeId || n.letzteAnzeigeId);
            return (
              <tr key={n.id}>
                <td className="mono">{n.anzeige || national(n.e164)}{n.typ && n.typ !== "lokal" ? <div className="muted">{n.typ}</div> : null}</td>
                <td><span className={"tf-st " + n.status}>{n.status}</span></td>
                <td><span className="mono">{n.code || n.letzterCode || "–"}</span>{a ? <div className="muted">{[a.kategorie, a.datum].filter(Boolean).join(" · ")}</div> : null}</td>
                <td>{n.kanal === "social" ? "Social" : "Print"}</td>
                <td className="muted">{n.status === "ruhend" && n.ruhtBis ? `frei ab ${new Date(n.ruhtBis).toLocaleDateString("de-DE")}` : n.zugewiesenAm ? `seit ${new Date(n.zugewiesenAm).toLocaleDateString("de-DE")}` : ""}</td>
                <td>{n.status === "gesperrt" ? <button className="linkbtn" onClick={() => tun({ aktion: "nummer", id: n.id, status: "frei" }, "Freigegeben")}>freigeben</button> : n.status !== "zugewiesen" ? <button className="linkbtn" onClick={() => tun({ aktion: "nummer", id: n.id, status: "gesperrt" }, "Gesperrt")}>sperren</button> : null}</td>
              </tr>
            );
          })}
        </tbody></table></div>
      )}
    </section>
  );
}

function Einstellungen({ cfg, speichern, marke }) {
  const [w, setW] = useState(null);
  const [kat, setKat] = useState("Wärmepumpe");
  useEffect(() => {
    setW({
      ortsnetz: cfg.ortsnetz || "", maxNummern: cfg.maxNummern ?? 30, ruheTage: cfg.ruheTage ?? 42, nachlaufTage: cfg.nachlaufTage ?? 56, vorlaufTage: cfg.vorlaufTage ?? 45,
      autoZuweisen: cfg.autoZuweisen !== false, autoKaufen: cfg.autoKaufen !== false, bestaetigen: cfg.bestaetigen !== false, mailboxMail: cfg.mailboxMail !== false,
      ziele: cfg.ziele?.length ? cfg.ziele : STANDARD_ZIELE, zeiten: { aktiv: false, tage: [1, 2, 3, 4, 5, 6], von: "08:00", bis: "20:00", ...(cfg.zeiten || {}) },
      mailboxText: cfg.mailboxText || "", ausserhalbText: cfg.ausserhalbText || "", einwilligung: cfg.einwilligung || "", datenschutzHinweis: cfg.datenschutzHinweis || "", benachrichtigen: (cfg.benachrichtigen || []).join(", "),
      alarm: { verpasst: 2, fensterMin: 60, quoteMin: 85, pauseStunden: 3, ...(cfg.alarm || {}) }, skripte: cfg.skripte || {},
    });
  }, [cfg]);
  if (!w) return null;
  const set = (p) => setW((x) => ({ ...x, ...p }));
  const ziel = (i, p) => set({ ziele: w.ziele.map((z, j) => (j === i ? { ...z, ...p } : z)) });
  const sk = { ...STANDARD_SKRIPT, ...(STANDARD_SKRIPTE[kat] || {}), ...(w.skripte[kat] || {}) };
  const skSet = (p) => set({ skripte: { ...w.skripte, [kat]: { ...(w.skripte[kat] || {}), ...p } } });
  const n = (x) => (x === "" ? "" : Number(x));
  function los() {
    speichern({ ...w, maxNummern: n(w.maxNummern), ruheTage: n(w.ruheTage), nachlaufTage: n(w.nachlaufTage), vorlaufTage: n(w.vorlaufTage), ziele: w.ziele.map((z) => ({ ...z, sekunden: Number(z.sekunden) || 20 })), benachrichtigen: w.benachrichtigen.split(/[,;\s]+/).filter((x) => x.includes("@")) });
  }
  return (
    <details className="bk-karte bk-einst">
      <summary><h2>Einstellungen</h2></summary>

      <h3>Anruf-Weg</h3>
      <p className="bk-hint">Reihenfolge, in der es klingelt. Browser-Stufe wird übersprungen, wenn niemand „bereit“ ist. Der digitale Assistent nimmt sofort ab, stellt sich als digitaler Assistent vor, fragt kurz die Angaben ab und kündigt einen Rückruf an (gehört daher ans Ende). Für die Übergabe an einen externen Telefondienst dessen Nummer als erste Stufe eintragen.</p>
      {w.ziele.map((z, i) => (
        <div className="tf-ziel" key={i}>
          <span className="tf-nr">Stufe {i + 1}</span>
          <label>Art<select value={z.typ} onChange={(e) => ziel(i, { typ: e.target.value })}><option value="browser">Browser (alle bereiten)</option><option value="nummer">Telefonnummer</option><option value="assistent">Digitaler Assistent</option></select></label>
          {z.typ === "nummer" ? <label>Nummer<input value={z.nummer || ""} placeholder="0171 …" onChange={(e) => ziel(i, { nummer: e.target.value })} /></label> : z.typ === "assistent" ? <label>Nicht bei Kategorien<input value={z.ohneKategorien || ""} placeholder="z. B. Altenpflege" onChange={(e) => ziel(i, { ohneKategorien: e.target.value })} /></label> : <span />}
          <label>Name<input value={z.name || ""} onChange={(e) => ziel(i, { name: e.target.value })} /></label>
          {z.typ === "assistent" ? <label className="tf-check" title="Außerhalb der festen Zeiten nimmt der Assistent statt der Mailbox ab"><input type="checkbox" checked={z.auchAusserhalb !== false} onChange={(e) => ziel(i, { auchAusserhalb: e.target.checked })} /> auch nachts</label> : <label>Sekunden<input type="number" min="5" max="60" value={z.sekunden ?? 20} onChange={(e) => ziel(i, { sekunden: e.target.value })} /></label>}
          <div className="tf-zeile">
            <label className="tf-check" title="Pausierte Stufen werden übersprungen, die Nummer bleibt gespeichert"><input type="checkbox" checked={z.aktiv !== false} onChange={(e) => ziel(i, { aktiv: e.target.checked })} /> aktiv</label>
            <button className="linkbtn" disabled={!i} onClick={() => { const a = [...w.ziele]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; set({ ziele: a }); }}>↑</button>
            <button className="linkbtn" onClick={() => set({ ziele: w.ziele.filter((_, j) => j !== i) })}>entfernen</button>
          </div>
        </div>
      ))}
      <div className="bk-aktionen"><button className="b small ghost" onClick={() => set({ ziele: [...w.ziele, { typ: "nummer", name: "", nummer: "", sekunden: 20 }] })}>Stufe hinzufügen</button></div>
      <label className="tf-check"><input type="checkbox" checked={w.bestaetigen} onChange={(e) => set({ bestaetigen: e.target.checked })} /> Am Handy mit Taste 1 annehmen (sonst landet der Anruf auf der Handy-Mailbox statt bei uns)</label>

      <h3>Erreichbarkeit</h3>
      <label className="tf-check"><input type="checkbox" checked={w.zeiten.aktiv} onChange={(e) => set({ zeiten: { ...w.zeiten, aktiv: e.target.checked } })} /> Feste Zeiten (außerhalb direkt Mailbox)</label>
      {w.zeiten.aktiv && (
        <div className="bk-grid">
          <div className="tf-tage">{TAGE.map(([t, l]) => <label key={t}><input type="checkbox" checked={w.zeiten.tage.includes(t)} onChange={(e) => set({ zeiten: { ...w.zeiten, tage: e.target.checked ? [...w.zeiten.tage, t] : w.zeiten.tage.filter((x) => x !== t) } })} />{l}</label>)}</div>
          <label>Von<input type="time" value={w.zeiten.von} onChange={(e) => set({ zeiten: { ...w.zeiten, von: e.target.value } })} /></label>
          <label>Bis<input type="time" value={w.zeiten.bis} onChange={(e) => set({ zeiten: { ...w.zeiten, bis: e.target.value } })} /></label>
        </div>
      )}
      <div className="bk-grid">
        <label>Mailbox-Ansage ({"{marke}"} = Marke, {"{abfrage}"} = was je Kategorie abgefragt wird, siehe Gesprächsleitfaden)<textarea rows={3} value={w.mailboxText} placeholder="Standardtext" onChange={(e) => set({ mailboxText: e.target.value })} /></label>
        <label>Ansage außerhalb der Zeiten<textarea rows={3} value={w.ausserhalbText} placeholder="Standardtext" onChange={(e) => set({ ausserhalbText: e.target.value })} /></label>
        <label>Datenschutz-Hinweis (wird in jeder Mailbox-Ansage vor dem Signalton gesagt)<textarea rows={2} value={w.datenschutzHinweis} placeholder={DATENSCHUTZ_HINWEIS_STANDARD} onChange={(e) => set({ datenschutzHinweis: e.target.value })} /></label>
        <label>Einwilligung zur Weitergabe (liest der Caller vor, gilt auch für WhatsApp; {"{anbieter}"} = Anbieter der Kategorie)<textarea rows={4} value={w.einwilligung} placeholder={EINWILLIGUNG_STANDARD} onChange={(e) => set({ einwilligung: e.target.value })} /></label>
      </div>

      <h3>Nummernpool</h3>
      <div className="bk-grid">
        <label>Ortsnetz (Vorwahl Firmensitz)<input value={w.ortsnetz} placeholder="z. B. 05341" onChange={(e) => set({ ortsnetz: e.target.value })} /></label>
        <label>Höchstzahl Nummern<input type="number" value={w.maxNummern} onChange={(e) => set({ maxNummern: e.target.value })} /></label>
        <label>Vergeben ab … Tage vor Erscheinen<input type="number" value={w.vorlaufTage} onChange={(e) => set({ vorlaufTage: e.target.value })} /></label>
        <label>Bei der Anzeige bleiben … Tage nach Erscheinen<input type="number" value={w.nachlaufTage} onChange={(e) => set({ nachlaufTage: e.target.value })} /></label>
        <label>Ruhezeit vor Wiederverwendung (Tage)<input type="number" value={w.ruheTage} onChange={(e) => set({ ruheTage: e.target.value })} /></label>
      </div>
      <label className="tf-check"><input type="checkbox" checked={w.autoZuweisen} onChange={(e) => set({ autoZuweisen: e.target.checked })} /> Nummern automatisch vergeben (stündlich)</label>
      <label className="tf-check"><input type="checkbox" checked={w.autoKaufen} onChange={(e) => set({ autoKaufen: e.target.checked })} /> Fehlende Nummern automatisch kaufen (bis zur Höchstzahl, ca. 1,35 $ je Nummer und Monat)</label>

      <h3>Benachrichtigung</h3>
      <div className="bk-grid">
        <label>E-Mail an (leer = alle Admins)<input value={w.benachrichtigen} onChange={(e) => set({ benachrichtigen: e.target.value })} /></label>
        <label>Alarm ab … verpassten Anrufen<input type="number" value={w.alarm.verpasst} onChange={(e) => set({ alarm: { ...w.alarm, verpasst: Number(e.target.value) } })} /></label>
        <label>… innerhalb von Minuten<input type="number" value={w.alarm.fensterMin} onChange={(e) => set({ alarm: { ...w.alarm, fensterMin: Number(e.target.value) } })} /></label>
        <label>Ziel Annahmequote (%)<input type="number" value={w.alarm.quoteMin} onChange={(e) => set({ alarm: { ...w.alarm, quoteMin: Number(e.target.value) } })} /></label>
      </div>
      <label className="tf-check"><input type="checkbox" checked={w.mailboxMail} onChange={(e) => set({ mailboxMail: e.target.checked })} /> E-Mail bei jeder neuen Mailbox-Nachricht</label>

      <h3>Gesprächsleitfaden</h3>
      <div className="bk-grid">
        <label>Kategorie<select value={kat} onChange={(e) => setKat(e.target.value)}>{KATS.map((k) => <option key={k}>{k}</option>)}</select></label>
      </div>
      <div className="bk-grid">
        <label>Begrüßung<textarea rows={3} value={sk.intro} onChange={(e) => skSet({ intro: e.target.value })} /></label>
        <label>Fragen (eine je Zeile, werden zu Eingabefeldern)<textarea rows={6} value={(sk.fragen || []).join("\n")} onChange={(e) => skSet({ fragen: e.target.value.split("\n") })} /></label>
        <label>Abschluss<textarea rows={3} value={sk.abschluss} onChange={(e) => skSet({ abschluss: e.target.value })} /></label>
        <label>Mailbox fragt ab ({"{abfrage}"} in der Ansage)<textarea rows={3} value={w.skripte[kat]?.mailbox ?? mailboxAbfrage(kat)} onChange={(e) => skSet({ mailbox: e.target.value })} /></label>
      </div>
      <p className="bk-hint">Vorschau Begrüßung: {skriptFuer(kat, w.skripte, marke).intro}</p>
      <p className="bk-hint">Vorschau Mailbox: {(w.mailboxText || "Guten Tag und danke für Ihren Anruf bei {marke}! Gerade sind alle Berater im Gespräch. Bitte nennen Sie nach dem Signalton {abfrage} Wir rufen Sie so schnell wie möglich zurück, spätestens am nächsten Werktag.").replace("{marke}", marke).replace("{abfrage}", w.skripte[kat]?.mailbox || mailboxAbfrage(kat))}</p>

      <div className="bk-aktionen"><button className="b primary" onClick={los}>Einstellungen speichern</button></div>
    </details>
  );
}
