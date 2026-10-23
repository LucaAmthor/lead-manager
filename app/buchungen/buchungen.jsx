"use client";
import { useEffect, useMemo, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { buchungsweg, STATUS_TEXT, OFFEN, eur, datumLang, tageBis, heuteISO } from "@/lib/buchung/regeln";

// Seite „Buchungen“: was der Buchungs-Agent tut, wo er Hilfe braucht, wie jedes Blatt gebucht wird.
const SAMMLUNGEN = ["blaetter", "anzeigen", "buchungen", "buchung_mails", "einstellungen", "kampagnen"];
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

      <section className="bk-karte">
        <div className="bk-sechead">
          <h2>Buchungswege je Blatt</h2>
          <span className="bk-hint">„Automatisch“: Shop-Adresse vorhanden → Direktbuchung (bei Problemen weiter per Mail), sonst Anfrage per E-Mail.</span>
        </div>
        <Blaetter blaetter={blaetter} speichern={blattSpeichern} tun={tun} zugaenge={info?.zugaenge || []} />
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
                  <td>{a.kosten ? eur(a.kosten) : "–"}</td>
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
        <span className="bk-preis">{b.preisNetto ? eur(b.preisNetto) : b.angebot?.preisNetto ? `Angebot ${eur(b.angebot.preisNetto)}` : b.planKosten ? `Plan ${eur(b.planKosten)}` : ""}</span>
        <span className="bk-zeit">{zeit((b.verlauf || []).slice(-1)[0]?.t)}</span>
      </div>
      {b.status === "braucht_hilfe" && b.hilfe && <p className="bk-hilfe">{b.hilfe}</p>}
      {offen && (
        <div className="bk-bkoerper">
          <div className="bk-spalten">
            <div>
              <h4>Anzeigen</h4>
              <ul className="bk-liste">{anzeigen.map((a) => <li key={a.id}><span className="mono">{a.code}</span> · {datumLang(a.datum)} · {a.status}{a.kosten ? ` · ${eur(a.kosten)}` : ""}</li>)}</ul>
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
              {mails.map((m) => <Mail key={m.id} m={m} />)}
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

function Mail({ m }) {
  const [auf, setAuf] = useState(false);
  return (
    <div className={"bk-mail " + m.richtung}>
      <div className="bk-mkopf" onClick={() => setAuf(!auf)}>
        <span>{m.richtung === "ein" ? "↘" : "↗"}</span>
        <b>{m.betreff}</b>
        <span>{m.richtung === "ein" ? m.von : m.an}</span>
        {m.klasse && <span className="bk-tag">{m.klasse}</span>}
        <span className="bk-zeit">{zeit(m.zeit)}</span>
      </div>
      {m.zusammenfassung && !auf && <p className="bk-msum">{m.zusammenfassung}</p>}
      {auf && <pre className="bk-mtext">{m.text}</pre>}
    </div>
  );
}

function Blaetter({ blaetter, speichern, tun, zugaenge }) {
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
        <label>Preis-Toleranz über Plan (%)<input type="number" value={v.preisToleranzProzent ?? 15} onChange={(e) => set("preisToleranzProzent", n(e.target.value))} /></label>
        <label>Monatslimit Buchungen (€ netto, leer = keins)<input type="number" value={v.monatsLimit ?? ""} onChange={(e) => set("monatsLimit", n(e.target.value))} /></label>
        <label>Nachfassen nach … Werktagen<input type="number" value={v.nachfassenNachTagen ?? 2} onChange={(e) => set("nachfassenNachTagen", n(e.target.value))} /></label>
      </div>
      <h3>Firma / Rechnungsadresse</h3>
      <div className="bk-grid">
        {[["name", "Firmenname"], ["ansprechpartner", "Ansprechpartner"], ["strasse", "Straße, Nr."], ["plz", "PLZ"], ["ort", "Ort"], ["ustId", "USt-IdNr."], ["telefon", "Telefon"], ["rechnungsEmail", "Rechnungs-E-Mail"]].map(([k, l]) => (
          <label key={k}>{l}<input value={v.firma?.[k] || ""} onChange={(e) => setFirma(k, e.target.value)} /></label>
        ))}
      </div>
      <div className="bk-aktionen">
        <button className="b primary" disabled={!f} onClick={async () => { await speichern(v); setF(null); }}>Speichern</button>
        <span className="bk-hint">Höchstpreis je Buchung = geplante Kosten + Toleranz. Ohne geplante Kosten: was vom Kampagnen-Limit frei ist. Darüber wartet der Agent auf eure Freigabe.</span>
      </div>
    </details>
  );
}
