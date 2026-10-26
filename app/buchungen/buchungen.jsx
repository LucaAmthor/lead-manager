"use client";
import { useEffect, useMemo, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { buchungsweg, STATUS_TEXT, OFFEN, eur, datumLang, tageBis, heuteISO, FORMATE, standardpreis, vergleichspreis } from "@/lib/buchung/regeln";

// Seite „Buchungen“: was der Buchungs-Agent tut, wo er Hilfe braucht, wie jedes Blatt gebucht wird.
const SAMMLUNGEN = ["blaetter", "anzeigen", "buchungen", "buchung_mails", "einstellungen", "kampagnen", "kontakte", "blatt_kandidaten", "recherche_auftraege"];
const TON = {
  neu: "info", shop_laeuft: "info", anfrage_gesendet: "info", zusage_gesendet: "info", gebucht: "good", abgeschlossen: "good",
  test_fertig: "good", wartet_freigabe: "warn", wartet_verifizierung: "warn", braucht_hilfe: "crit", abgelehnt: "muted", abgebrochen: "muted",
};
const zeit = (t) => (t ? new Date(t).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");

function useDaten() {
  const [d, setD] = useState(() => Object.fromEntries(SAMMLUNGEN.map((c) => [c, new Map()])));
  const [bereit, setBereit] = useState(false);
  const sb = useMemo(() => createClient(), []);
  useEffect(() => {
    let aus = false;
    sb.from("lp_docs")
      .select("collection, id, data")
      .in("collection", SAMMLUNGEN)
      .then(({ data }) => {
        if (aus) return;
        const neu = Object.fromEntries(SAMMLUNGEN.map((c) => [c, new Map()]));
        (data || []).forEach((r) => neu[r.collection].set(r.id, { id: r.id, ...r.data }));
        setD(neu);
        setBereit(true);
      });
    const ch = sb
      .channel("lp-buchungen")
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
    return () => {
      aus = true;
      sb.removeChannel(ch);
    };
  }, [sb]);
  const arr = (c) => [...d[c].values()];
  return { sb, bereit, d, arr };
}

async function aktion(body) {
  const r = await fetch("/api/buchung", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.detail || j.code || `Fehler ${r.status}`);
  return j;
}

export default function Buchungen({ email }) {
  const { sb, bereit, d, arr } = useDaten();
  const [info, setInfo] = useState(null);
  const [toast, setToast] = useState("");
  const [filter, setFilter] = useState("offen");
  const melden = useCallback((t) => {
    setToast(t);
    setTimeout(() => setToast(""), 3500);
  }, []);
  const tun = useCallback(
    async (body, ok) => {
      try {
        await aktion(body);
        if (ok) melden(ok);
      } catch (e) {
        melden("Fehler: " + e.message);
      }
    },
    [melden]
  );
  useEffect(() => {
    fetch("/api/buchung").then((r) => r.json()).then(setInfo).catch(() => {});
  }, []);

  const cfg = d.einstellungen.get("buchung") || {};
  const allg = d.einstellungen.get("allgemein") || {};
  const blaetter = arr("blaetter").filter((b) => !b.demo).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const blatt = (id) => d.blaetter.get(id);
  const buchungen = arr("buchungen").sort((a, b) => (b.erstelltAm || 0) - (a.erstelltAm || 0));
  const mails = arr("buchung_mails").sort((a, b) => (a.zeit || 0) - (b.zeit || 0));
  const belegt = new Set(buchungen.filter((b) => !["abgebrochen", "abgelehnt"].includes(b.status)).flatMap((b) => b.anzeigeIds || []));
  const offeneAnz = arr("anzeigen")
    .filter((a) => !a.demo && ["freigegeben", "geplant"].includes(a.status) && !belegt.has(a.id))
    .sort((a, b) => String(a.datum || "9").localeCompare(String(b.datum || "9")));

  async function cfgSpeichern(patch) {
    const neu = { ...cfg, ...patch };
    delete neu.id;
    const { error } = await sb.from("lp_docs").upsert({ collection: "einstellungen", id: "buchung", data: neu, updated_at: new Date().toISOString() });
    melden(error ? "Fehler: " + error.message : "Gespeichert");
  }
  async function blattSpeichern(b, patch) {
    const { error } = await sb.rpc("lp_merge", { p_collection: "blaetter", p_id: b.id, p_patch: { buchung: { ...(b.buchung || {}), ...patch } } });
    if (error) melden("Fehler: " + error.message);
  }

  const zaehler = {
    hilfe: buchungen.filter((b) => ["braucht_hilfe", "wartet_freigabe"].includes(b.status)).length,
    laufend: buchungen.filter((b) => OFFEN.includes(b.status)).length,
    gebucht: buchungen.filter((b) => ["gebucht", "abgeschlossen"].includes(b.status)).reduce((s, b) => s + (Number(b.preisNetto) || 0), 0),
  };
  const sichtbar = buchungen.filter((b) => (filter === "offen" ? OFFEN.includes(b.status) || b.status === "test_fertig" : filter === "hilfe" ? ["braucht_hilfe", "wartet_freigabe"].includes(b.status) : true));
  const unzugeordnet = mails.filter((m) => m.richtung === "ein" && !m.buchungId).reverse();

  return (
    <div className="bk">
      <header className="bk-kopf">
        <a href="/" className="bk-zurueck">← Lokalpilot</a>
        <div>
          <h1>Buchungen</h1>
          <p>Der Buchungs-Agent bucht freigegebene Anzeigen: direkt im Online-Shop, wenn das Blatt einen hat, sonst per Anfrage an die Anzeigenabteilung. Antworten liest er selbst.</p>
        </div>
        <div className="bk-schalter">
          <Schalter an={!!cfg.automatik} onChange={(v) => cfgSpeichern({ automatik: v })} titel="Automatik" text={cfg.automatik ? "bucht stündlich selbst" : "nur von Hand"} />
          <Schalter an={cfg.testmodus !== false} onChange={(v) => cfgSpeichern({ testmodus: v })} titel="Testmodus" text={cfg.testmodus !== false ? `Mails an ${cfg.testEmpfaenger || "?"}, Shop ohne Abschicken` : "echte Buchungen"} warn={cfg.testmodus === false} />
        </div>
      </header>

      <section className="bk-kpis">
        <Kpi wert={zaehler.hilfe} label="brauchen euch" ton={zaehler.hilfe ? "crit" : ""} />
        <Kpi wert={zaehler.laufend} label="laufen" />
        <Kpi wert={eur(zaehler.gebucht)} label="gebucht (netto)" />
        <Kpi wert={allg.limit != null && allg.limit !== "" ? eur(allg.limit) : "–"} label="Limit je Kampagne" />
        <Kpi wert={cfg.monatsLimit ? eur(cfg.monatsLimit) : "–"} label="Monatslimit" />
      </section>

      {info?.env && <Einrichtung env={info.env} cfg={cfg} tun={tun} />}

      <section className="bk-karte">
        <div className="bk-sechead">
          <h2>Bereit zum Buchen</h2>
          <span className="bk-hint">Freigegebene Anzeigen mit Termin. Automatik nimmt alles, was {cfg.mindestVorlaufTage ?? 4}–{cfg.vorlaufTage ?? 21} Tage vor dem Termin liegt.</span>
        </div>
        <Faellig anzeigen={offeneAnz} blatt={blatt} cfg={cfg} tun={tun} />
      </section>

      <section className="bk-karte">
        <div className="bk-sechead">
          <h2>Buchungen</h2>
          <div className="bk-tabs">
            {[["offen", "Offen"], ["hilfe", `Brauchen euch (${zaehler.hilfe})`], ["alle", "Alle"]].map(([k, l]) => (
              <button key={k} className={filter === k ? "an" : ""} onClick={() => setFilter(k)}>{l}</button>
            ))}
          </div>
        </div>
        {!bereit ? <p className="bk-leer">Lade …</p> : !sichtbar.length ? <p className="bk-leer">Nichts in dieser Ansicht.</p> : sichtbar.map((b) => <BuchungKarte key={b.id} b={b} blatt={blatt(b.blattId)} anzeigen={(b.anzeigeIds || []).map((i) => d.anzeigen.get(i)).filter(Boolean)} mails={mails.filter((m) => m.buchungId === b.id)} tun={tun} cfg={cfg} />)}
      </section>

      <VerlageFinden kandidaten={arr("blatt_kandidaten")} auftraege={arr("recherche_auftraege")} tun={tun} />

      {!!blaetter.length && <Vergleich blaetter={blaetter} buchungen={arr("buchungen")} anzeigen={arr("anzeigen")} kontakte={arr("kontakte")} cfg={cfg} />}

      <section className="bk-karte">
        <div className="bk-sechead">
          <h2>Buchungswege je Blatt</h2>
          <span className="bk-hint">„Automatisch“: Shop-Adresse vorhanden → Direktbuchung (bei Problemen weiter per Mail), sonst Anfrage per E-Mail.</span>
        </div>
        <Blaetter blaetter={blaetter} speichern={blattSpeichern} tun={tun} zugaenge={info?.zugaenge || []} ftpPw={info?.ftpPasswoerter || []} />
      </section>

      {!!unzugeordnet.length && (
        <section className="bk-karte">
          <div className="bk-sechead"><h2>Postfach: nicht zugeordnet</h2><span className="bk-hint">Mails ohne passende Buchung (z. B. Test-Antworten, Werbung).</span></div>
          {unzugeordnet.slice(0, 20).map((m) => <Mail key={m.id} m={m} />)}
        </section>
      )}

      <Einstellungen cfg={cfg} speichern={cfgSpeichern} />
      {toast && <div className="bk-toast">{toast}</div>}
      <p className="bk-fuss">Angemeldet als {email}</p>
    </div>
  );
}

function Schalter({ an, onChange, titel, text, warn }) {
  return (
    <label className={"bk-switch" + (an ? " an" : "") + (warn ? " warn" : "")}>
      <input type="checkbox" checked={an} onChange={(e) => onChange(e.target.checked)} />
      <span className="bk-knob" />
      <span><b>{titel}</b><small>{text}</small></span>
    </label>
  );
}
const Kpi = ({ wert, label, ton }) => (
  <div className={"bk-kpi " + (ton || "")}><b>{wert}</b><span>{label}</span></div>
);

function Einrichtung({ env, cfg, tun }) {
  const punkte = [
    [env.service, "SUPABASE_SERVICE_ROLE_KEY (Agent arbeitet ohne Login, z. B. nachts)"],
    [env.ki, "ANTHROPIC_API_KEY"],
    [env.resend, `Resend: RESEND_API_KEY + BUCHUNG_MAIL_FROM${env.absender ? ` (${env.absender})` : ""}`],
    [env.webhook, "Resend-Webhook für Antworten (RESEND_WEBHOOK_SECRET)"],
    [env.browser, "Browserbase für Direktbuchung (BROWSERBASE_API_KEY)"],
    [env.cron, "Stündlicher Lauf (CRON_SECRET)"],
    [!!(cfg.firma?.name && cfg.firma?.strasse), "Firmendaten / Rechnungsadresse (unten unter Einstellungen)"],
  ];
  const offen = punkte.filter(([ok]) => !ok);
  if (!offen.length)
    return (
      <section className="bk-karte bk-ok">
        Alles eingerichtet. <button className="b small ghost" onClick={() => tun({ aktion: "testmail" }, "Testmail gesendet")}>Testmail senden</button>
      </section>
    );
  return (
    <section className="bk-karte bk-setup">
      <h2>Noch einzurichten</h2>
      <ul>{punkte.map(([ok, t]) => <li key={t} className={ok ? "ok" : ""}>{ok ? "✓" : "○"} {t}</li>)}</ul>
      {env.resend && <button className="b small ghost" onClick={() => tun({ aktion: "testmail" }, "Testmail gesendet")}>Testmail senden</button>}
    </section>
  );
}

function Faellig({ anzeigen, blatt, cfg, tun }) {
  const [wahl, setWahl] = useState(() => new Set());
  if (!anzeigen.length) return <p className="bk-leer">Keine freigegebenen Anzeigen ohne Buchung.</p>;
  const toggle = (id) => setWahl((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  return (
    <>
      <div className="bk-tabelle">
        <table>
          <thead><tr><th></th><th>Code</th><th>Blatt</th><th>Termin</th><th>Kosten (Plan)</th><th>Weg</th><th>Status</th></tr></thead>
          <tbody>
            {anzeigen.map((a) => {
              const bl = blatt(a.blattId);
              const w = buchungsweg(bl);
              const t = a.datum ? tageBis(a.datum, heuteISO()) : null;
              const ok = a.datum && t >= 1 && (a.status === "freigegeben" || a.status === "geplant");
              return (
                <tr key={a.id} className={a.buchungGesperrt ? "gesperrt" : ""}>
                  <td><input type="checkbox" disabled={!ok} checked={wahl.has(a.id)} onChange={() => toggle(a.id)} /></td>
                  <td className="mono">{a.code}</td>
                  <td>{bl?.name || "?"}</td>
                  <td>{a.datum ? `${datumLang(a.datum)} (${t} T.)` : "offen"}</td>
                  <td>{a.kosten ? eur(a.kosten) : (() => { const sp = standardpreis(bl, a.format); return sp.preis ? <span title={`Standardpreis aus ${sp.quelle}`}>{eur(sp.preis)} <span className="muted">(Standard)</span></span> : "–"; })()}</td>
                  <td>{w.weg === "shop" ? "Shop" : w.weg === "anfrage" ? "E-Mail" : <span className="crit">fehlt</span>}</td>
                  <td>
                    {a.status}
                    {a.buchungGesperrt && (
                      <> · <span className="crit" title={a.buchungHinweis}>gesperrt</span> <button className="linkbtn" onClick={() => tun({ aktion: "entsperren", id: a.id }, "Entsperrt")}>entsperren</button></>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="bk-aktionen">
        <button className="b primary" disabled={!wahl.size} onClick={() => { tun({ aktion: "planen", anzeigeIds: [...wahl] }, `${wahl.size} Anzeige(n) gehen an den Buchungs-Agenten`); setWahl(new Set()); }}>
          {wahl.size ? `${wahl.size} jetzt buchen` : "Anzeigen auswählen"}
        </button>
        <span className="bk-hint">{cfg.testmodus !== false ? "Testmodus an: Es wird nichts verbindlich gebucht." : "Achtung: echte, kostenpflichtige Buchung im Rahmen eurer Limits."}</span>
      </div>
    </>
  );
}

function BuchungKarte({ b, blatt, anzeigen, mails, tun, cfg }) {
  const [offen, setOffen] = useState(["braucht_hilfe", "wartet_freigabe"].includes(b.status));
  const [antwort, setAntwort] = useState(b.antwortEntwurf || "");
  const [betrag, setBetrag] = useState(b.angebot?.preisNetto || "");
  useEffect(() => setAntwort(b.antwortEntwurf || ""), [b.antwortEntwurf]);
  const beleg = async (pfad) => {
    try {
      const j = await aktion({ aktion: "beleg", pfad });
      window.open(j.url, "_blank", "noopener");
    } catch (e) {
      alert(e.message);
    }
  };
  const replay = (b.browserLaeufe || []).slice(-1)[0]?.replayUrl;
  return (
    <article className={"bk-buchung t-" + (TON[b.status] || "")}>
      <div className="bk-bkopf" onClick={() => setOffen(!offen)}>
        <span className={"bk-status " + (TON[b.status] || "")}>{STATUS_TEXT[b.status] || b.status}</span>
        <b>{b.blattName || blatt?.name}</b>
        <span className="mono">{(b.codes || []).join(", ")}</span>
        <span>{b.weg === "shop" ? "Direktbuchung" : b.weg === "anfrage" ? "Anfrage per Mail" : "–"}{b.testmodus ? " · Test" : ""}</span>
        <span className="bk-preis">{b.preisNetto ? eur(b.preisNetto) : b.angebot?.preisNetto ? `Angebot ${eur(b.angebot.preisNetto)}${(() => { const v = vergleichspreis(b.angebot.preisNetto, anzeigen.map((a) => a.format), blatt); return v ? ` · VP ${eur(v)}` : ""; })()}` : b.planKosten ? `Plan ${eur(b.planKosten)}` : ""}</span>
        <span className="bk-zeit">{zeit((b.verlauf || []).slice(-1)[0]?.t)}</span>
      </div>
      {b.status === "braucht_hilfe" && b.hilfe && <p className="bk-hilfe">{b.hilfe}</p>}
      {offen && (
        <div className="bk-bkoerper">
          <div className="bk-spalten">
            <div>
              <h4>Anzeigen</h4>
              <ul className="bk-liste">{anzeigen.map((a) => <li key={a.id}><span className="mono">{a.code}</span> · {datumLang(a.datum)} · {a.status}{a.kosten ? ` · ${eur(a.kosten)}` : ""}</li>)}</ul>
              {b.kennzahlen && <Kennzahlen k={b.kennzahlen} />}
              {b.kombiBewertung && <Kombi k={b.kombiBewertung} />}
              {b.zahlung && <Zahlung z={b.zahlung} bezahlt={() => tun({ aktion: "bezahlt", id: b.id }, "Als bezahlt markiert")} />}
              {b.angebot && (
                <>
                  <h4>Angebot / Bestätigung</h4>
                  <ul className="bk-liste">
                    {b.angebot.preisNetto != null && <li>Preis: {eur(b.angebot.preisNetto)} netto{b.angebot.preisBrutto ? ` (${eur(b.angebot.preisBrutto)} brutto)` : ""}</li>}
                    {b.hoechstpreis != null && <li>Freigegebener Höchstpreis: {eur(Math.max(b.hoechstpreis || 0, b.freigabeMax || 0))}</li>}
                    {b.angebot.anzeigenschluss && <li>Anzeigenschluss: {b.angebot.anzeigenschluss}</li>}
                    {b.angebot.formatMm && <li>Druckmaß: {b.angebot.formatMm.b} × {b.angebot.formatMm.h} mm</li>}
                    {b.angebot.abweichungen && <li>Abweichungen: {b.angebot.abweichungen}</li>}
                    {b.bestellnummer && <li>Auftragsnummer: {b.bestellnummer}</li>}
                  </ul>
                </>
              )}
              {!!(b.belege || []).length && (
                <>
                  <h4>Belege</h4>
                  <div className="bk-belege">{b.belege.map((x) => <button key={x.pfad} className="linkbtn" onClick={() => beleg(x.pfad)}>{x.grund}</button>)}</div>
                </>
              )}
              {replay && <p><a href={replay} target="_blank" rel="noreferrer">Browser-Aufzeichnung ansehen ↗</a></p>}
            </div>
            <div>
              <h4>Verlauf</h4>
              <ol className="bk-verlauf">{(b.verlauf || []).slice(-30).map((v, i) => <li key={i} className={v.art}><span>{zeit(v.t)}</span>{v.text}</li>)}</ol>
            </div>
          </div>
          {!!mails.length && (
            <>
              <h4>Mails</h4>
              {mails.map((m) => <Mail key={m.id} m={m} tun={tun} />)}
            </>
          )}
          {b.status === "wartet_freigabe" && (
            <div className="bk-entscheid">
              <label>Höchstpreis netto freigeben <input type="number" step="0.01" value={betrag} onChange={(e) => setBetrag(e.target.value)} /></label>
              <button className="b primary" onClick={() => tun({ aktion: "freigeben", id: b.id, betrag }, "Freigegeben – Agent macht weiter")}>Freigeben &amp; weiter</button>
            </div>
          )}
          {b.status === "braucht_hilfe" && b.weg === "anfrage" && (
            <div className="bk-entscheid spalte">
              <label>Antwort an den Verlag{b.antwortEntwurf ? " (Entwurf der KI)" : ""}<textarea rows={5} value={antwort} onChange={(e) => setAntwort(e.target.value)} placeholder="Text der Antwort …" /></label>
              <button className="b primary" disabled={!antwort.trim()} onClick={() => tun({ aktion: "antwort", id: b.id, text: antwort }, "Antwort gesendet")}>Antwort senden</button>
            </div>
          )}
          <div className="bk-aktionen">
            {["braucht_hilfe", "wartet_verifizierung", "neu"].includes(b.status) && <button className="b small" onClick={() => tun({ aktion: "neu_starten", id: b.id }, "Neu gestartet")}>Neu versuchen</button>}
            {b.weg === "shop" && OFFEN.includes(b.status) && b.status !== "shop_laeuft" && <button className="b small ghost" onClick={() => tun({ aktion: "auf_anfrage", id: b.id }, "Auf Anfrage umgestellt")}>Stattdessen per Mail anfragen</button>}
            {b.status === "test_fertig" && <button className="b small primary" disabled={cfg.testmodus !== false} title={cfg.testmodus !== false ? "Erst Testmodus ausschalten" : ""} onClick={() => tun({ aktion: "echt", id: b.id }, "Echte Buchung gestartet")}>Jetzt echt buchen</button>}
            {(OFFEN.includes(b.status) || b.status === "test_fertig") && <button className="b small ghost danger" onClick={() => confirm("Buchung abbrechen? Bereits verschickte Zusagen müssen beim Verlag storniert werden.") && tun({ aktion: "abbrechen", id: b.id }, "Abgebrochen")}>Abbrechen</button>}
          </div>
        </div>
      )}
    </article>
  );
}

function Mail({ m, tun }) {
  const [auf, setAuf] = useState(false);
  const geplant = m.status === "geplant" || m.status === "sendet";
  return (
    <div className={"bk-mail " + m.richtung + (geplant ? " geplant" : "")}>
      <div className="bk-mkopf" onClick={() => setAuf(!auf)}>
        <span>{m.richtung === "ein" ? "↘" : "↗"}</span>
        <b>{m.betreff}</b>
        <span>{m.richtung === "ein" ? m.von : m.an}</span>
        {m.klasse && <span className="bk-tag">{m.klasse}</span>}
        {geplant && <span className="bk-tag">geplant {zeit(m.sendeAb)}</span>}
        {m.status === "verworfen" && <span className="bk-tag">nicht gesendet</span>}
        <span className="bk-zeit">{zeit(m.zeit)}</span>
      </div>
      {m.status === "geplant" && tun && <div className="bk-aktionen"><button className="b" onClick={() => tun({ aktion: "jetzt_senden", mailId: m.id }, "Gesendet")}>Jetzt senden</button>{m.fehler && <span className="bk-warn">Letzter Versuch: {m.fehler}</span>}</div>}
      {m.zusammenfassung && !auf && <p className="bk-msum">{m.zusammenfassung}</p>}
      {auf && <pre className="bk-mtext">{m.text}</pre>}
    </div>
  );
}

function Blaetter({ blaetter, speichern, tun, zugaenge, ftpPw = [] }) {
  const [zugang, setZugang] = useState({ host: "", login: "", passwort: "" });
  if (!blaetter.length) return <p className="bk-leer">Noch keine Blätter angelegt.</p>;
  return (
    <>
      <div className="bk-blaetter">
        {blaetter.map((b) => {
          const w = buchungsweg(b);
          const r = b.buchung?.recherche;
          const host = (() => { try { return new URL(w.shopUrl).hostname.replace(/^www\./, ""); } catch { return ""; } })();
          return (
            <div key={b.id} className="bk-blatt">
              <div className="bk-bltitel"><b>{b.name}</b><span>{b.stadt} · {b.verlag || "Verlag?"}</span></div>
              <label>Weg
                <select value={b.buchung?.weg || "auto"} onChange={(e) => speichern(b, { weg: e.target.value })}>
                  <option value="auto">Automatisch ({w.weg === "shop" ? "Shop" : w.weg === "anfrage" ? "E-Mail" : "fehlt"})</option>
                  <option value="shop">Direkt im Shop</option>
                  <option value="anfrage">Anfrage per E-Mail</option>
                </select>
              </label>
              <label>Shop-Adresse<input defaultValue={b.buchung?.shopUrl || (/^https?:/.test(b.kontakt || "") ? b.kontakt : "")} placeholder="https://…" onBlur={(e) => e.target.value !== (b.buchung?.shopUrl || "") && speichern(b, { shopUrl: e.target.value.trim() })} /></label>
              <label>E-Mail Anzeigenabteilung<input type="email" defaultValue={b.buchung?.email || ""} placeholder="anzeigen@verlag.de" onBlur={(e) => e.target.value !== (b.buchung?.email || "") && speichern(b, { email: e.target.value.trim() })} /></label>
              <label>Druckmaß (mm, B × H)
                <span className="bk-mm">
                  <input type="number" defaultValue={b.buchung?.formatMm?.b || ""} onBlur={(e) => speichern(b, { formatMm: { ...(b.buchung?.formatMm || {}), b: Number(e.target.value) || null } })} />×
                  <input type="number" defaultValue={b.buchung?.formatMm?.h || ""} onBlur={(e) => speichern(b, { formatMm: { ...(b.buchung?.formatMm || {}), h: Number(e.target.value) || null } })} />
                </span>
              </label>
              <Preise b={b} speichern={speichern} />
              <Ftp b={b} speichern={speichern} tun={tun} hatPw={ftpPw.includes(b.id)} />
              <div className="bk-blfuss">
                {host && <span className={zugaenge.some((z) => z.host === host) ? "good" : "muted"}>{zugaenge.some((z) => z.host === host) ? `Shop-Zugang ${host} hinterlegt` : `Kein Zugang für ${host} (Agent legt bei Bedarf eins an)`}</span>}
                <button className="b small ghost" disabled={b.buchungRecherche?.laeuft} onClick={() => tun({ aktion: "weg_pruefen", blattId: b.id }, "Recherche gestartet (dauert ein paar Minuten)")}>{b.buchungRecherche?.laeuft ? "Prüft …" : "Weg prüfen (KI)"}</button>
              </div>
              {r && (
                <p className="bk-recherche">
                  <b>{r.onlineBuchbar ? "Online buchbar." : "Nicht online buchbar."}</b> {r.notiz} {r.preise && <><br />Preise: {r.preise}</>} {r.replayUrl && <a href={r.replayUrl} target="_blank" rel="noreferrer">Aufzeichnung ↗</a>}
                </p>
              )}
            </div>
          );
        })}
      </div>
      <details className="bk-zugang">
        <summary>Vorhandenen Shop-Zugang hinterlegen (z. B. crossvertise-Konto)</summary>
        <p className="bk-hint">Wird verschlüsselt im Server-Tresor gespeichert und ist nur für den Agenten lesbar, nicht in der Oberfläche.</p>
        <div className="bk-zform">
          <input placeholder="Domain, z. B. market.crossvertise.com" value={zugang.host} onChange={(e) => setZugang({ ...zugang, host: e.target.value })} />
          <input placeholder="Login / E-Mail" value={zugang.login} onChange={(e) => setZugang({ ...zugang, login: e.target.value })} />
          <input type="password" placeholder="Passwort" value={zugang.passwort} onChange={(e) => setZugang({ ...zugang, passwort: e.target.value })} />
          <button className="b small" onClick={async () => { await tun({ aktion: "zugang", ...zugang }, "Zugang gespeichert"); setZugang({ host: "", login: "", passwort: "" }); }}>Speichern</button>
        </div>
        {!!zugaenge.length && <p className="bk-hint">Hinterlegt: {zugaenge.map((z) => z.host).join(", ")}</p>}
      </details>
    </>
  );
}

function Einstellungen({ cfg, speichern }) {
  const [f, setF] = useState(null);
  const v = f || { ...cfg, firma: { ...(cfg.firma || {}) } };
  const set = (k, x) => setF({ ...v, [k]: x });
  const setFirma = (k, x) => setF({ ...v, firma: { ...v.firma, [k]: x } });
  const n = (x) => (x === "" || x == null ? null : Number(x));
  return (
    <details className="bk-karte bk-einst">
      <summary><h2>Einstellungen des Buchungs-Agenten</h2></summary>
      <div className="bk-grid">
        <label>Test-Empfänger (Testmodus)<input type="email" value={v.testEmpfaenger || ""} onChange={(e) => set("testEmpfaenger", e.target.value)} /></label>
        <label>Absendername<input value={v.absenderName || ""} onChange={(e) => set("absenderName", e.target.value)} /></label>
        <label>Buchen ab … Tage vor Termin<input type="number" value={v.vorlaufTage ?? 21} onChange={(e) => set("vorlaufTage", n(e.target.value))} /></label>
        <label>Spätestens … Tage vor Termin<input type="number" value={v.mindestVorlaufTage ?? 4} onChange={(e) => set("mindestVorlaufTage", n(e.target.value))} /></label>
        <label>Höchster Vergleichspreis (€ je 1.000 Exemplare × 1/4 Seite, leer = aus)<input type="number" value={v.maxTkpViertelseite ?? ""} onChange={(e) => set("maxTkpViertelseite", n(e.target.value))} /></label>
        <label>Preis-Toleranz über Plan (%)<input type="number" value={v.preisToleranzProzent ?? 15} onChange={(e) => set("preisToleranzProzent", n(e.target.value))} /></label>
        <label>Monatslimit Buchungen (€ netto, leer = keins)<input type="number" value={v.monatsLimit ?? ""} onChange={(e) => set("monatsLimit", n(e.target.value))} /></label>
        <label>Nachfassen nach … Werktagen<input type="number" value={v.nachfassenNachTagen ?? 2} onChange={(e) => set("nachfassenNachTagen", n(e.target.value))} /></label>
        <label>Nachverhandeln: Ziel-Rabatt (%, 0 = aus)<input type="number" value={v.zielRabattProzent ?? 15} onChange={(e) => set("zielRabattProzent", n(e.target.value))} /></label>
        <label>Antwort frühestens nach … Min.<input type="number" value={v.abstandMinMin ?? 20} onChange={(e) => set("abstandMinMin", n(e.target.value))} /></label>
        <label>Antwort spätestens nach … Min.<input type="number" value={v.abstandMaxMin ?? 90} onChange={(e) => set("abstandMaxMin", n(e.target.value))} /></label>
        <label>Nur zu Bürozeiten senden (Mo–Fr 8–17:30)<select value={v.geschaeftszeiten === false ? "nein" : "ja"} onChange={(e) => set("geschaeftszeiten", e.target.value === "ja")}><option value="ja">Ja</option><option value="nein">Nein</option></select></label>
        <label style={{ gridColumn: "1 / -1" }}>Druckdaten-Angaben (antwortet der Agent auf Fragen zu Format/PDF; leer = Standard)<textarea rows={2} value={v.druckSpezifikation || ""} placeholder="PDF in exakter Endgröße, 300 dpi, 4c, Schriften eingebettet, ohne Beschnitt" onChange={(e) => set("druckSpezifikation", e.target.value)} /></label>
      </div>
      <h3>Firma / Rechnungsadresse</h3>
      <div className="bk-grid">
        {[["name", "Firmenname"], ["ansprechpartner", "Ansprechpartner"], ["strasse", "Straße, Nr."], ["plz", "PLZ"], ["ort", "Ort"], ["ustId", "USt-IdNr."], ["telefon", "Telefon"], ["rechnungsEmail", "Rechnungs-E-Mail"]].map(([k, l]) => (
          <label key={k}>{l}<input value={v.firma?.[k] || ""} onChange={(e) => setFirma(k, e.target.value)} /></label>
        ))}
      </div>
      <div className="bk-aktionen">
        <button className="b primary" disabled={!f} onClick={async () => { await speichern(v); setF(null); }}>Speichern</button>
        <span className="bk-hint">Der Agent rechnet jedes Angebot in den Vergleichspreis um (Preis ÷ Auflage in Tausend ÷ Größe in Viertelseiten) und sagt bis zu eurer Grenze ohne Rückfrage zu. Stehen an der Anzeige feste Kosten, gelten diese + Toleranz. Darüber wartet der Agent auf eure Freigabe.</span>
      </div>
    </details>
  );
}


// Recherche-Agent: Anzeigenblätter einer Region finden und alle Buchungsdaten sammeln
function VerlageFinden({ kandidaten, auftraege, tun }) {
  const [region, setRegion] = useState("");
  const [anzahl, setAnzahl] = useState(10);
  const [zeige, setZeige] = useState("offen");
  const laufend = auftraege.filter((a) => ["sucht", "details"].includes(a.status));
  const liste_ = kandidaten
    .filter((k) => (zeige === "offen" ? !["uebernommen", "verworfen"].includes(k.status) : zeige === "uebernommen" ? k.status === "uebernommen" : true))
    .sort((a, b) => (b.erstelltAm || 0) - (a.erstelltAm || 0));
  const kosten = [...auftraege, ...kandidaten].reduce((s, x) => s + (Number(x.kosten) || 0), 0);
  const STAT = { neu: "wartet", laeuft: "recherchiert …", recherchiert: "fertig", fehler: "Fehler", uebernommen: "übernommen", verworfen: "verworfen" };
  return (
    <section className="bk-karte">
      <div className="bk-sechead">
        <h2>Verlage finden</h2>
        <span className="bk-hint">Der Recherche-Agent sucht Anzeigenblätter in einer Region und sammelt Auflage, Preise, Druckmaß, Anzeigenschluss, E-Mail und Druckdaten-Weg aus Mediadaten und Impressum. Pro Blatt ca. 1–2 Minuten; läuft im Hintergrund weiter (auch stündlich). Bisherige KI-Kosten ca. {eur(kosten)}.</span>
      </div>
      <div className="bk-aktionen">
        <input style={{ flex: "1 1 220px" }} placeholder="Region, z. B. Landkreis Gifhorn oder Niedersachsen Süd" value={region} onChange={(e) => setRegion(e.target.value)} />
        <input type="number" style={{ width: 80 }} min={1} max={40} value={anzahl} onChange={(e) => setAnzahl(Number(e.target.value) || 10)} />
        <button className="b primary" disabled={!region.trim()} onClick={async () => { await tun({ aktion: "verlage_suchen", region, anzahl }, "Suche gestartet – Ergebnisse erscheinen hier nach und nach"); setRegion(""); }}>Suchen</button>
      </div>
      {!!laufend.length && <p className="bk-hint">Läuft: {laufend.map((a) => `${a.region} (${a.status === "sucht" ? "sucht Blätter" : `${a.gefunden || 0} gefunden, Details laufen`})`).join(" · ")}</p>}
      {auftraege.filter((a) => a.status === "fehler").slice(-1).map((a) => <p key={a.id} className="bk-warn">Suche „{a.region}“ fehlgeschlagen: {a.fehler}</p>)}
      <div className="bk-tabs" style={{ margin: "10px 0" }}>
        {[["offen", "Vorschläge"], ["uebernommen", "Übernommen"], ["alle", "Alle"]].map(([k, l]) => <button key={k} className={zeige === k ? "an" : ""} onClick={() => setZeige(k)}>{l}</button>)}
      </div>
      {!liste_.length ? <p className="bk-leer">Noch keine Vorschläge.</p> : (
        <div className="bk-tabelle"><table>
          <thead><tr><th>Blatt</th><th>Erscheint</th><th>Auflage</th><th>Hochformat</th><th>Vergleichspreis</th><th>Schluss</th><th>Kontakt / Druckdaten</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {liste_.map((k) => {
              const d = k.daten || {};
              const hf = d.hochformat;
              const vp = hf?.preis && d.auflage && hf.b && hf.h ? Number(hf.preis) / ((Number(d.auflage) / 1000) * ((hf.b * hf.h) / (141 * 200))) : null;
              return (
                <tr key={k.id}>
                  <td><b>{d.name || k.name}</b><div className="bk-hint">{d.verlag || k.verlag} · {d.stadt || k.stadt}{k.region ? ` · ${k.region}` : ""}</div>{!!d.unsicher?.length && <div className="bk-warn">Unsicher: {d.unsicher.join("; ")}</div>}</td>
                  <td>{d.erscheint || k.erscheint || "–"}</td>
                  <td>{d.auflage ? Number(d.auflage).toLocaleString("de-DE") : "–"}</td>
                  <td>{hf?.preis ? <>{eur(hf.preis)}<div className="bk-hint">{hf.b} × {hf.h} mm · {hf.preisArt}</div></> : d.mmPreisOrts || d.mmPreisGrund ? `${d.mmPreisOrts || d.mmPreisGrund} €/mm` : "–"}</td>
                  <td>{vp ? eur(vp) : "–"}</td>
                  <td>{d.anzeigenschluss || "–"}</td>
                  <td>{d.emailAnzeigen || <span className="bk-warn">keine E-Mail</span>}<div className="bk-hint">Druckdaten: {d.druckdaten?.weg || "?"}{d.preislisteStand ? ` · ${d.preislisteStand}` : ""}</div>{(d.quellen || []).slice(0, 2).map((q) => <div key={q}><a href={q} target="_blank" rel="noreferrer" className="bk-hint">{String(q).replace(/^https?:\/\//, "").slice(0, 40)} ↗</a></div>)}</td>
                  <td>{STAT[k.status] || k.status}{k.fehler && <div className="bk-warn">{k.fehler}</div>}{k.kosten ? <div className="bk-hint">{eur(k.kosten)}</div> : null}</td>
                  <td>
                    {k.status === "recherchiert" && <button className="b small" onClick={() => tun({ aktion: "kandidat_uebernehmen", id: k.id }, `${d.name || k.name} als Blatt angelegt`)}>Übernehmen</button>}
                    {["fehler", "recherchiert"].includes(k.status) && <button className="b small ghost" onClick={() => tun({ aktion: "kandidat_recherchieren", id: k.id }, "Recherche läuft erneut")}>Neu</button>}
                    {!["uebernommen", "verworfen"].includes(k.status) && <button className="b small ghost" onClick={() => tun({ aktion: "kandidat_verwerfen", id: k.id }, "Verworfen")}>Verwerfen</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      )}
    </section>
  );
}

// Druckdaten per FTP/FTPS/SFTP: Server-Daten am Blatt, Passwort nur verschlüsselt auf dem Server (lp_secrets)
function Ftp({ b, speichern, tun, hatPw }) {
  const f = b.buchung?.ftp || {};
  const [pw, setPw] = useState("");
  const setz = (k, v) => speichern(b, { ftp: { ...f, [k]: v } });
  const t = b.buchung?.ftpTest;
  return (
    <details className="bk-preise">
      <summary>Druckdaten per FTP{f.host ? ` · ${(f.protokoll || "ftp").toUpperCase()} ${f.host}${hatPw ? "" : " · Passwort fehlt"}` : " · nicht eingerichtet (Druckdaten per Mail)"}</summary>
      <p className="bk-hint">Nur ausfüllen, wenn der Verlag Druckdaten per FTP will. Schickt der Verlag die Zugangsdaten per Mail, trägt der Agent sie selbst ein.{f.quelle ? ` Quelle: ${f.quelle}.` : ""}</p>
      <div className="bk-preisraster">
        <label>Protokoll<select defaultValue={f.protokoll || "ftp"} onChange={(e) => setz("protokoll", e.target.value)}><option value="ftp">FTP</option><option value="ftps">FTPS (verschlüsselt)</option><option value="sftp">SFTP</option></select></label>
        <label>Server<input defaultValue={f.host || ""} placeholder="ftp.verlag.de" onBlur={(e) => e.target.value !== (f.host || "") && setz("host", e.target.value.trim())} /></label>
        <label>Port<input type="number" defaultValue={f.port || ""} placeholder="21 / 22" onBlur={(e) => setz("port", Number(e.target.value) || null)} /></label>
        <label>Benutzer<input defaultValue={f.benutzer || ""} onBlur={(e) => e.target.value !== (f.benutzer || "") && setz("benutzer", e.target.value.trim())} /></label>
        <label>Ordner<input defaultValue={f.pfad || ""} placeholder="z. B. anzeigen/eingang" onBlur={(e) => e.target.value !== (f.pfad || "") && setz("pfad", e.target.value.trim())} /></label>
        <label>Passwort {hatPw ? "(hinterlegt)" : ""}<span className="bk-mm"><input type="password" value={pw} placeholder={hatPw ? "neu setzen" : ""} onChange={(e) => setPw(e.target.value)} /><button className="b small" disabled={!pw} onClick={async () => { await tun({ aktion: "ftp_zugang", blattId: b.id, passwort: pw }, "FTP-Passwort gespeichert"); setPw(""); }}>Speichern</button></span></label>
      </div>
      <div className="bk-aktionen">
        <button className="b small ghost" disabled={!f.host} onClick={() => tun({ aktion: "ftp_test", blattId: b.id }, "FTP-Test fertig")}>Verbindung testen</button>
        {t && <span className={t.ok ? "good" : "bk-warn"}>{t.ok ? "✓ " : "✗ "}{t.text}</span>}
      </div>
    </details>
  );
}

// Alle Blätter auf einen Nenner: Vergleichspreis = € für 1.000 Exemplare mit einer 1/4 Seite. Kleiner = günstiger.
function Vergleich({ blaetter, buchungen, anzeigen, kontakte, cfg }) {
  const grenze = Number(cfg?.maxTkpViertelseite) || null;
  // Ergebnis: nur erschienene Anzeigen mit Kosten – sonst wären Kosten je Anfrage zu früh zu hoch
  const erschienen = anzeigen.filter((a) => !a.demo && ["erschienen", "beendet"].includes(a.status) && Number(a.kosten) > 0);
  const kVon = new Map();
  for (const k of kontakte) if (!k.demo && k.anzeigeId) kVon.set(k.anzeigeId, [...(kVon.get(k.anzeigeId) || []), k]);
  const ergebnis = (ads) => {
    const ks = ads.flatMap((a) => kVon.get(a.id) || []);
    const kosten = ads.reduce((s, a) => s + Number(a.kosten || 0), 0);
    const leads = ks.filter((k) => k.qualifiziert).length;
    const erloes = ks.reduce((s, k) => s + Number(k.erloes || 0), 0);
    return { n: ads.length, kosten, anfragen: ks.length, leads, erloes, jeAnfrage: ks.length ? kosten / ks.length : null, jeLead: leads ? kosten / leads : null, jeEuro: kosten ? erloes / kosten : null };
  };
  const zeilen = blaetter.map((b) => {
    const liste = standardpreis(b, "q-hoch").preis;
    const vpListe = liste ? vergleichspreis(liste, ["q-hoch"], b) : null;
    const gezahlt = buchungen.filter((x) => x.blattId === b.id && x.kennzahlen?.vergleichspreis).map((x) => x.kennzahlen.vergleichspreis);
    return { b, liste, vpListe, vpGezahlt: gezahlt.length ? Math.min(...gezahlt) : null, e: ergebnis(erschienen.filter((a) => a.blattId === b.id)) };
  }).sort((x, y) => (x.e.jeAnfrage ?? 1e9) - (y.e.jeAnfrage ?? 1e9) || (x.vpGezahlt ?? x.vpListe ?? 1e9) - (y.vpGezahlt ?? y.vpListe ?? 1e9));
  const ges = ergebnis(erschienen.filter((a) => blaetter.some((b) => b.id === a.blattId)));
  const besterJeAnfrage = Math.min(...zeilen.map((z) => z.e.jeAnfrage ?? 1e9));
  return (
    <section className="bk-karte">
      <div className="bk-sechead">
        <h2>Blätter im Vergleich</h2>
        <span className="bk-hint">Vorher: <b>Vergleichspreis</b> = was es kostet, 1.000 Exemplare mit einer 1/4 Seite zu erreichen (jede Größe, jedes Blatt – kleiner ist günstiger){grenze ? `, eure Grenze ${eur(grenze)}` : ""}. Nachher: <b>Kosten je Anfrage</b> = Anzeigenkosten ÷ eingegangene Kontakte (nur erschienene Anzeigen). Sortiert nach Kosten je Anfrage, solange es noch keine gibt nach Vergleichspreis.</span>
      </div>
      <div className="bk-tabelle"><table>
        <thead><tr><th>Blatt</th><th>Auflage</th><th>Liste 1/4 Seite</th><th>Vergleichspreis Liste</th><th>Bester gezahlter</th><th>Erschienen</th><th>Anfragen</th><th>Kosten je Anfrage</th><th>Leads</th><th>Kosten je Lead</th><th>Erlös je €</th></tr></thead>
        <tbody>
          {zeilen.map(({ b, liste, vpListe, vpGezahlt, e }) => (
            <tr key={b.id}>
              <td>{b.name}</td>
              <td>{b.auflage ? Number(b.auflage).toLocaleString("de-DE") : "fehlt"}</td>
              <td>{liste ? eur(liste) : "–"}</td>
              <td className={grenze && vpListe ? (vpListe <= grenze ? "bk-gut" : "bk-warn") : ""}>{vpListe ? eur(vpListe) : "–"}</td>
              <td className={grenze && vpGezahlt ? (vpGezahlt <= grenze ? "bk-gut" : "bk-warn") : ""}>{vpGezahlt ? eur(vpGezahlt) : "–"}</td>
              <Ergebnis e={e} bester={besterJeAnfrage} />
            </tr>
          ))}
          {ges.n > 0 && <tr className="bk-summe"><td>Alle Blätter</td><td></td><td></td><td></td><td></td><Ergebnis e={ges} /></tr>}
        </tbody>
      </table></div>
    </section>
  );
}

function Ergebnis({ e, bester }) {
  const z = (v, f) => (v == null ? "–" : f(v));
  return (
    <>
      <td>{e.n ? `${e.n} Anz. · ${eur(e.kosten)}` : "–"}</td>
      <td>{e.n ? e.anfragen : "–"}</td>
      <td className={e.jeAnfrage != null && e.jeAnfrage === bester ? "bk-gut" : ""}>{z(e.jeAnfrage, eur)}</td>
      <td>{e.n ? e.leads : "–"}</td>
      <td>{z(e.jeLead, eur)}</td>
      <td>{z(e.jeEuro, (v) => v.toLocaleString("de-DE", { maximumFractionDigits: 2 }) + " €")}</td>
    </>
  );
}

// Kombi-Angebot des Verlags und wie der Agent es bewertet hat
function Kombi({ k }) {
  return (<><h4>Kombi-Angebot</h4><p className="bk-hint">{k.gut ? "Gutes Angebot" : "Kein gutes Angebot"}{k.jeAnzeige != null ? ` · ${eur(k.jeAnzeige)} je Anzeige` : ""}{k.rabatt != null ? ` · ${Math.round(k.rabatt * 100)} % unter Liste` : ""}{k.vergleichspreis != null ? ` · Vergleichspreis ${eur(k.vergleichspreis)}` : k.tkp != null ? ` · TKP ${eur(k.tkp)}` : ""}{k.frei != null ? ` · Budget frei ${eur(k.frei)}` : ""}</p>{k.bewertung && <p className="bk-hint">{k.bewertung}</p>}</>);
}

// Vorkasse: vom Agenten geprüfte Zahlungsdaten. Überwiesen wird (noch) von Hand.
function Zahlung({ z, bezahlt }) {
  const fertig = z.status === "bezahlt";
  return (
    <>
      <h4>Zahlung ({z.art === "vorkasse" ? "Vorkasse" : z.art || "–"})</h4>
      <ul className="bk-liste">
        {z.betrag != null && <li>Betrag: {eur(z.betrag)}{z.betragIstBrutto ? " brutto" : " netto"}</li>}
        {z.empfaenger && <li>Empfänger: {z.empfaenger}</li>}
        {z.iban && <li>IBAN: <span className="mono">{z.iban}</span></li>}
        {z.verwendungszweck && <li>Verwendungszweck: <span className="mono">{z.verwendungszweck}</span></li>}
        {z.faellig && <li>Fällig: {z.faellig}</li>}
        <li>Status: {fertig ? "bezahlt" : z.status === "pruefen" ? "BITTE PRÜFEN – nicht überweisen" : "geprüft, bereit zur Überweisung"}</li>
        {(z.probleme || []).map((p, i) => <li key={i} className="bk-warn">⚠ {p}</li>)}
      </ul>
      {!fertig && z.status !== "pruefen" && <button className="b" onClick={bezahlt}>Als bezahlt markieren</button>}
    </>
  );
}

// Kennzahlen einer abgeschlossenen Buchung (netto)
function Kennzahlen({ k }) {
  const z = (v, f) => (v == null ? null : f(v));
  const teile = [
    z(k.vergleichspreis, (v) => `Vergleichspreis ${eur(v)}`),
    z(k.tkp, (v) => `TKP ${eur(v)} je 1.000 Exemplare`),
    z(k.auflage, (v) => `Auflage ${Number(v).toLocaleString("de-DE")}`),
    z(k.listenpreis, (v) => `Listenpreis ${eur(v)}`),
    z(k.rabattProzent, (v) => (v > 0 ? `${v.toLocaleString("de-DE")} % unter Liste` : v < 0 ? `${(-v).toLocaleString("de-DE")} % über Liste` : "zum Listenpreis")),
    z(k.planAbweichungProzent, (v) => `${v > 0 ? "+" : ""}${v.toLocaleString("de-DE")} % ggü. Plan`),
    z(k.preisJeMm, (v) => `${eur(v)} je Spalten-mm`),
  ].filter(Boolean);
  if (!teile.length) return null;
  return (<><h4>Kennzahlen</h4><p className="bk-hint">{teile.join(" · ")}</p></>);
}

// Standardpreise eines Blatts je Format (netto, aus der Preisliste). Der Agent nimmt sie, wenn bei einer Anzeige keine Kosten stehen.
function Preise({ b, speichern }) {
  const p = b.buchung?.preise || {};
  const auf = Number(b.auflage) || 0;
  const zahl = (v) => { const n = Number(String(v).replace(",", ".")); return Number.isFinite(n) && n > 0 ? n : null; };
  const setzen = (fid, v) => {
    const neu = { ...p };
    const n = zahl(v);
    if (n) neu[fid] = n; else delete neu[fid];
    speichern(b, { preise: neu });
  };
  return (
    <details className="bk-preise">
      <summary>Standardpreise (netto){Object.keys(p).length ? ` · ${Object.keys(p).length} Format(e)` : ""}{auf ? ` · Auflage ${auf.toLocaleString("de-DE")}` : " · Auflage fehlt"}</summary>
      <p className="bk-hint">Aus der Preisliste des Verlags (Direkt-/Ortspreis). Bis Preis + Toleranz sagt der Agent ohne Rückfrage zu, wenn bei der Anzeige keine eigenen Kosten stehen.</p>
      <div className="bk-preisraster">
        {Object.entries(FORMATE).map(([fid, f]) => {
          const sp = standardpreis(b, fid);
          return (
            <label key={fid}>{f.label}
              <input inputMode="decimal" defaultValue={p[fid] ?? ""} placeholder={sp.quelle === "mm-Preis" ? `${sp.preis} (mm)` : "€"} onBlur={(e) => String(p[fid] ?? "") !== e.target.value && setzen(fid, e.target.value)} />
              <span className="bk-hint">{sp.preis && auf ? `Vergleichspreis ${eur(vergleichspreis(sp.preis, [fid], b))}` : " "}</span>
            </label>
          );
        })}
        <label>mm-Preis (€ je Spalten-mm)
          <input inputMode="decimal" defaultValue={b.buchung?.mmPreis ?? ""} placeholder="z. B. 2,36" onBlur={(e) => speichern(b, { mmPreis: zahl(e.target.value) })} />
          <span className="bk-hint">für Spaltenformate ohne festen Preis</span>
        </label>
      </div>
    </details>
  );
}
