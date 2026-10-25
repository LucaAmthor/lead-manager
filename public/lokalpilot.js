/* Lokalpilot – App-Logik. Spricht über window.claude.use(...) mit Supabase und der KI-Route. */
(() => {
  // ================= Stammdaten =================
  // Top 10 Lead-Kategorien (Zielgruppe Hausbesitzer 50+, hoher Auftragswert). Angelehnt an Vergleichsportale, eigene Auswahl.
  const KAT_INFO = {
    "Wärmepumpe": { k: "WP", anbieter: "Fachbetriebe für Wärmepumpen" },
    "PV": { k: "PV", anbieter: "Solar-Fachbetriebe", name: "Solaranlage (PV)" },
    "Altenpflege": { k: "AP", anbieter: "Pflegedienste", name: "Pflege zu Hause" },
    "Heizung": { k: "HZ", anbieter: "Heizungsbauer" },
    "Badsanierung": { k: "BD", anbieter: "Badsanierer" },
    "Treppenlift": { k: "TL", anbieter: "Treppenlift-Anbieter" },
    "Küche": { k: "KU", anbieter: "Küchenstudios" },
    "Fenster & Türen": { k: "FE", anbieter: "Fenster- und Türenbauer" },
    "Dach & Dämmung": { k: "DA", anbieter: "Dachdecker und Dämmprofis" },
    "Immobilie verkaufen": { k: "IM", anbieter: "Immobilienmakler" },
  };
  const LEAD_KATS = Object.keys(KAT_INFO);
  const CORE_KATS = ["Wärmepumpe", "PV", "Altenpflege"];
  const KATEGORIEN = [...LEAD_KATS, "Sammelanzeige"];
  const KAT_KURZ = { ...Object.fromEntries(LEAD_KATS.map((k) => [k, KAT_INFO[k].k])), "Sammelanzeige": "SA" };
  const katListe = () => LEAD_KATS.map((k) => `${k} (Anbieter: ${KAT_INFO[k].anbieter})`).join(", ");
  const BOTSCHAFTEN = ["Frist / Förderung", "Kostenfrage", "Emotion", "Ratgeber-Köder", "Lokales Vertrauen"];
  const TOENE = ["Seriös", "Sachlich", "Emotional", "Humor", "Ironisch", "Provokant", "Nostalgisch", "Lokalstolz"];
  const VIRAL = [
    { id: "Klassisch", d: "Kein Viral-Baustein, klare Nutzen-Anzeige." },
    { id: "Unerwartete Figuren", d: "Typen, die niemand in der Anzeige erwartet (Punker, Oma in Lederjacke) plus ironischer Spruch." },
    { id: "Format-Parodie", d: "Imitiert Zeitungsformate: Traueranzeige, Kleinanzeige, Horoskop, Wetter, Leserbrief, Schlagzeile (als ANZEIGE gekennzeichnet)." },
    { id: "Serienfigur", d: "Wiederkehrende Figur mit Folgen (z. B. Nachbar Horst), Leser warten auf die nächste." },
    { id: "Selbstironie", d: "Macht sich darüber lustig, dass man in der Zeitung wirbt." },
    { id: "Lokalpatriotismus", d: "Orte, Dialekt und Eigenheiten der Stadt; wird in lokalen Facebook-Gruppen geteilt." },
    { id: "Mitmach-Aktion", d: "Foto der Anzeige posten oder Rätsel lösen, Lösung führt zur Website." },
  ];
  const LAYOUTS = { A: "A · Foto + 3 Häkchen", B: "B · Frage + Badge", C: "C · Ein Anruf. Drei Angebote.", D: "D · 3 Schritte", P: "P · Format-Parodie" };
  const FORMATE = [
    { id: "1x60", label: "1 Sp. × 60 mm", w: 45, h: 60 }, { id: "2x95", label: "2 Sp. × 95 mm", w: 93, h: 95 },
    { id: "3x140", label: "3 Sp. × 140 mm", w: 141, h: 140 }, { id: "q-hoch", label: "1/4 Seite hoch", w: 141, h: 200 },
    { id: "h-quer", label: "1/2 Seite quer", w: 282, h: 200 }, { id: "ganz", label: "1/1 Seite", w: 282, h: 400 },
  ];
  // Standardpreis (netto) je Blatt und Format – gleiche Regel wie im Buchungs-Agenten (lib/buchung/regeln.js)
  const SPALTEN_MM = { "1x60": { sp: 1, h: 60 }, "2x95": { sp: 2, h: 95 }, "3x140": { sp: 3, h: 140 } };
  const stdPreis = (b, fid) => { const p = b?.buchung || {}; const fest = num(p.preise?.[fid]); if (fest > 0) return fest; const mm = num(p.mmPreis), s = SPALTEN_MM[fid]; return mm > 0 && s ? Math.round(mm * s.sp * s.h * 100) / 100 : 0; };
  const stdPreisListe = (b) => Object.fromEntries(FORMATE.map((f) => [f.label, stdPreis(b, f.id)]).filter(([, v]) => v > 0));
  const KANAELE = ["Telefon", "WhatsApp", "QR-Code", "URL"];
  const KONTAKT_KANAELE = [...KANAELE, "Coupon", "Sonstiges"];
  const STATUS = ["geplant", "freigegeben", "gebucht", "erschienen", "beendet"];
  const TAGE = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
  const TAG_IDX = { "Sonntag": 0, "Montag": 1, "Dienstag": 2, "Mittwoch": 3, "Donnerstag": 4, "Freitag": 5, "Samstag": 6 };
  const PAGES = {
    auswertung: ["Analytics", "Lokal günstiger erreichen als auf Meta: was jede Anzeige kostet und bringt, was das Lern-Modell daraus ableitet und was als Nächstes getestet werden sollte."],
    kampagnen: ["Kampagnen", "Neue Kampagne mit einem Klick. Der Agent plant, textet, legt Anzeigen an und gibt sie im Limit frei."],
    anzeigen: ["Anzeigen", "Alle Motive als Druckvorschau, jede mit eigenem Tracking-Code."],
    studio: ["KI-Studio", "Neue Anzeigen im Hausstil, mit Viral-Bausteinen und fertigem Bild-Prompt."],
    kontakte: ["Kontakte", "Jeder Anruf und jede Anfrage, einer Anzeige zugeordnet."],
    blaetter: ["Wochenblätter", "Die Blätter, in denen geschaltet werden kann."],
    strategie: ["Strategie-Kompass", "Woran wir als Nächstes arbeiten sollten, damit der Plan aufgeht."],
  };

  const S = { blaetter: [], anzeigen: [], kontakte: [], kampagnen: [], settings: { basisUrl: "", waNummer: "", marke: "", limit: null, erloes: null, erledigt: {} } };
  let db = null, sample = null, assets = null;
  let editingAd = null, editingBlatt = null, adView = "vorschau", showDemo = true, currentTab = "auswertung";
  let lastStudio = [];

  // ================= Helfer =================
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const eur = (v, d = 0) => num(v).toLocaleString("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: d, minimumFractionDigits: d });
  const int = (v) => num(v).toLocaleString("de-DE");
  const pct = (v) => Math.round(v * 100) + " %";
  const isoLocal = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
  const todayISO = () => isoLocal(new Date());
  const fmtDate = (iso) => { if (!iso) return "—"; const [y, m, d] = String(iso).split("-"); return d && m ? `${d}.${m}.${y.slice(2)}` : esc(iso); };
  const fmtById = (id) => FORMATE.find((f) => f.id === id) || FORMATE[3];
  const options = (arr, sel) => arr.map((v) => { const val = typeof v === "object" ? v.value : v; const lab = typeof v === "object" ? v.label : v; return `<option value="${esc(val)}"${val === sel ? " selected" : ""}>${esc(lab)}</option>`; }).join("");
  const checks = (name, arr, sel = []) => arr.map((v) => { const val = typeof v === "object" ? v.value : v; const lab = typeof v === "object" ? v.label : v; return `<label><input type="checkbox" name="${name}" value="${esc(val)}"${sel.includes(val) ? " checked" : ""}> ${esc(lab)}</label>`; }).join("");
  const readChecks = (c) => [...c.querySelectorAll("input:checked")].map((i) => i.value);
  const setChecks = (c, vals) => c.querySelectorAll("input").forEach((i) => { i.checked = (vals || []).includes(i.value); });
  const prefix = (stadt) => (String(stadt || "XXX").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z]/g, "").toUpperCase() + "XXX").slice(0, 3);
  const adLink = (a) => S.settings.basisUrl && a?.code ? `${S.settings.basisUrl.replace(/\/+$/, "")}/${a.code.toLowerCase()}` : "";
  const geschaltet = (a) => a.status === "erschienen" || a.status === "beendet";
  const vis = (x) => showDemo || !x.demo;
  const B = () => S.blaetter.filter(vis), A = () => S.anzeigen.filter(vis), KP = () => S.kampagnen.filter(vis);
  const blattById = (id) => S.blaetter.find((b) => b.id === id);
  const adById = (id) => S.anzeigen.find((a) => a.id === id);
  const kampById = (id) => S.kampagnen.find((k) => k.id === id);
  const marke = () => S.settings.marke || "Modernisieren24";
  let toastT;
  function toast(msg) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 3400); }
  async function write(fn, okMsg) {
    if (!db) { toast("Speichern geht nur, wenn die Datenbank verbunden ist."); return false; }
    try { await fn(); if (okMsg) toast(okMsg); return true; }
    catch (e) { const c = e && e.code; toast(c === "invalid_argument" ? "Keine Schreibrechte oder ungültige Eingabe." : c === "quota_exceeded" ? "Datenbank ist voll." : "Speichern fehlgeschlagen, bitte gleich nochmal."); return false; }
  }
  function armDelete(btn, action) { if (btn.classList.contains("armed")) { action(); return; } btn.classList.add("armed"); btn.textContent = "Wirklich löschen?"; setTimeout(() => { btn.classList.remove("armed"); btn.textContent = "Löschen"; }, 3000); }
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

  // ================= Beispiel-Kontakte (deterministisch erzeugt) =================
  function rng(seedStr) { let h = 1779033703 ^ seedStr.length; for (let i = 0; i < seedStr.length; i++) { h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); } return () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16; return (h >>> 0) / 4294967296; }; }
  const DAYW = [[0, .30], [1, .22], [2, .14], [3, .09], [5, .15], [10, .07], [18, .03]];
  const KANW = { Telefon: .62, URL: .18, "QR-Code": .12, WhatsApp: .08 };
  let demoCache = { key: "", list: [] };
  function demoKontakte() {
    const ads = S.anzeigen.filter((a) => a.demo && geschaltet(a) && a.datum);
    const key = ads.map((a) => a.id + a.datum + JSON.stringify(a.demo)).join("|");
    if (key === demoCache.key) return demoCache.list;
    const out = [];
    for (const a of ads) {
      const d = a.demo || {}; const r = rng(a.code || a.id); const n = Math.round(num(d.k));
      const q = Math.round(n * num(d.q)); const v = Math.round(q * num(d.v));
      const kw = (a.kontaktwege || KANAELE).filter((k) => KANW[k]); const kwSum = kw.reduce((s, k) => s + KANW[k], 0) || 1;
      const idx = [...Array(n).keys()].sort(() => r() - 0.5);
      for (let i = 0; i < n; i++) {
        let x = r(), day = 0; for (const [dd, w] of DAYW) { if (x < w) { day = dd + Math.floor(r() * (dd >= 5 ? 3 : 1)); break; } x -= w; }
        let y = r() * kwSum, kanal = kw[0] || "Telefon"; for (const k of kw) { if (y < KANW[k]) { kanal = k; break; } y -= KANW[k]; }
        const rank = idx[i];
        if (Date.parse(a.datum) + day * 864e5 > Date.now()) continue; // noch nicht eingegangen
        out.push({ id: `demo-${a.id}-${i}`, demo: true, anzeigeId: a.id, code: a.code, kategorie: a.kategorie, kanal, datum: isoLocal(new Date(Date.parse(a.datum) + day * 864e5)), qualifiziert: rank < q, einwilligung: rank < q, erloes: rank < v ? num(d.e) : 0, plz: "" });
      }
    }
    demoCache = { key, list: out }; return out;
  }
  const K = () => [...S.kontakte.filter(vis), ...(showDemo ? demoKontakte() : [])];
  let statCache = new Map();
  function recompute() {
    statCache = new Map();
    for (const k of K()) { const s = statCache.get(k.anzeigeId) || { kontakte: 0, leads: 0, erloes: 0, verkauft: 0 }; s.kontakte++; if (k.qualifiziert) s.leads++; s.erloes += num(k.erloes); if (num(k.erloes) > 0) s.verkauft++; statCache.set(k.anzeigeId, s); }
  }
  function adStats(a) { const s = statCache.get(a.id) || { kontakte: 0, leads: 0, erloes: 0, verkauft: 0 }; const kosten = num(a.kosten); return { ...s, kosten, cpl: s.leads ? kosten / s.leads : null }; }
  // ================= Kosten: Zeitung + KI (Tokens, Bild-Credits) =================
  const KI_DEF = { inMTok: 3, outMTok: 15, creditEur: 0.10, creditsBild: 0.5 };
  const META_CPM = 9; // Richtwert Meta Deutschland 2026, ca. 8–11 $ bzw. 5–15 € je 1.000 Impressionen (Q4 teurer)
  const metaCpm = () => num(S.settings.metaCpm) || META_CPM;
  const kiP = () => ({ ...KI_DEF, ...(S.settings.kiPreise || {}) });
  const tok = (x) => Math.ceil(String(typeof x === "string" ? x : JSON.stringify(x ?? "")).length / 4);
  const tokEur = (l) => (num(l.tin) * num(kiP().inMTok) + num(l.tout) * num(kiP().outMTok)) / 1e6;
  // Echte Token-Zahlen, wenn die Server-Schnittstelle sie liefert (Lokalpilot auf Vercel), sonst Schätzung
  const realTok = (p, r) => { const u = window.__lpUsage; if (u && Date.now() - u.t < 10000) { window.__lpUsage = null; return { tin: num(u.input_tokens), tout: num(u.output_tokens), echt: true }; } return { tin: tok(p), tout: tok(r) }; };
  const logsEur = (arr) => (arr || []).reduce((x, l) => x + tokEur(l), 0);
  const logsTok = (arr) => (arr || []).reduce((x, l) => x + num(l.tin) + num(l.tout), 0);
  const bildCredits = (a) => { const m = a.motiv; if (!m || m.typ !== "bild") return 0; if (m.credits != null) return num(m.credits); return m.higgsfieldJobId || /higgsfield/i.test(m.quelle || "") ? num(kiP().creditsBild) : 0; };
  const zeitungKosten = (a) => (geschaltet(a) || a.status === "gebucht") ? num(a.kosten) : 0;
  function costOf(ads, kamps, mitAllgemein) {
    const c = { zeitung: 0, kiText: 0, kiBild: 0, tokens: 0, credits: 0 };
    ads.forEach((a) => { c.zeitung += zeitungKosten(a); c.kiText += logsEur(a.kiKosten); c.tokens += logsTok(a.kiKosten); if (a.motiv?.bildEur != null) { c.kiBild += num(a.motiv.bildEur); c.bilderApi = (c.bilderApi || 0) + 1; return; } const cr = bildCredits(a); c.credits += cr; c.kiBild += cr * num(kiP().creditEur); });
    kamps.forEach((k) => { c.kiText += logsEur(k.kiKosten); c.tokens += logsTok(k.kiKosten); });
    if (mitAllgemein) { c.kiText += logsEur(S.settings.kiLog); c.tokens += logsTok(S.settings.kiLog); }
    c.ki = c.kiText + c.kiBild; c.gesamt = c.zeitung + c.ki; return c;
  }
  const kiShare = (x) => x >= .1 ? pct(x) : (x * 100).toLocaleString("de-DE", { maximumFractionDigits: x < .001 ? 3 : 2 }) + " %";
  const eur2 = (v) => Math.abs(num(v)) < 10 ? eur(v, 2) : eur(v);
  async function logKi(art, prompt, res) {
    const e = { art, ...realTok(prompt, res), am: todayISO() };
    const list = [...(S.settings.kiLog || []), e].slice(-300); S.settings.kiLog = list;
    if (db) try { await db.doc("einstellungen/allgemein").set({ ...S.settings, kiLog: list }); } catch (err) {}
  }
  const stadtOf = (a) => blattById(a.blattId)?.stadt || "unbekannt";
  function groupKey(a, dim) {
    if (dim === "kontaktwege") return (a.kontaktwege || []).slice().sort((x, y) => KANAELE.indexOf(x) - KANAELE.indexOf(y)).join(" + ") || "keine";
    if (dim === "format") return fmtById(a.format).label;
    if (dim === "blatt") return blattById(a.blattId)?.name || "unbekannt";
    if (dim === "stadt") return stadtOf(a);
    if (dim === "kampagne") return kampById(a.kampagneId)?.name || "ohne Kampagne";
    if (dim === "layout") return LAYOUTS[a.layout] || "unbekannt";
    if (dim === "viral") return a.viral || "Klassisch";
    if (dim === "ton") return a.ton || "—";
    return a[dim] || "—";
  }

  // ================= Smart-Modell =================
  // Bayes-geglättete Leads pro Euro je Merkmal; Prognose = global × Produkt der Faktoren.
  const FEATS = [["kategorie", (a) => a.kategorie], ["viral", (a) => a.viral || "Klassisch"], ["ton", (a) => a.ton || "—"], ["stadt", stadtOf], ["layout", (a) => a.layout || "A"]];
  const PRIOR = 1500; // € Kosten, die ein Merkmal braucht, bevor seine Daten so viel zählen wie der Durchschnitt
  function trainModel(ads) {
    const units = ads.filter((a) => geschaltet(a) && num(a.kosten) > 0).map((a) => ({ a, s: adStats(a) }));
    const C = units.reduce((s, u) => s + u.s.kosten, 0), L = units.reduce((s, u) => s + u.s.leads, 0);
    if (!C || !L) return null;
    const g = L / C; const f = {};
    for (const [name, get] of FEATS) {
      const m = new Map(); units.forEach((u) => { const v = get(u.a); const x = m.get(v) || { c: 0, l: 0, n: 0 }; x.c += u.s.kosten; x.l += u.s.leads; x.n++; m.set(v, x); });
      f[name] = new Map([...m].map(([v, x]) => [v, { factor: ((x.l + PRIOR * g) / (x.c + PRIOR)) / g, weight: x.c / (x.c + PRIOR), n: x.n, c: x.c, l: x.l }]));
    }
    return { g, f, units, C, L };
  }
  function predict(model, combo) {
    let ls = 0, w = 0, k = 0;
    for (const [name] of FEATS) { const v = combo[name]; if (v == null) continue; const e = model.f[name].get(v); ls += Math.log(e ? e.factor : 1); w += e ? e.weight : 0; k++; }
    // Merkmale hängen oft zusammen (eine Kampagne = eine Stadt + ein Ton + ein Baustein). Gedämpft kombinieren, damit derselbe Effekt nicht mehrfach zählt.
    const r = model.g * Math.exp(k ? ls / Math.sqrt(k) : 0);
    return { rate: r, cpl: r > 0 ? 1 / r : null, conf: k ? w / k : 0 };
  }
  const confLabel = (c) => c > .6 ? "hoch" : c > .35 ? "mittel" : "niedrig";

  // ================= Kompass / Strategie (nur echte Daten) =================
  const PHASES = [
    { id: "p1", name: "Vorbereitung", gate: "Abnehmer und Einwilligung stehen", tasks: [
      { id: "marke", t: "Marke festlegen", auto: () => !!S.settings.marke, go: "kampagnen" },
      { id: "limit", t: "Limit für automatische Freigabe setzen", auto: () => S.settings.limit != null && S.settings.limit !== "", go: "kampagnen" },
      { id: "preise", t: "Preise der Wochenblätter eintragen", auto: () => S.blaetter.filter((b) => !b.demo).some((b) => /\d/.test(b.preisInfo || "")), go: "blaetter" },
      { id: "abnehmer", t: "Abnehmer je Kategorie und Preis je Lead klären", manual: true },
      { id: "einwilligung", t: "Einwilligungs- und Datenschutztexte prüfen lassen", manual: true },
      { id: "flo", t: "Hosting auf Vercel + Supabase einrichten", manual: true },
    ] },
    { id: "p2", name: "Test Salzgitter", gate: "Kosten pro Lead unter halbem Erlös", tasks: [
      { id: "kamp", t: "Erste Kampagne mit Terminen planen", auto: () => S.anzeigen.some((a) => !a.demo && a.datum && a.kampagneId), go: "kampagnen" },
      { id: "nummern", t: "Tracking-Nummern für geplante Anzeigen", auto: () => { const r = S.anzeigen.filter((a) => !a.demo && a.datum); return r.length > 0 && r.every((a) => a.trackingNummer); }, go: "anzeigen" },
      { id: "gebucht", t: "Erste Anzeige gebucht", auto: () => S.anzeigen.some((a) => !a.demo && ["gebucht", "erschienen", "beendet"].includes(a.status)), go: "anzeigen" },
      { id: "erschienen", t: "Erste Anzeige erschienen", auto: () => S.anzeigen.some((a) => !a.demo && geschaltet(a)), go: "anzeigen" },
      { id: "kontakte30", t: "30 Kontakte erfasst", auto: () => S.kontakte.filter((k) => !k.demo).length >= 30, go: "kontakte" },
    ] },
    { id: "p3", name: "Region skalieren", gate: "3 Monate profitabel", tasks: [
      { id: "staedte", t: "In mindestens 3 Städten geschaltet", auto: () => new Set(S.anzeigen.filter((a) => !a.demo && geschaltet(a)).map(stadtOf)).size >= 3, go: "kampagnen" },
      { id: "gewinner", t: "Gewinner-Motiv in neue Stadt übertragen", manual: true },
      { id: "nummernpool", t: "Rufnummernpool mit automatischer Erfassung", manual: true },
    ] },
    { id: "p4", name: "Automatisieren", gate: "Läuft ohne Handarbeit", tasks: [
      { id: "server", t: "Lokalpilot auf eigenem Server", manual: true },
      { id: "buchung", t: "KI-Agenten entscheiden und buchen Anzeigen bei den Zeitungen selbstständig (ohne Eingreifen, im Limit)", manual: true },
      { id: "agent-entscheidet", t: "Agent wählt Blatt, Termin, Motiv und Budget allein aus dem Lern-Modell", manual: true },
      { id: "bilder", t: "Bild-Agent erzeugt Motive selbst", manual: true },
      { id: "video", t: "Videos für digitale Kanäle", manual: true },
    ] },
    { id: "p5", name: "Reichweite mit Partnern (Idee)", gate: "Entscheidung nach Pilot", tasks: [
      { id: "partner-pruefen", t: "Partner-Programm durchdenken: Chancen und Risiken", manual: true },
      { id: "partner-pilot", t: "Pilot mit 5 handverlesenen Partnern", manual: true },
    ] },
  ];
  const taskDone = (t) => t.manual ? !!(S.settings.erledigt || {})[t.id] : !!t.auto();
  function currentPhase() { for (const p of PHASES) if (!p.tasks.every(taskDone)) return p; return PHASES[PHASES.length - 1]; }
  function nextSteps() {
    const out = []; const real = S.anzeigen.filter((a) => !a.demo); const today = Date.parse(todayISO());
    S.kampagnen.filter((k) => !k.demo && k.status === "Wartet auf Freigabe").forEach((k) => out.push({ id: "frei-" + k.id, p: 100, t: `„${k.name}“ freigeben`, d: `Liegt über eurem Limit (${eur(k.planKosten)}). Ein Klick gibt Kampagne und Anzeigen frei.`, go: "kampagnen", a: "Freigeben", run: async () => { if (await write(() => db.collection("kampagnen").doc(k.id).update({ status: "Freigegeben", freigegebenAm: Date.now() }), `${k.name} freigegeben`)) for (const a of S.anzeigen.filter((x) => x.kampagneId === k.id && x.status === "geplant")) await write(() => db.collection("anzeigen").doc(a.id).update({ status: "freigegeben" })); } }));
    const soon = real.filter((a) => a.datum && ["geplant", "freigegeben"].includes(a.status) && Date.parse(a.datum) - today <= 10 * 864e5 && Date.parse(a.datum) >= today);
    if (soon.length) out.push({ id: "buchen", p: 95, t: `${soon.length} Anzeige${soon.length > 1 ? "n" : ""} buchen`, d: `Erscheinen in den nächsten 10 Tagen, z. B. ${soon[0].code} am ${fmtDate(soon[0].datum)}. Buchungsanfragen sind mit einem Klick fertig.`, go: "anzeigen", a: "Buchung vorbereiten", run: () => bookingAction(soon) });
    const realGesch = real.filter(geschaltet).length;
    if (realGesch >= 3 && realStaedte().length) { const c = bestRealCombo(); if (c) out.push({ id: "modell-" + [c.kat, c.v, c.st].join("-"), p: 70, t: `Nächsten Test starten: ${c.kat} · ${c.v} in ${c.st}`, d: `Lern-Modell erwartet ca. ${eur(c.cpl)} je Lead (Sicherheit ${confLabel(c.conf)}).`, go: "kampagnen", a: "Test starten", run: () => ACTIONS.gewinner.run() }); }
    const stale = real.filter((a) => geschaltet(a) && !adStats(a).kontakte && Date.parse(a.datum) < today - 3 * 864e5);
    if (stale.length) out.push({ id: "kontakte", p: 90, t: "Kontakte zu erschienenen Anzeigen erfassen", d: `${stale.length} Anzeige${stale.length > 1 ? "n" : ""} ohne einen einzigen Kontakt – fehlen Einträge?`, go: "kontakte" });
    // Wiederkehrend: es soll immer eine nächste Testrunde geben
    const kampDone = taskDone(PHASES[1].tasks[0]);
    const horizon = isoLocal(new Date(Date.now() + 21 * 864e5));
    if (kampDone && !real.some((a) => a.datum && a.datum >= todayISO() && a.datum <= horizon && a.status !== "beendet")) out.push({ id: "runde-" + todayISO().slice(0, 7), p: 75, t: "Nächste Testrunde planen", d: "In den nächsten 3 Wochen erscheint keine Anzeige. Damit das Lern-Modell weiterlernt, plant der Agent die nächste Runde.", go: "kampagnen", a: "Runde planen", run: () => { const c = bestRealCombo(); if (c) ACTIONS.gewinner.run(); else ACTIONS.kamp.run(); } });
    // Ideen des Strategie-Agenten
    (S.settings.ideen || []).filter((x) => x && !x.done).slice(0, 4).forEach((x, i) => out.push({ id: "idee-" + x.id, p: 40 - i, t: x.titel, d: x.beschreibung || "Idee des Strategie-Agenten", go: "kampagnen", a: x.typ === "kampagne" ? "Kampagne starten" : x.typ === "studio" ? "Anzeigen erstellen" : "Ansehen", run: () => runIdee(x) }));
    out.push({ id: "ideen-agent", p: 5, t: (S.settings.ideen || []).some((x) => x && !x.done) ? "Weitere Ideen holen" : "Neue Ideen für die nächsten Schritte", d: "Der Strategie-Agent schaut auf eure Zahlen, das Lern-Modell und die Phase und schlägt drei konkrete nächste Schritte vor.", go: "strategie", a: "Ideen holen", run: ideenAgent });
    const ph = currentPhase();
    ph.tasks.filter((t) => !taskDone(t)).forEach((t, i) => out.push({ id: "task-" + t.id, p: 60 - i, t: t.t, d: `Phase „${ph.name}“`, go: t.go || "strategie", manual: t.manual ? t.id : null, a: ACTIONS[t.id]?.a, run: ACTIONS[t.id]?.run }));
    return out.sort((a, b) => b.p - a.p);
  }
  function renderKompass() {
    const el = $("kompass"); const min = lsGet("lp-kompass-min", false); const snoozed = lsGet("lp-snooze", {});
    const steps = nextSteps().filter((s) => !(snoozed[s.id] > Date.now())); const s = steps[0]; const ph = currentPhase();
    el.className = "kompass" + (min ? " min" : "");
    if (min) { el.innerHTML = `<div class="kh"><span>Kompass</span><button type="button" data-k="max">Einblenden</button></div>`; return; }
    el.innerHTML = s ? `<div class="kh"><span>Nächster Schritt</span><button type="button" data-k="min" title="Kompass einklappen">Einklappen</button></div><b>${esc(s.t)}</b><p>${esc(s.d)}</p><div class="kb"><button class="b small primary" type="button" data-k="go">${s.run ? "▸ " + esc(s.a || "Ausführen") : "Öffnen"}</button><button class="b small ghost" type="button" data-k="snooze">Später</button><button class="b small ghost" type="button" data-k="all">Alle</button></div><span class="phase">Phase ${PHASES.indexOf(ph) + 1}/${PHASES.length} · ${esc(ph.name)}</span>`
      : `<div class="kh"><span>Kompass</span><button type="button" data-k="min">Einklappen</button></div><b>Alles erledigt für jetzt</b><p>Frei arbeiten – der Kompass meldet sich, wenn es Neues gibt.</p><div class="kb"><button class="b small ghost" type="button" data-k="all">Strategie ansehen</button></div>`;
    el.dataset.step = s ? s.id : ""; el.dataset.go = s ? s.go : "";
  }
  $("kompass").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-k]"); if (!b) return; const k = b.dataset.k; const el = $("kompass");
    if (k === "min") { lsSet("lp-kompass-min", true); renderKompass(); }
    if (k === "max") { lsSet("lp-kompass-min", false); renderKompass(); }
    if (k === "go") { const st = nextSteps().find((x) => x.id === el.dataset.step); if (st) runStep(st); else showTab(el.dataset.go || "strategie"); }
    if (k === "all") showTab("strategie");
    if (k === "snooze") { const sn = lsGet("lp-snooze", {}); sn[el.dataset.step] = Date.now() + 864e5; lsSet("lp-snooze", sn); renderKompass(); }
  });
  function renderStrategie() {
    const ph = currentPhase(); const steps = nextSteps();
    $("nextlist").innerHTML = steps.length ? steps.slice(0, 6).map((s, i) => `<div class="next"><span class="n">${i + 1}</span><div><b>${esc(s.t)}</b><p>${esc(s.d)}</p></div><div class="btns">${s.manual ? `<button class="b small ghost" data-done="${esc(s.manual)}">Erledigt</button>` : ""}<button class="b small primary" data-run="${esc(s.id)}">${s.run ? "▸ " + esc(s.a || "Ausführen") : "Öffnen"}</button></div></div>`).join("") : `<div class="empty"><strong>Nichts Dringendes</strong>Alle Aufgaben der aktuellen Phase sind erledigt.</div>`;
    $("phases").innerHTML = PHASES.map((p, i) => { const done = p.tasks.every(taskDone); return `<div class="phase${p === ph ? " now" : ""}${done ? " done" : ""}"><span class="pn">Phase ${i + 1}${p === ph ? " · jetzt" : done ? " · erledigt" : ""}</span><h3>${esc(p.name)}</h3><ul>${p.tasks.map((t) => `<li class="${taskDone(t) ? "ok" : ""}"><span class="ck">${taskDone(t) ? "✓" : ""}</span><span>${esc(t.t)}${!taskDone(t) && ACTIONS[t.id] ? ` <button class="b small ghost tiny" data-task="${t.id}">▸ ${esc(ACTIONS[t.id].a)}</button>` : ""}${t.manual ? ` <button class="b small ghost tiny" data-toggle="${t.id}">${taskDone(t) ? "zurück" : "abhaken"}</button>` : ""}</span></li>`).join("")}</ul><div class="gate">Weiter, wenn: ${esc(p.gate)}</div></div>`; }).join("");
  }
  async function toggleManual(id, val) { const er = { ...(S.settings.erledigt || {}) }; er[id] = val; await write(() => db.doc("einstellungen/allgemein").set({ ...S.settings, erledigt: er })); }
  $("v-strategie").addEventListener("click", (e) => {
    const rn = e.target.closest("[data-run]"); if (rn) { runStep(nextSteps().find((x) => x.id === rn.dataset.run)); return; }
    const go = e.target.closest("[data-go]"); if (go) { showTab(go.dataset.go); return; }
    const tk = e.target.closest("[data-task]"); if (tk) { runStep({ run: ACTIONS[tk.dataset.task].run }); return; }
    const d = e.target.closest("[data-done]"); if (d) { toggleManual(d.dataset.done, true); return; }
    const t = e.target.closest("[data-toggle]"); if (t) toggleManual(t.dataset.toggle, !(S.settings.erledigt || {})[t.dataset.toggle]);
  });

  // ================= Aktionen: der Kompass führt Vorschläge direkt aus =================
  const actState = { btns: [] };
  function actOpen(title, html, btns = [], sub = "") {
    $("act-title").textContent = title; $("act-sub").textContent = sub; $("act-body").innerHTML = html; actState.btns = btns;
    $("act-btns").innerHTML = btns.map((b, i) => `<button type="button" class="b small ${b.cls || "ghost"}" data-ai="${i}">${esc(b.label)}</button>`).join("") + `<button type="button" class="b small ghost" data-ax="1">Schließen</button>`;
    $("actbox").hidden = false;
  }
  const actBusy = (title, msg) => actOpen(title, `<p class="thinking">${esc(msg)}</p>`, [], "Läuft …");
  const actClose = () => { $("actbox").hidden = true; };
  $("actbox").addEventListener("click", async (e) => {
    if (e.target === $("actbox") || e.target.closest("[data-ax]")) { actClose(); return; }
    const c = e.target.closest("[data-copy]"); if (c) { try { await navigator.clipboard.writeText($(c.dataset.copy).innerText); toast("Kopiert"); } catch (err) { toast("Kopieren nicht möglich – Text markieren."); } return; }
    const b = e.target.closest("[data-ai]"); if (b) { const def = actState.btns[+b.dataset.ai]; if (def) { b.disabled = true; try { await def.fn(); } finally { b.disabled = false; } } }
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") actClose(); });
  const copyBlock = (id, text, title = "") => `<div class="actblock">${title ? `<div class="ah"><b>${esc(title)}</b><button type="button" class="b small ghost" data-copy="${id}">Kopieren</button></div>` : ""}<div class="atext" id="${id}">${esc(text)}</div>${title ? "" : `<div class="btns"><button type="button" class="b small ghost" data-copy="${id}">Kopieren</button></div>`}</div>`;
  const saveSettings = (patch, msg) => write(() => db.doc("einstellungen/allgemein").set({ ...S.settings, ...patch }), msg);
  const markDone = (id) => ({ label: "Als erledigt abhaken", cls: "primary", fn: async () => { await toggleManual(id, true); toast("Abgehakt"); actClose(); } });
  const realBlaetter = () => S.blaetter.filter((b) => !b.demo);
  const realStaedte = () => [...new Set(realBlaetter().map((b) => b.stadt).filter(Boolean))];
  async function aiJson(prompt, art = "KI-Aktion") { if (!sample) throw { code: "not_granted" }; const r = await sample.json(prompt, { cache: false }); logKi(art, prompt, r); return r; }

  // Kampagnen-Agent direkt starten (füllt das Formular und schickt es ab)
  function launchCampaign({ name, blaetter, kats, viral, ton, hinweis }) {
    if (!sample || !db) { toast("Der Agent ist hier nicht verfügbar."); return; }
    const ids = (blaetter || realBlaetter()).map((b) => b.id); if (!ids.length) { toast("Zuerst ein echtes Wochenblatt anlegen."); showTab("blaetter"); return; }
    showTab("kampagnen"); fillSelects();
    $("kw-name").value = name; setChecks($("kw-blaetter"), ids); setChecks($("kw-kat"), kats || CORE_KATS);
    $("kw-viral").value = viral || "Agent wählt"; $("kw-ton").value = ton || $("kw-ton").value;
    if (!num($("kw-budget").value)) $("kw-budget").value = num(S.settings.limit) || 2000;
    $("kw-hinweis").value = hinweis || ""; $("kw-form").scrollIntoView({ behavior: "smooth", block: "start" });
    $("kw-form").requestSubmit();
  }
  function bestRealCombo() {
    const model = trainModel(A()); if (!model) return null; const st = realStaedte(); if (!st.length) return null;
    const tested = new Set(S.anzeigen.filter((a) => !a.demo && geschaltet(a)).map((a) => [a.kategorie, a.viral || "Klassisch", stadtOf(a)].join("|")));
    const out = []; for (const kat of [...new Set([...CORE_KATS, ...model.f.kategorie.keys()])].filter((k) => KAT_INFO[k])) for (const v of model.f.viral.keys()) for (const s of st) { if (tested.has([kat, v, s].join("|"))) continue; const p = predict(model, { kategorie: kat, viral: v, stadt: s }); if (p.cpl) out.push({ kat, v, st: s, cpl: p.cpl, conf: p.conf }); }
    return out.sort((a, b) => a.cpl - b.cpl)[0] || null;
  }

  const ACTIONS = {
    marke: { a: "Modernisieren24 setzen", run: () => saveSettings({ marke: "Modernisieren24" }, "Marke gesetzt") },
    limit: { a: "Limit setzen", run: () => actOpen("Limit für automatische Freigabe", `<p class="hint">Kampagnen bis zu diesem Betrag gibt der Agent selbst frei, darüber wartet er auf euren Klick.</p><label class="f">Limit pro Kampagne (€)<input type="number" id="act-limit" min="0" step="100" value="${esc(S.settings.limit ?? 2000)}"></label>`, [{ label: "Speichern", cls: "primary", fn: async () => { if (await saveSettings({ limit: num($("act-limit").value) }, "Limit gespeichert")) actClose(); } }]) },
    preise: { a: "Preisanfragen schreiben", run: () => {
      const bl = realBlaetter(); if (!bl.length) { showTab("blaetter"); return; }
      actOpen("Mediadaten anfragen", `<p class="hint">Je Verlag eine fertige Anfrage. Kopieren, abschicken, Antwort in „Wochenblätter“ eintragen.</p>` + bl.map((b, i) => copyBlock("act-p" + i, `Betreff: Mediadaten und Preise ${b.name}\n\nGuten Tag,\n\nwir planen ab den nächsten Wochen regelmäßige Anzeigen für ${marke()} im ${b.name} (${b.stadt}). Bitte senden Sie uns die aktuellen Mediadaten mit Preisen für folgende Formate:\n- 1/4 Seite hoch (ca. 141 × 200 mm)\n- 2 Spalten × 95 mm\n- 1 Spalte × 60 mm\n\nInteressant sind außerdem Anzeigenschluss, Rabatte bei Serien (6 und 12 Schaltungen), Platzierungswünsche und das Format der Druckdaten.\n\nVielen Dank und viele Grüße\n${marke()}`, `${b.name}${b.kontakt ? " · " + b.kontakt : ""}`)).join(""));
    } },
    abnehmer: { a: "Plan erstellen", run: async () => {
      actBusy("Abnehmer und Preis je Lead", "Die KI erstellt einen Plan für Abnehmer und Lead-Preise …");
      try {
        const st = realStaedte().join(", ") || "Salzgitter";
        const r = await aiJson(`Du berätst eine kleine Lead-Plattform (Marke ${marke()}). Leser von Wochenblättern in ${st} und Umgebung fragen kostenlos 3 Angebote an. Die Leads werden an regionale Anbieter verkauft (je Lead an bis zu 3 Anbieter). Kategorien: ${katListe()}.
Erstelle je Kategorie: passende Abnehmer-Typen (keine erfundenen Firmennamen), konkrete Wege, sie in der Region zu finden, ein Preismodell und eine realistische Preisspanne je Lead in Euro (pro Abnehmer, netto) mit einem Startpreis-Vorschlag. Markiere Preise als Schätzung. Dazu eine kurze, freundliche Erst-E-Mail an einen Fachbetrieb (Sie-Form, max. 120 Wörter, ohne Übertreibungen).
Antworte nur mit JSON: {"kategorien":[{"kategorie":"Wärmepumpe","abnehmer":["..."],"finden":["..."],"modell":"...","preisVon":0,"preisBis":0,"startpreis":0,"begruendung":"1 Satz"}],"anschreiben":"..."}`, "Abnehmer-Plan");
        const ks = Array.isArray(r?.kategorien) ? r.kategorien : []; if (!ks.length) throw { code: "invalid_json" };
        const html = `<p class="hint">Schätzung der KI als Startpunkt, nicht geprüft. Preise im Gespräch mit den ersten Abnehmern bestätigen.</p><div class="actgrid">${ks.map((k) => `<div class="actcard2"><b>${esc(k.kategorie)}</b><div class="big">${eur(k.startpreis)}<span> je Lead · Spanne ${eur(k.preisVon)}–${eur(k.preisBis)}</span></div><p>${esc(k.modell || "")}</p><div class="mini">Abnehmer</div><ul>${(k.abnehmer || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul><div class="mini">So finden</div><ul>${(k.finden || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul><p class="hint">${esc(k.begruendung || "")}</p></div>`).join("")}</div>${copyBlock("act-mail", String(r.anschreiben || ""), "Erst-E-Mail an Fachbetriebe")}`;
        const preise = Object.fromEntries(ks.map((k) => [k.kategorie, num(k.startpreis)]));
        const avg = Math.round(ks.reduce((s, k) => s + num(k.startpreis), 0) / ks.length);
        actOpen("Abnehmer und Preis je Lead", html, [{ label: "Startpreise übernehmen", cls: "primary", fn: async () => { if (await saveSettings({ leadpreise: preise, erloes: avg }, "Startpreise übernommen")) actOpen("Abnehmer und Preis je Lead", html, [markDone("abnehmer")], "Startpreise gespeichert (Ø " + eur(avg) + " je Lead)"); } }, markDone("abnehmer")], "Entwurf der KI");
      } catch (err) { actOpen("Abnehmer und Preis je Lead", `<p>${esc(sampleErr(err))}</p>`); }
    } },
    einwilligung: { a: "Entwürfe schreiben", run: async () => {
      actBusy("Einwilligung und Datenschutz", "Die KI schreibt Entwürfe für Einwilligung und Datenschutzhinweis …");
      try {
        const r = await aiJson(`Schreibe Entwürfe für eine deutsche Lead-Plattform (Marke ${marke()}): Interessenten melden sich per Telefon, WhatsApp oder Website und möchten bis zu 3 Angebote regionaler Anbieter (z. B. Wärmepumpe, Solaranlage, Heizung, Bad, Küche, Treppenlift, Pflege zu Hause, Immobilienverkauf). Ihre Kontaktdaten werden dafür an bis zu 3 Anbieter weitergegeben.
1) einwilligungTelefon: Satz, den der Mitarbeiter am Telefon vorliest und bestätigen lässt. 2) einwilligungWeb: Checkbox-Text fürs Formular. 3) datenschutz: kurzer Datenschutzhinweis (Zweck, Empfänger, Speicherdauer, Widerruf, Rechte), mit Platzhaltern in [eckigen Klammern] für Firmendaten. 4) pruefpunkte: Liste, was ein Anwalt prüfen sollte.
Klar, kurz, DSGVO-orientiert, kein Rechtsrat. Antworte nur mit JSON: {"einwilligungTelefon":"...","einwilligungWeb":"...","datenschutz":"...","pruefpunkte":["..."]}`, "Einwilligungs-Entwürfe");
        if (!r?.einwilligungWeb) throw { code: "invalid_json" };
        await saveSettings({ texte: { ...(S.settings.texte || {}), einwilligungTelefon: String(r.einwilligungTelefon || ""), einwilligungWeb: String(r.einwilligungWeb), datenschutz: String(r.datenschutz || ""), stand: todayISO() } });
        actOpen("Einwilligung und Datenschutz", `<p class="hint">Entwurf der KI, in Lokalpilot gespeichert. Vor dem ersten Einsatz anwaltlich prüfen lassen.</p>${copyBlock("act-t1", String(r.einwilligungTelefon || ""), "Am Telefon vorlesen")}${copyBlock("act-t2", String(r.einwilligungWeb), "Checkbox im Formular")}${copyBlock("act-t3", String(r.datenschutz || ""), "Datenschutzhinweis")}<div class="mini">Für die Prüfung</div><ul>${(r.pruefpunkte || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`, [markDone("einwilligung")], "Entwurf gespeichert");
      } catch (err) { actOpen("Einwilligung und Datenschutz", `<p>${esc(sampleErr(err))}</p>`); }
    } },
    flo: { a: "Checkliste öffnen", run: () => actOpen("Lokalpilot auf Vercel + Supabase", `<p class="hint">Was für den Umzug auf euren eigenen Server nötig ist.</p><ol class="actsteps"><li><b>Flo:</b> Supabase-Projekt in Region Frankfurt anlegen, Vercel-Projekt anlegen, beide mit einem GitHub-Repo verbinden.</li><li><b>Luca:</b> API-Schlüssel besorgen (Claude/Anthropic, Higgsfield) und in Vercel als Umgebungsvariablen hinterlegen.</li><li><b>Claude:</b> Lokalpilot als Web-App ins Repo schreiben: Datenbank-Tabellen, Login mit Rollen, Bildspeicher, KI-Funktionen auf dem Server.</li><li>Daten und Bilder aus dem Prototyp übernehmen, Team einladen.</li><li>Danach: Bild-Agent, Rufnummern-Tracking, Buchungs-Agent.</li></ol>`, [markDone("flo")]) },
    kamp: { a: "Kampagne starten", run: () => launchCampaign({ name: `Test ${realStaedte()[0] || ""} ${new Date(Date.now() + 14 * 864e5).toLocaleDateString("de-DE", { month: "long", year: "numeric" })}`.replace(/\s+/g, " ").trim(), hinweis: "Vom Kompass gestartet: erste echte Testkampagne. Vorhandene Motive (z. B. die Punk-Serie) nutzen, Kategorien mischen, damit das Lern-Modell vergleichen kann." }) },
    gewinner: { a: "Test starten", run: () => { const c = bestRealCombo(); if (!c) { toast("Das Lern-Modell braucht erst echte Ergebnisse."); showTab("auswertung"); return; } launchCampaign({ name: `Test ${c.st}: ${c.kat} · ${c.v}`, blaetter: realBlaetter().filter((b) => b.stadt === c.st), kats: [c.kat], viral: c.v, hinweis: `Vom Lern-Modell vorgeschlagen: erwartete Kosten pro Lead ca. ${Math.round(c.cpl)} €, Sicherheit ${confLabel(c.conf)}.` }); } },
  };
  const upcoming = () => S.anzeigen.filter((a) => !a.demo && a.datum && ["geplant", "freigegeben"].includes(a.status) && a.datum >= todayISO()).sort((x, y) => String(x.datum).localeCompare(String(y.datum)));
  ACTIONS.gebucht = { a: "Buchung vorbereiten", run: () => { const u = upcoming().slice(0, 8); if (!u.length) { toast("Keine geplanten Anzeigen mit Termin."); showTab("kampagnen"); return; } bookingAction(u); } };
  ACTIONS.nummern = { a: "Nummern eintragen", run: () => {
    const list = S.anzeigen.filter((a) => !a.demo && a.datum && !a.trackingNummer).sort((x, y) => String(x.datum).localeCompare(String(y.datum)));
    if (!list.length) { showTab("anzeigen"); return; }
    actOpen("Tracking-Nummern eintragen", `<p class="hint">Je Anzeige eine eigene Rufnummer, damit jeder Anruf der richtigen Anzeige zugeordnet wird. Sobald Lokalpilot auf dem Server läuft, holt der Tracking-Agent die Nummern automatisch beim Rufnummern-Anbieter.</p><div class="numlist">${list.map((a) => `<label class="f"><span><b class="code">${esc(a.code)}</b> · ${esc(blattById(a.blattId)?.name || "")} · ${fmtDate(a.datum)}</span><input type="tel" data-num="${esc(a.id)}" placeholder="z. B. 05341 123 45 01"></label>`).join("")}</div>`, [{ label: "Speichern", cls: "primary", fn: async () => { let n = 0; for (const i of document.querySelectorAll("[data-num]")) { const v = i.value.trim(); if (v && await write(() => db.collection("anzeigen").doc(i.dataset.num).update({ trackingNummer: v }))) n++; } toast(`${n} Nummer${n === 1 ? "" : "n"} gespeichert`); actClose(); } }]);
  } };
  ACTIONS.erschienen = { a: "Erschienene markieren", run: async () => { const due = S.anzeigen.filter((a) => !a.demo && a.status === "gebucht" && a.datum && a.datum <= todayISO()); if (!due.length) { toast("Noch keine gebuchte Anzeige ist erschienen."); showTab("anzeigen"); return; } for (const a of due) await write(() => db.collection("anzeigen").doc(a.id).update({ status: "erschienen" })); toast(`${due.length} Anzeige${due.length > 1 ? "n" : ""} als erschienen markiert`); } };
  ACTIONS.staedte = ACTIONS.gewinner;

  function bookingAction(ads) {
    const by = new Map(); ads.forEach((a) => { const k = a.blattId; by.set(k, [...(by.get(k) || []), a]); });
    const blocks = [...by].map(([bid, list], i) => { const b = blattById(bid) || {}; const lines = list.sort((x, y) => String(x.datum).localeCompare(String(y.datum))).map((a) => `- ${fmtDate(a.datum)}: ${fmtById(a.format).label} (${fmtById(a.format).w} × ${fmtById(a.format).h} mm), Motiv ${a.code}`).join("\n");
      return copyBlock("act-b" + i, `Betreff: Anzeigenbuchung ${b.name || ""}\n\nGuten Tag,\n\nhiermit möchten wir folgende Anzeigen für ${marke()} im ${b.name || "Wochenblatt"} verbindlich buchen:\n${lines}\n\nBitte bestätigen Sie die Buchung mit Preis und Anzeigenschluss. Die Druckdaten senden wir als PDF rechtzeitig vor Anzeigenschluss. Bitte nicht neben Traueranzeigen platzieren.\n\nVielen Dank und viele Grüße\n${marke()}`, `${b.name || "Blatt"}${b.anzeigenschluss ? " · Schluss " + b.anzeigenschluss : ""}`); }).join("");
    actOpen("Anzeigen buchen", `<p class="hint">Je Verlag eine fertige Buchungsanfrage. Abschicken, dann hier als gebucht markieren. (Automatisch buchen kann der Buchungs-Agent erst auf dem eigenen Server.)</p>${blocks}`, [{ label: `${ads.length} als gebucht markieren`, cls: "primary", fn: async () => { for (const a of ads) await write(() => db.collection("anzeigen").doc(a.id).update({ status: "gebucht" })); toast("Als gebucht markiert"); actClose(); } }]);
  }
  async function setIdee(id, patch) { const list = (S.settings.ideen || []).map((x) => x.id === id ? { ...x, ...patch } : x); await saveSettings({ ideen: list }); }
  async function runIdee(x) {
    if (x.typ === "kampagne") { await setIdee(x.id, { done: true, am: todayISO() }); launchCampaign({ name: x.titel, kats: (x.kategorien || []).filter((k) => KATEGORIEN.includes(k)), viral: VIRAL.some((v) => v.id === x.viral) ? x.viral : "Agent wählt", ton: TOENE.includes(x.ton) ? x.ton : undefined, hinweis: "Idee des Strategie-Agenten: " + (x.beschreibung || "") }); return; }
    if (x.typ === "studio") { await setIdee(x.id, { done: true, am: todayISO() }); showTab("studio"); fillSelects(); const k = (x.kategorien || [])[0]; if (KATEGORIEN.includes(k)) $("st-kategorie").value = k; if (VIRAL.some((v) => v.id === x.viral)) $("st-viral").value = x.viral; if (TOENE.includes(x.ton)) $("st-ton").value = x.ton; $("st-hinweis").value = x.beschreibung || ""; if (realBlaetter()[0] && !blattById($("st-blatt").value)?.id) $("st-blatt").value = realBlaetter()[0].id; $("st-form").requestSubmit(); return; }
    actOpen(x.titel, `<p>${esc(x.beschreibung || "")}</p>${x.schritte?.length ? `<ol class="actsteps">${x.schritte.map((t) => `<li>${esc(t)}</li>`).join("")}</ol>` : ""}`, [{ label: "Erledigt", cls: "primary", fn: async () => { await setIdee(x.id, { done: true, am: todayISO() }); actClose(); toast("Abgehakt"); } }, { label: "Verwerfen", fn: async () => { await setIdee(x.id, { done: true, verworfen: true }); actClose(); } }], "Idee des Strategie-Agenten");
  }
  async function ideenAgent() {
    actBusy("Strategie-Agent", "Schaut auf Zahlen, Lern-Modell und Phase …");
    try {
      const real = S.anzeigen.filter((a) => !a.demo); const ges = real.filter(geschaltet);
      const k = ges.reduce((o, a) => { const s = adStats(a); o.kosten += s.kosten; o.leads += s.leads; o.kontakte += s.kontakte; return o; }, { kosten: 0, leads: 0, kontakte: 0 });
      const model = trainModel(A()); const best = model ? Object.fromEntries(FEATS.map(([n]) => [n, [...model.f[n]].sort((x, y) => y[1].factor - x[1].factor).slice(0, 3).map(([v, e]) => `${v} ${e.factor.toFixed(2)}x (${e.weight > .5 ? "sicher" : "unsicher"})`)])) : null;
      const ph = currentPhase(); const offen = ph.tasks.filter((t) => !taskDone(t)).map((t) => t.t);
      const bisher = (S.settings.ideen || []).map((x) => x.titel + (x.verworfen ? " (verworfen)" : x.done ? " (erledigt)" : " (offen)"));
      const r = await aiJson(`Du bist der Strategie-Agent von Lokalpilot. Lokalpilot plant Print-Anzeigen in kostenlosen Wochenblättern für die Marke ${marke()} (Leser bekommen kostenlos 3 Angebote in den Kategorien ${LEAD_KATS.join(", ")}; bisher Fokus auf ${CORE_KATS.join(", ")}; Leads werden an regionale Anbieter verkauft). Ziel: Kosten pro Lead senken, Reichweite ausbauen, mit jedem Test lernen.
Stand: Phase „${ph.name}“, offene Aufgaben: ${JSON.stringify(offen)}. Echte Blätter/Städte: ${JSON.stringify(realBlaetter().map((b) => b.name + " (" + b.stadt + ")"))}. Echte Kampagnen: ${S.kampagnen.filter((x) => !x.demo).length}, echte Anzeigen: ${real.length}, davon geschaltet ${ges.length}, Kosten ${Math.round(k.kosten)} €, Kontakte ${k.kontakte}, Leads ${k.leads}.
Lern-Modell (Faktoren Leads pro Euro, inkl. Beispieldaten falls eingeblendet): ${JSON.stringify(best)}.
Viral-Bausteine: ${VIRAL.map((v) => v.id).join(", ")}. Töne: ${TOENE.join(", ")}.
Bisherige Ideen (nicht wiederholen): ${JSON.stringify(bisher.slice(-20))}
Schlage genau 3 konkrete, sofort umsetzbare nächste Schritte vor, die über die offenen Aufgaben hinausgehen (z. B. Test einer neuen Kombination, neue Motiv-Serie, neue Nachbarstadt prüfen, Prozess verbessern, Algorithmus verbessern). Mindestens einer davon typ "kampagne" oder "studio". typ "aufgabe" mit 2-4 kurzen Schritten.
Antworte nur mit JSON: {"ideen":[{"titel":"max 8 Wörter","beschreibung":"1-2 Sätze: was und warum","typ":"kampagne|studio|aufgabe","kategorien":["Wärmepumpe"],"viral":"...","ton":"...","schritte":["..."]}]}`, "Strategie-Agent");
      const neu = (Array.isArray(r?.ideen) ? r.ideen : []).filter((x) => x && x.titel).slice(0, 3).map((x, i) => ({ id: Date.now().toString(36) + i, titel: String(x.titel), beschreibung: String(x.beschreibung || ""), typ: ["kampagne", "studio", "aufgabe"].includes(x.typ) ? x.typ : "aufgabe", kategorien: Array.isArray(x.kategorien) ? x.kategorien.map(String) : [], viral: String(x.viral || ""), ton: String(x.ton || ""), schritte: Array.isArray(x.schritte) ? x.schritte.map(String).slice(0, 5) : [], am: todayISO() }));
      if (!neu.length) throw { code: "invalid_json" };
      const alt = (S.settings.ideen || []).filter((x) => x).slice(-27);
      await saveSettings({ ideen: [...alt, ...neu] });
      actOpen("Neue Ideen", `<p class="hint">Stehen jetzt im Kompass als nächste Schritte. Jede lässt sich mit einem Klick umsetzen.</p><ol class="actsteps">${neu.map((x) => `<li><b>${esc(x.titel)}</b><br>${esc(x.beschreibung)}</li>`).join("")}</ol>`, [{ label: "Erste Idee umsetzen", cls: "primary", fn: async () => { actClose(); await runIdee(neu[0]); } }], "Strategie-Agent");
    } catch (err) { actOpen("Strategie-Agent", `<p>${esc(sampleErr(err))}</p>`); }
  }
  ACTIONS["partner-pruefen"] = { a: "Chancen und Risiken", run: () => actOpen("Partner-Programm: andere bewerben unsere Marken", `<p>Idee: Externe Partner (z. B. Handwerker, Vereine, Admins lokaler Facebook-Gruppen, Creator) teilen unsere Anzeigen mit eigenem Tracking-Link und verdienen pro qualifiziertem Lead mit.</p><div class="actgrid"><div class="actcard2"><b>Dafür</b><ul><li>Mehr Reichweite in lokalen Netzwerken, Bezahlung nur bei Erfolg</li><li>Echte Empfehlungen wirken stärker als Werbung</li><li>Lern-Modell bekommt mehr Daten (Kanal „Partner“)</li></ul></div><div class="actcard2"><b>Dagegen / Risiken</b><ul><li>Qualität und Markenbild schwerer zu steuern</li><li>Fake- oder Gefälligkeits-Leads, Betrug</li><li>Recht: Werbekennzeichnung, Einwilligung, Datenschutz</li><li>Auszahlung, Gutschriften, Support-Aufwand</li></ul></div></div><div class="mini">Leitplanken für einen Pilot</div><ul><li>Nur freigegebene Motive aus der Bibliothek, keine eigenen Texte</li><li>Vergütung erst für geprüfte, qualifizierte Leads, mit Monats-Obergrenze</li><li>Eigener Code je Partner, Auswertung „Partner“ in Analytics</li><li>Kurzer Partner-Vertrag inkl. Kennzeichnungspflicht</li></ul>`, [markDone("partner-pruefen")]) };
  async function runStep(s) {
    if (!s) return;
    if (s.run) { try { await s.run(); } catch (e) { toast("Das hat nicht geklappt."); } return; }
    showTab(s.go || "strategie");
  }

  // ================= Cockpit =================
  function barList(rows, unit) {
    if (!rows.some((r) => r.v)) return `<p class="hint">Noch keine Kontakte erfasst.</p>`;
    const max = Math.max(1, ...rows.map((r) => r.v));
    return `<div class="bars">${rows.map((r) => `<div class="barrow" title="${esc(r.k)}: ${r.v} ${unit}"><div class="lbl">${esc(r.k)}</div><div class="track"><div class="fill" style="width:${r.v ? Math.max(2, (r.v / max) * 100) : 0}%"></div></div><div class="val">${r.v}</div></div>`).join("")}</div>`;
  }
  function renderCpm(ads) {
    const g = new Map(); ads.forEach((a) => { const b = blattById(a.blattId); const auf = num(b?.auflage); if (!auf || !num(a.kosten)) return; const k = b.name; const x = g.get(k) || { kosten: 0, auf: 0, n: 0, demo: b.demo }; x.kosten += num(a.kosten); x.auf += auf; x.n++; g.set(k, x); });
    const rows = [...g].map(([k, x]) => ({ k, cpm: x.kosten / (x.auf / 1000), n: x.n, demo: x.demo })).sort((a, b) => a.cpm - b.cpm);
    const meta = metaCpm(); const max = Math.max(meta, ...rows.map((r) => r.cpm)) * 1.1;
    if (!rows.length) { $("cpmx").innerHTML = `<p class="hint">Sobald Anzeigen mit Kosten erschienen sind und die Auflage der Blätter eingetragen ist, steht hier der Vergleich.</p>`; return; }
    const bar = (lbl, sub, v, cls) => `<div class="barrow"><div class="lbl">${lbl}<div class="muted">${sub}</div></div><div class="track"><div class="fill ${cls}" style="width:${Math.max(2, v / max * 100)}%"></div></div><div class="val">${eur2(v)}</div></div>`;
    const guenstiger = rows.filter((r) => r.cpm < meta).length;
    $("cpmx").innerHTML = `<div class="bars">${rows.map((r) => bar(esc(r.k) + (r.demo ? ` <span class="chip demo">Beispiel</span>` : ""), `${r.n} Schaltung${r.n > 1 ? "en" : ""} · je 1.000 Exemplare`, r.cpm, r.cpm < meta ? "best" : "")).join("")}${bar("<b>Meta</b> (Facebook/Instagram)", "Richtwert je 1.000 Einblendungen, anpassbar", meta, "meta")}</div><p class="hint" style="margin-top:10px">${guenstiger} von ${rows.length} Blättern liegen unter dem Meta-Richtwert. Achtung, kein 1:1-Vergleich: Auflage heißt gedruckt und verteilt, nicht gelesen. Darum zählt am Ende die Kennzahl Kosten pro Lead.</p>`;
  }
  function renderKosten(kf) {
    const kamps = (kf ? [kampById(kf)].filter(Boolean) : KP()).map((k) => { const ads = A().filter((a) => a.kampagneId === k.id); const c = costOf(ads, [k], false); const leads = ads.reduce((x, a) => x + adStats(a).leads, 0); return { k, c, leads }; }).sort((x, y) => y.c.gesamt - x.c.gesamt);
    const allg = kf ? null : costOf([], [], true); const lose = kf ? null : costOf(A().filter((a) => !a.kampagneId), [], false);
    const rows = kamps.map(({ k, c, leads }) => ({ name: k.name, demo: k.demo, c, leads }));
    if (lose && lose.gesamt > 0) rows.push({ name: "Anzeigen ohne Kampagne", c: lose, leads: A().filter((a) => !a.kampagneId).reduce((x, a) => x + adStats(a).leads, 0) });
    if (allg && allg.gesamt > 0) rows.push({ name: "KI allgemein (Strategie-Agent, Entwürfe)", c: allg, leads: 0 });
    const sum = rows.reduce((o, r) => { ["zeitung", "kiText", "kiBild", "gesamt", "tokens", "credits"].forEach((f) => (o[f] += r.c[f])); o.leads += r.leads; return o; }, { zeitung: 0, kiText: 0, kiBild: 0, gesamt: 0, tokens: 0, credits: 0, leads: 0 });
    const tr = (r, cls = "") => `<tr class="${cls}"><td class="wrap">${esc(r.name)}${r.demo ? ` <span class="chip demo">Beispiel</span>` : ""}</td><td class="num">${eur(r.c.zeitung)}</td><td class="num">${eur2(r.c.kiText)}<div class="muted">${int(r.c.tokens)} Tokens</div></td><td class="num">${eur2(r.c.kiBild)}<div class="muted">${r.c.credits.toLocaleString("de-DE")} Credits</div></td><td class="num"><b>${eur2(r.c.gesamt)}</b></td><td class="num">${r.c.gesamt ? kiShare((r.c.kiText + r.c.kiBild) / r.c.gesamt) : "—"}</td><td class="num">${r.leads ? eur(r.c.gesamt / r.leads) : "—"}</td></tr>`;
    $("kostenx").innerHTML = rows.length ? `<div class="tablewrap"><table><thead><tr><th>Kampagne</th><th class="num">Zeitung</th><th class="num">KI-Texte</th><th class="num">KI-Bilder</th><th class="num">Gesamt</th><th class="num">KI-Anteil</th><th class="num">Kosten/Lead</th></tr></thead><tbody>${rows.map((r) => tr(r)).join("")}${rows.length > 1 ? tr({ name: "Summe", c: sum, leads: sum.leads }, "sum") : ""}</tbody></table></div><p class="hint" style="margin-top:8px">Zeitung = gebuchte und erschienene Anzeigen. KI-Kosten geschätzt: Tokens ≈ Zeichen ÷ 4, ${eur2(kiP().inMTok)} / ${eur2(kiP().outMTok)} je 1 Mio. Tokens (Eingabe/Ausgabe), ${eur2(kiP().creditEur)} je Higgsfield-Credit. Preise unter Kampagnen → Automatik &amp; Marke anpassen. Auf dem eigenen Server kommen die echten Werte direkt von den Schnittstellen.</p>` : `<p class="hint">Noch keine Kosten.</p>`;
  }
  function renderAuswertung() {
    const kf = $("aw-kampagne").value; const inK = (a) => !kf || a.kampagneId === kf;
    const all = A().filter(inK); const ads = all.filter(geschaltet);
    let kosten = 0, kontakte = 0, leads = 0, erloes = 0, reich = 0, verkauft = 0;
    ads.forEach((a) => { const s = adStats(a); kosten += s.kosten; kontakte += s.kontakte; leads += s.leads; erloes += s.erloes; verkauft += s.verkauft; reich += num(blattById(a.blattId)?.auflage); });
    const kampsF = kf ? [kampById(kf)].filter(Boolean) : KP(); const cost = costOf(all, kampsF, !kf); const zeit = kosten; kosten = zeit + cost.ki;
    const cpl = leads ? kosten / leads : null;
    $("kpis").innerHTML = [
      { k: "Geschaltet", v: int(ads.length), s: `von ${int(all.length)} Anzeigen` },
      { k: "Kosten gesamt", v: eur(kosten), s: `Zeitung ${eur(zeit)} · KI ${eur2(cost.ki)}` },
      { k: "Reichweite", v: reich >= 1e6 ? (reich / 1e6).toLocaleString("de-DE", { maximumFractionDigits: 1 }) + " Mio." : int(reich), s: reich && kontakte ? `${(kontakte / reich * 1e4).toLocaleString("de-DE", { maximumFractionDigits: 1 })} Kontakte je 10.000 HH` : "Haushalte (Auflage)" },
      { k: "CPM (je 1.000 Auflage)", v: reich ? eur2(zeit / (reich / 1000)) : "—", s: `Meta-Richtwert ≈ ${eur2(metaCpm())} je 1.000 Einblendungen` },
      { k: "Kontakte", v: int(kontakte), s: kosten && kontakte ? `${eur(kosten / kontakte)} je Kontakt` : "noch keine" },
      { k: "Qualifizierte Leads", v: int(leads), s: kontakte ? `${pct(leads / kontakte)} der Kontakte` : "—" },
      { k: "Kosten pro Lead", v: cpl == null ? "—" : eur(cpl), s: "Gesamtkosten ÷ Leads", hl: true },
      { k: "Deckungsbeitrag", v: eur(erloes - kosten), s: `Erlös ${eur(erloes)} · ${verkauft} verkauft` },
      { k: "Erlös je Euro", v: kosten ? (erloes / kosten).toLocaleString("de-DE", { maximumFractionDigits: 2 }) + " €" : "—", s: leads ? `${pct(verkauft / leads)} der Leads verkauft` : "Erlös ÷ Gesamtkosten" },
      (() => { let liste = 0, bezahlt = 0; ads.forEach((a) => { const sp = stdPreis(blattById(a.blattId), a.format); if (sp && num(a.kosten)) { liste += sp; bezahlt += num(a.kosten); } }); return { k: "Ggü. Listenpreis", v: liste ? eur(liste - bezahlt) : "—", s: liste ? `${pct(Math.max(0, 1 - bezahlt / liste))} gespart · Liste ${eur(liste)}` : "Standardpreise je Blatt unter Buchungen eintragen" }; })(),
    ].map((t) => `<div class="tile${t.hl ? " hl" : ""}"><div class="k">${t.k}</div><div class="v">${t.v}</div><div class="s">${t.s}</div></div>`).join("");
    $("kpi-note").textContent = ads.length ? "" : "Zählt erst, wenn eine Anzeige den Status „erschienen“ hat.";
    renderKosten(kf); renderCpm(ads);

    // Insights
    const model = trainModel(A());
    const ins = [];
    if (model) {
      const best = (name) => [...model.f[name]].filter(([, x]) => x.c > 0).sort((a, b) => b[1].factor - a[1].factor);
      const v = best("viral"); if (v.length > 1) ins.push(`<b>${esc(v[0][0])}</b> bringt ${v[0][1].factor.toLocaleString("de-DE", { maximumFractionDigits: 1 })}× so viele Leads pro Euro wie der Durchschnitt, <b>${esc(v.at(-1)[0])}</b> nur ${v.at(-1)[1].factor.toLocaleString("de-DE", { maximumFractionDigits: 1 })}×.`);
      const st = best("stadt"); if (st.length > 1) ins.push(`Stärkste Stadt bisher: <b>${esc(st[0][0])}</b> (${eur(1 / (model.g * st[0][1].factor))} je Lead geschätzt), schwächste: <b>${esc(st.at(-1)[0])}</b>.`);
      const ks = K().filter((k) => { const a = adById(k.anzeigeId); return a?.datum && vis(a); });
      if (ks.length >= 20) { const early = ks.filter((k) => Date.parse(k.datum) - Date.parse(adById(k.anzeigeId).datum) <= 2 * 864e5).length; ins.push(`<b>${pct(early / ks.length)}</b> aller Kontakte kommen in den ersten zwei Tagen nach Erscheinen – Telefon an diesen Tagen besetzen.`); }
      const ser = A().filter((a) => a.viral === "Serienfigur" && geschaltet(a)).sort((x, y) => String(x.datum).localeCompare(String(y.datum)));
      if (ser.length >= 4) { const h = Math.floor(ser.length / 2); const s1 = ser.slice(0, h).reduce((s, a) => s + adStats(a).kontakte, 0) / h, s2 = ser.slice(h).reduce((s, a) => s + adStats(a).kontakte, 0) / (ser.length - h); if (s2 > s1) ins.push(`Die Serienfigur wächst: spätere Folgen bringen im Schnitt <b>${pct(s2 / s1 - 1)} mehr Kontakte</b> als die ersten.`); }
    }
    $("insights").innerHTML = ins.length ? ins.map((t, i) => `<div class="insight"><span class="ic">${i + 1}</span><span>${t}</span></div>`).join("") : `<div class="empty"><strong>Noch keine Muster</strong>Sobald Anzeigen erschienen sind und Kontakte erfasst werden, erkennt Lokalpilot hier, was funktioniert.</div>`;
    renderPrognose(model);

    // Was wirkt
    const dim = $("dim").value; const groups = new Map();
    ads.forEach((a) => { const k = groupKey(a, dim); const g = groups.get(k) || { kosten: 0, kontakte: 0, leads: 0, n: 0 }; const s = adStats(a); g.kosten += s.kosten; g.kontakte += s.kontakte; g.leads += s.leads; g.n++; groups.set(k, g); });
    const rows = [...groups.entries()].map(([k, g]) => ({ k, ...g, rate: g.kosten ? (g.leads / g.kosten) * 1000 : null })).sort((x, y) => (y.rate ?? -1) - (x.rate ?? -1));
    if (!rows.length) $("bars").innerHTML = `<div class="empty"><strong>Noch nichts zu vergleichen</strong>Hier erscheint, welcher Viral-Baustein, Ton, welche Stadt und welches Layout die meisten Leads pro Euro bringen.</div>`;
    else { const max = Math.max(1, ...rows.map((r) => r.rate || 0)); $("bars").innerHTML = `<div class="panel bars">${rows.map((r, i) => `<div class="barrow" title="${esc(r.k)}: ${r.n} Anzeige(n), ${eur(r.kosten)}, ${r.kontakte} Kontakte, ${r.leads} Leads"><div class="lbl">${esc(r.k)} <span class="muted">· ${r.n}</span></div><div class="track"><div class="fill${r.kontakte < 5 ? " thin" : i === 0 ? " best" : ""}" style="width:${r.rate ? Math.max(1.5, (r.rate / max) * 100) : 0}%"></div></div><div class="val">${r.rate == null ? "—" : r.rate.toLocaleString("de-DE", { maximumFractionDigits: 1 }) + " / 1.000 €"} · ${r.leads ? eur(r.kosten / r.leads) + " CPL" : "0 Leads"}</div></div>`).join("")}</div>`; }

    // Reaktion
    const ids = new Set(all.map((a) => a.id)); const ks = K().filter((k) => ids.has(k.anzeigeId));
    const buckets = ["Erscheinungstag", "1 Tag", "2 Tage", "3 Tage", "4–7 Tage", "8–14 Tage", "später"].map((k) => ({ k, v: 0 }));
    ks.forEach((k) => { const a = adById(k.anzeigeId); if (!a?.datum || !k.datum) return; const d = Math.round((Date.parse(k.datum) - Date.parse(a.datum)) / 864e5); buckets[d <= 0 ? 0 : d <= 3 ? d : d <= 7 ? 4 : d <= 14 ? 5 : 6].v++; });
    $("decay").innerHTML = barList(buckets, "Kontakte");
    $("kanaele").innerHTML = barList(KONTAKT_KANAELE.map((c) => ({ k: c, v: ks.filter((k) => k.kanal === c).length })).filter((r) => r.v || KANAELE.includes(r.k)), "Kontakte");

    // Tabelle
    const list = all.filter((a) => geschaltet(a) || adStats(a).kontakte).map((a) => ({ a, s: adStats(a) })).sort((x, y) => (x.s.cpl ?? Infinity) - (y.s.cpl ?? Infinity));
    $("perad").innerHTML = list.length ? `<div class="tablewrap"><table><thead><tr><th>Code</th><th>Motiv</th><th>Stadt · Datum</th><th>Viral · Ton</th><th class="num">Kosten</th><th class="num">Kontakte</th><th class="num">Leads</th><th class="num">CPL</th><th class="num">Erlös</th></tr></thead><tbody>${list.map(({ a, s }) => `<tr><td class="code">${esc(a.code)}${a.demo ? ` <span class="chip demo">Beispiel</span>` : ""}</td><td class="wrap">${esc(a.motiv?.headline || "—")}</td><td>${esc(stadtOf(a))}<div class="muted">${fmtDate(a.datum)}</div></td><td>${esc(a.viral || "Klassisch")}<div class="muted">${esc(a.ton || "—")}</div></td><td class="num">${eur(s.kosten)}</td><td class="num">${s.kontakte}</td><td class="num">${s.leads}</td><td class="num">${s.cpl == null ? "—" : eur(s.cpl)}</td><td class="num">${eur(s.erloes)}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty"><strong>Noch keine Anzeige erschienen</strong>Setze unter Anzeigen den Status auf „erschienen“, sobald eine Ausgabe verteilt ist.</div>`;
  }
  let progCache = [];
  function renderLearn(model) {
    const ads = A().filter((a) => geschaltet(a) && num(a.kosten) > 0); const C = ads.reduce((x, a) => x + num(a.kosten), 0); const L = ads.reduce((x, a) => x + adStats(a).leads, 0);
    const stufe = ads.length >= 30 ? 3 : ads.length >= 10 ? 2 : ads.length ? 1 : 0; const st = ["wartet auf erste Tests", "lernt erste Muster", "erkennt Muster", "belastbar"][stufe];
    $("learn").innerHTML = `<div class="learn-ic" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l5-5 4 4 8-8"/><path d="M15 8h5v5"/></svg></div>
      <div class="learn-txt"><strong>Lokalpilot wird mit jedem Test schlauer.</strong> Jede geschaltete Anzeige ist ein neuer Datenpunkt: Das Lern-Modell gewichtet Kategorie, Viral-Baustein, Ton, Stadt und Layout neu und schlägt vor, was als Nächstes getestet werden sollte. Wir entwickeln diesen Algorithmus laufend weiter, Ideen für Verbesserungen sind immer willkommen.</div>
      <div class="learn-stats"><div><b>${ads.length}</b><span>Anzeigen gelernt</span></div><div><b>${eur(C)}</b><span>Testbudget</span></div><div><b>${int(L)}</b><span>Leads</span></div><div><span class="steps">${[1, 2, 3].map((i) => `<i class="${i <= stufe ? "on" : ""}"></i>`).join("")}</span><span>Modell ${st}</span></div></div>`;
  }
  function renderPrognose(model) {
    renderLearn(model);
    if (!model) { $("prognose").innerHTML = `<p class="hint">Braucht erste Ergebnisse mit Kosten und Leads.</p>`; $("motivrank").innerHTML = `<p class="hint">Braucht erste Ergebnisse.</p>`; return; }
    const tested = new Set(A().filter(geschaltet).map((a) => [a.kategorie, a.viral || "Klassisch", stadtOf(a)].join("|")));
    const staedte = [...new Set(B().map((b) => b.stadt))];
    const virals = [...model.f.viral.keys()];
    const cand = [];
    for (const kat of [...new Set([...CORE_KATS, ...model.f.kategorie.keys()])].filter((k) => KAT_INFO[k])) for (const v of virals) for (const st of staedte) {
      if (tested.has([kat, v, st].join("|"))) continue;
      const p = predict(model, { kategorie: kat, viral: v, stadt: st });
      cand.push({ kat, v, st, ...p, score: p.rate * (1 + 0.25 * (1 - p.conf)) });
    }
    cand.sort((a, b) => b.score - a.score); progCache = cand.slice(0, 6);
    $("prognose").innerHTML = progCache.length ? `<div class="bars">${progCache.map((c, i) => `<div class="barrow"><div class="lbl"><b>${esc(c.kat)}</b> · ${esc(c.v)}<div class="muted">${esc(c.st)} · Sicherheit ${confLabel(c.conf)}</div></div><div class="track"><div class="fill${i === 0 ? " best" : ""}" style="width:${Math.max(4, (c.rate / progCache[0].rate) * 100)}%"></div></div><div class="val">≈ ${eur(c.cpl)} / Lead</div></div>`).join("")}</div><div class="btns" style="margin-top:12px"><button class="b small primary" id="prog-use">Top-Kombination als Kampagne vorbereiten</button></div>` : `<p class="hint">Alle Kombinationen sind schon getestet.</p>`;
    // Motive über/unter Erwartung
    const rank = model.units.filter((u) => u.a.motiv).map((u) => { const p = predict(model, { kategorie: u.a.kategorie, viral: u.a.viral || "Klassisch", ton: u.a.ton || "—", stadt: stadtOf(u.a), layout: u.a.layout || "A" }); const exp = p.rate * u.s.kosten; return { a: u.a, lift: exp ? u.s.leads / exp : 0, leads: u.s.leads }; }).filter((x) => x.leads >= 3).sort((a, b) => b.lift - a.lift).slice(0, 5);
    $("motivrank").innerHTML = rank.length ? `<div class="bars">${rank.map((r) => `<div class="barrow"><div class="lbl">${esc(r.a.motiv.headline || r.a.code)}<div class="muted">${esc(r.a.code)} · ${esc(stadtOf(r.a))}</div></div><div class="track"><div class="fill${r.lift >= 1.2 ? " best" : ""}" style="width:${Math.min(100, r.lift / 2 * 100)}%"></div></div><div class="val">${r.lift.toLocaleString("de-DE", { maximumFractionDigits: 2 })}×</div></div>`).join("")}</div><p class="hint" style="margin-top:10px">Über 1,2× = Motiv wirkt besser, als Kategorie, Stadt und Baustein erwarten lassen. Kandidat für andere Städte – ohne es dort erst testen zu müssen.</p>` : `<p class="hint">Braucht Motive mit mindestens 3 Leads.</p>`;
    const btn = $("prog-use"); if (btn) btn.onclick = () => { const c = progCache[0]; showTab("kampagnen"); $("kw-name").value = `Test ${c.st}: ${c.kat} · ${c.v}`; setChecks($("kw-kat"), [c.kat]); $("kw-viral").value = c.v; setChecks($("kw-blaetter"), B().filter((b) => b.stadt === c.st).map((b) => b.id)); $("kw-hinweis").value = `Vom Lern-Modell vorgeschlagen: erwartete Kosten pro Lead ca. ${Math.round(c.cpl)} €, Sicherheit ${confLabel(c.conf)}.`; $("kw-budget").focus(); };
  }

  // ================= Kampagnen =================
  const KSTATUS_CLASS = { "Entwurf": "", "Wartet auf Freigabe": "wartet", "Freigegeben": "freigegeben", "Läuft": "laeuft", "Beendet": "beendet" };
  function kampStats(k) { const ads = A().filter((a) => a.kampagneId === k.id); let kontakte = 0, leads = 0, erloes = 0; ads.forEach((a) => { const s = adStats(a); kontakte += s.kontakte; leads += s.leads; erloes += s.erloes; }); const c = costOf(ads, [k], false); return { ads, kosten: c.gesamt, c, kontakte, leads, erloes, cpl: leads ? c.gesamt / leads : null, geplant: ads.reduce((x, a) => x + num(a.kosten), 0) }; }
  function costBar(c) {
    const tot = c.gesamt || 1; const w = (v) => Math.max(v > 0 ? 1.5 : 0, v / tot * 100);
    return `<div class="kcost"><div class="kcbar" aria-hidden="true"><i class="z" style="width:${w(c.zeitung)}%"></i><i class="t" style="width:${w(c.kiText)}%"></i><i class="p" style="width:${w(c.kiBild)}%"></i></div><div class="kclegend"><span><i class="z"></i>Zeitung <b>${eur(c.zeitung)}</b></span><span><i class="t"></i>KI-Texte <b>${eur2(c.kiText)}</b> · ${int(c.tokens)} Tokens</span><span><i class="p"></i>KI-Bilder <b>${eur2(c.kiBild)}</b> · ${c.credits.toLocaleString("de-DE")} Credits</span></div></div>`;
  }
  // ZIP ohne Kompression (JPGs sind schon komprimiert)
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (u8) => { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  function makeZip(files) {
    const enc = new TextEncoder(); const parts = []; const central = []; let off = 0;
    for (const f of files) {
      const name = enc.encode(f.name); const crc = crc32(f.data); const sz = f.data.length;
      const h = new DataView(new ArrayBuffer(30)); h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint32(14, crc, true); h.setUint32(18, sz, true); h.setUint32(22, sz, true); h.setUint16(26, name.length, true);
      parts.push(new Uint8Array(h.buffer), name, f.data);
      const c = new DataView(new ArrayBuffer(46)); c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint32(16, crc, true); c.setUint32(20, sz, true); c.setUint32(24, sz, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
      central.push(new Uint8Array(c.buffer), name); off += 30 + name.length + sz;
    }
    const cdSize = central.reduce((x, p) => x + p.length, 0);
    const e = new DataView(new ArrayBuffer(22)); e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cdSize, true); e.setUint32(16, off, true);
    return new Blob([...parts, ...central, new Uint8Array(e.buffer)], { type: "application/zip" });
  }
  const slug = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "kampagne";
  async function bilderZip(k, btn) {
    const ads = A().filter((a) => a.kampagneId === k.id && a.motiv?.bildUrl).sort((x, y) => String(x.code).localeCompare(String(y.code)));
    if (!ads.length) { toast("Diese Kampagne hat noch keine Bilder."); return; }
    const alt = btn.textContent; btn.disabled = true; btn.textContent = `Lade 0/${ads.length} …`;
    try {
      const files = []; let i = 0;
      for (const a of ads) {
        const r = await fetch(a.motiv.bildUrl); if (!r.ok) throw new Error("bild");
        const type = r.headers.get("content-type") || ""; const ext = /png/.test(type) ? "png" : /webp/.test(type) ? "webp" : "jpg";
        files.push({ name: `${a.code}_${slug(a.motiv.headline)}.${ext}`, data: new Uint8Array(await r.arrayBuffer()) });
        btn.textContent = `Lade ${++i}/${ads.length} …`;
      }
      const blob = makeZip(files); const filename = `${slug(k.name)}_bilder.zip`;
      const dl = window.claude && typeof window.claude.use === "function" ? await window.claude.use("downloads").catch(() => null) : null;
      if (dl) { try { await dl.save({ filename, data: blob }); } catch (e) { if (e?.code !== "declined") toast("Herunterladen ist hier nicht möglich."); } }
      else { const url = URL.createObjectURL(blob); const el = document.createElement("a"); el.href = url; el.download = filename; document.body.appendChild(el); el.click(); el.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000); }
      toast(`${files.length} Bilder als ZIP bereit`);
    } catch (e) { toast("Bilder konnten nicht geladen werden."); }
    finally { btn.disabled = false; btn.textContent = alt; }
  }
  // Bild-Agent (nur in der Server-Version von Lokalpilot verfügbar)
  const bildServer = () => !!window.__lpServer;
  const braucheBild = (a) => !a.demo && a.motiv && !a.motiv.bildUrl;
  const BILD_FEHLER = { capability_disabled: "Higgsfield-Schlüssel fehlt in Vercel.", kein_guthaben: "Higgsfield-Guthaben ist leer – bitte aufladen.", rate_limited: "Higgsfield ist gerade ausgelastet, gleich nochmal.", bild_nsfw: "Higgsfield hat das Motiv abgelehnt – Bildidee anpassen.", timeout: "Das Bild braucht zu lange – bitte nochmal versuchen." };
  async function bildErzeugen(a) {
    const r = await fetch("/api/bild", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ anzeigeId: a.id, prompt: a.motiv.bildPrompt || bildPrompt(a.motiv, a) }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(BILD_FEHLER[j.code] || "Bild konnte nicht erzeugt werden.");
    return j.url;
  }
  async function bildButton(a, btn) {
    const alt = btn.textContent; btn.disabled = true; btn.textContent = "Bild entsteht … (ca. 1 Min.)";
    try { await bildErzeugen(a); toast(`Bild für ${a.code} fertig`); } catch (e) { toast(e.message); btn.disabled = false; btn.textContent = alt; }
  }
  async function bilderKampagne(k, btn) {
    const ads = S.anzeigen.filter((a) => a.kampagneId === k.id && braucheBild(a)); if (!ads.length) return;
    const alt = btn.textContent; btn.disabled = true; let ok = 0;
    for (const [i, a] of ads.entries()) { btn.textContent = `Bild ${i + 1}/${ads.length} entsteht …`; try { await bildErzeugen(a); ok++; } catch (e) { toast(e.message); if (/Schlüssel|Guthaben/.test(e.message)) break; } }
    toast(`${ok} von ${ads.length} Bildern erzeugt`); btn.disabled = false; btn.textContent = alt;
  }
  function renderKampagnen() {
    const el = $("k-kampagnen"); const list = KP().map((k) => ({ k, s: kampStats(k) }));
    if (!list.length) { el.innerHTML = `<div class="empty"><strong>Noch keine Kampagne</strong>Fülle links aus und klick auf „Kampagne erstellen“.</div>`; return; }
    if ($("k-sort").value === "cpl") list.sort((x, y) => (x.s.cpl ?? Infinity) - (y.s.cpl ?? Infinity)); else list.sort((x, y) => num(y.k.createdAt) - num(x.k.createdAt));
    el.innerHTML = `<div class="kcards">${list.map(({ k, s }) => {
      const st = new Set(s.ads.map(stadtOf)); const thumbs = s.ads.filter((a) => a.motiv?.bildUrl).slice(0, 9).map((a) => `<img src="${esc(a.motiv.bildUrl)}" alt="${esc(a.code)}" data-src="${esc(a.motiv.bildUrl)}" loading="lazy">`).join("");
      return `<article class="kcard" data-id="${esc(k.id)}"><div class="top"><div><h3>${esc(k.name)}</h3><div class="meta">${esc(k.marke || marke())} · ${[...st].map(esc).join(", ") || "—"} · ${k.von ? fmtDate(k.von) : "?"} – ${k.bis ? fmtDate(k.bis) : "?"}</div></div><div class="tags">${k.demo ? `<span class="chip demo">Beispiel</span>` : ""}<span class="chip ${KSTATUS_CLASS[k.status] || ""}">${esc(k.status || "Entwurf")}</span></div></div>
      <div class="tags">${(k.kategorien || []).map((c) => `<span class="chip plain">${esc(c)}</span>`).join("")}${k.viral ? `<span class="chip viral">${esc(k.viral)}</span>` : ""}${k.ton ? `<span class="chip ton">${esc(k.ton)}</span>` : ""}</div>
      <div class="kstats"><div><b>${s.ads.length}</b><span>Anzeigen</span></div><div><b>${eur2(s.c.gesamt)}</b><span>Kosten bisher${k.budget ? " · Budget " + eur(k.budget) : ""}</span></div><div><b>${s.kontakte}</b><span>Kontakte</span></div><div><b>${s.leads}</b><span>Leads</span></div><div><b>${s.cpl == null ? "—" : eur(s.cpl)}</b><span>Kosten pro Lead</span></div><div><b>${eur2(s.erloes - s.c.gesamt)}</b><span>Deckungsbeitrag</span></div></div>
      ${costBar(s.c)}
      ${thumbs ? `<div class="thumbs">${thumbs}</div>` : ""}${k.zusammenfassung ? `<p class="hint">${esc(k.zusammenfassung)}</p>` : ""}
      <div class="btns">${k.status === "Wartet auf Freigabe" ? `<button class="b small primary" data-act="kfrei">Freigeben</button>` : ""}${bildServer() && s.ads.some(braucheBild) ? `<button class="b small primary" data-act="kbild">Bilder erzeugen (${s.ads.filter(braucheBild).length})</button>` : ""}${thumbs ? `<button class="b small ghost" data-act="kzip">Alle Bilder herunterladen</button>` : ""}<button class="b small ghost" data-act="kads">Anzeigen ansehen</button><button class="b small ghost" data-act="kaus">Auswertung</button></div></article>`;
    }).join("")}</div>`;
  }
  $("k-sort").addEventListener("change", renderKampagnen);
  $("k-kampagnen").addEventListener("click", async (e) => {
    const img = e.target.closest("img[data-src]"); if (img) { openLightbox(img.dataset.src); return; }
    const btn = e.target.closest("button[data-act]"); if (!btn) return; const k = kampById(btn.closest("[data-id]").dataset.id); if (!k) return;
    if (btn.dataset.act === "kzip") { await bilderZip(k, btn); return; }
    if (btn.dataset.act === "kbild") { await bilderKampagne(k, btn); return; }
    if (btn.dataset.act === "kads") { $("ad-kampagne").value = k.id; showTab("anzeigen"); }
    if (btn.dataset.act === "kaus") { $("aw-kampagne").value = k.id; showTab("auswertung"); }
    if (btn.dataset.act === "kfrei") { const ok = await write(() => db.collection("kampagnen").doc(k.id).update({ status: "Freigegeben", freigegebenAm: Date.now() }), `${k.name} freigegeben`); if (ok) for (const a of S.anzeigen.filter((x) => x.kampagneId === k.id && x.status === "geplant")) await write(() => db.collection("anzeigen").doc(a.id).update({ status: "freigegeben" })); }
  });
  $("auto-form").addEventListener("submit", async (e) => { e.preventDefault(); await write(() => db.doc("einstellungen/allgemein").set({ ...S.settings, marke: $("s-marke").value.trim(), limit: $("s-limit").value === "" ? null : num($("s-limit").value), erloes: $("s-erloes").value === "" ? null : num($("s-erloes").value), kiPreise: { ...kiP(), inMTok: num($("s-kin").value) || KI_DEF.inMTok, outMTok: num($("s-kout").value) || KI_DEF.outMTok, creditEur: $("s-credit").value === "" ? KI_DEF.creditEur : num($("s-credit").value) }, metaCpm: $("s-metacpm").value === "" ? null : num($("s-metacpm").value) }), "Gespeichert"); });

  // Hausstil-Bildprompt nach Referenz-Doku
  function bildPrompt(m, ad) {
    const b = blattById(ad?.blattId); const stadt = b?.stadt || "Ihrer Region";
    const tel = ad?.trackingNummer || "0800 – 123 45 67"; const url = adLink(ad) || "modernisieren24.de";
    const lay = { A: "photo in the top half, then headline, sub line and three orange check bullets", B: "very large question headline on top, photo below with a round orange badge '100 % kostenlos'", C: "warm photo of a person on the phone, headline 'Ein Anruf. Drei Angebote.'", D: "flat graphic with three numbered steps 'Anrufen', 'Drei Angebote erhalten', 'In Ruhe vergleichen'", P: "parody of a German newspaper format (see idea), label 'ANZEIGE' top right" }[m.layout || "A"];
    return `Print newspaper advertisement, portrait 3:4, German direct-response layout for readers 50+, large bold sans-serif type, high contrast. Layout: ${lay}. Image idea: ${m.bildidee || "—"}. Wordmark '${marke()}' top left in navy #0B3D6E with '24' in orange #F28C28. Headline: '${m.headline}'. Sub line: '${m.unterzeile}'.${(m.bullets || []).length ? ` Bullets: ${m.bullets.map((x) => `'${x}'`).join(", ")}.` : ""} Full-width navy bottom bar with 'Jetzt anrufen:', very large '${tel}' and '${url}' in white. Region: ${stadt} und Umgebung. All German text spelled exactly as given, no other text.`;
  }
  function m24Mock(m, ad) {
    const lay = m.layout || ad?.layout || "A"; const cls = lay === "B" ? "B" : lay === "P" ? "P" : "A";
    const tel = ad?.trackingNummer || "0800 – 123 45 67"; const url = adLink(ad) || "modernisieren24.de";
    const mk = esc(marke()).replace(/24$/, "<i>24</i>");
    return `<div class="m24 ${cls}">${cls === "P" ? `<span class="tag">ANZEIGE</span>` : ""}<div class="ph">${cls !== "P" ? `<span class="wm">${mk}</span>` : ""}${cls === "B" ? `<span class="badge">100 %<br>kostenlos</span>` : ""}<span>${esc(m.bildidee || "Bild folgt")}</span></div><div class="tx"><p class="hl">${esc(m.headline)}</p><p class="sub">${esc(m.unterzeile || "")}</p>${cls === "A" && (m.bullets || []).length ? `<ul>${m.bullets.slice(0, 3).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}</div><div class="bar">${cls === "P" ? `<span class="wm">${mk}</span>` : ""}<small>${esc(m.cta || "Jetzt anrufen:")}</small><b>${esc(tel)}</b><span>${esc(url)}</span></div></div>`;
  }
  function adPreview(a) {
    const m = a.motiv; if (!m) return `<div class="nomotiv">Noch kein Motiv<br>${esc(a.kategorie)} · ${esc(a.viral || "Klassisch")}</div>`;
    if (m.bildUrl) return `<div class="adimg" data-src="${esc(m.bildUrl)}"><img src="${esc(m.bildUrl)}" alt="${esc(m.headline || "Anzeige")}" loading="lazy"></div>`;
    return m24Mock(m, a);
  }
  function erscheinungstermine(b, von, bis) { const out = []; const ti = TAG_IDX[b.tag]; if (ti == null) return out; for (let t = Date.parse(von); t <= Date.parse(bis); t += 864e5) { const d = new Date(t); if (d.getUTCDay() === ti) out.push(d.toISOString().slice(0, 10)); } return out; }
  function sampleErr(err) { const c = err && err.code; if (c === "cancelled") return "Abgebrochen."; if (["not_granted", "sampling_disabled", "not_declared", "capability_disabled"].includes(c)) return "Die KI ist für diese Ansicht nicht freigegeben" + (err.detail ? " (" + err.detail + ")" : "."); if (c === "rate_limited") return "Gerade zu viele Anfragen. Bitte in ein paar Minuten nochmal."; if (c === "invalid_json") return "Die Antwort der KI war unvollständig oder nicht lesbar" + (err.detail ? " (" + err.detail + ")" : "") + ". Bitte nochmal versuchen, ggf. mit kürzerem Zeitraum oder weniger Kategorien."; if (c === "refused") return "Die KI hat das abgelehnt. Hinweise anpassen."; return "Die KI war nicht erreichbar" + (err && err.detail ? ": " + err.detail : ". Bitte nochmal versuchen."); }
  const RULES = `Regeln für Texte: Deutsch, Sie-Form, Zielgruppe 50+, kurze Wörter. Headline höchstens 9 Wörter. Unterzeile nennt "3 Angebote" und die passenden Anbieter aus <Stadt> und Umgebung (siehe Kategorie, z. B. "Küchenstudios aus Peine und Umgebung"). Genau 3 kurze Häkchen (z. B. "Kostenlos & unverbindlich", "Fachbetriebe aus Ihrer Region", dritter je Kategorie). Keine erfundenen Zahlen, Fristen, Förderquoten, Preise, Testsiegel oder Kundenstimmen. Pflege: Humor nur liebevoll, nie auf Kosten der Betroffenen. Format-Parodien als ANZEIGE kennzeichnen. Keine Telefonnummern oder Links im Text.`;
  const viralText = VIRAL.map((v) => `${v.id}: ${v.d}`).join("\n");

  let kwCtl = null;
  const kwLog = (t) => { const l = $("kw-log"); l.hidden = false; l.insertAdjacentHTML("beforeend", `<div>${esc(t)}</div>`); };
  function nextCodeFactory() { const used = new Set(S.anzeigen.map((a) => a.code)); return (stadt, kat) => { const p = `${prefix(stadt)}-${KAT_KURZ[kat] || "XX"}-`; let i = 1; while (used.has(p + String(i).padStart(3, "0"))) i++; const c = p + String(i).padStart(3, "0"); used.add(c); return c; }; }
  $("kw-stop").addEventListener("click", () => kwCtl?.abort());
  $("kw-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!sample) { toast("Der Agent ist in dieser Ansicht nicht verfügbar."); return; }
    if (!db) { toast("Datenbank nicht verbunden."); return; }
    const blaetter = readChecks($("kw-blaetter")).map(blattById).filter(Boolean); const kats = readChecks($("kw-kat"));
    const von = $("kw-von").value, bis = $("kw-bis").value, budget = num($("kw-budget").value);
    if (!blaetter.length || !kats.length) { toast("Mindestens ein Blatt und eine Kategorie wählen."); return; }
    if (!von || !bis || bis < von) { toast("Zeitraum prüfen."); return; }
    if (!budget) { toast("Budget eintragen."); return; }
    const ton = $("kw-ton").value, viral = $("kw-viral").value, motive = $("kw-motive").value;
    const bl = blaetter.map((b) => ({ id: b.id, name: b.name, stadt: b.stadt, erscheint: b.tag, auflage: b.auflage, preise: b.preisInfo || "unbekannt", standardpreiseNetto: stdPreisListe(b), termine: erscheinungstermine(b, von, bis) }));
    if (!bl.some((b) => b.termine.length)) { toast("Im Zeitraum erscheint keines der Blätter."); return; }
    const bib = motive === "neu" ? [] : S.anzeigen.filter((a) => !a.demo && a.motiv && kats.includes(a.kategorie)).map((a) => ({ code: a.code, kategorie: a.kategorie, ton: a.ton, viral: a.viral, headline: a.motiv.headline, kontakte: adStats(a).kontakte, leads: adStats(a).leads }));
    const model = trainModel(A()); const prog = model ? bl.flatMap((b) => kats.map((k) => VIRAL.map((v) => ({ stadt: b.stadt, kategorie: k, viral: v.id, cplPrognose: Math.round(predict(model, { kategorie: k, viral: v.id, stadt: b.stadt }).cpl || 0) })))).flat().sort((x, y) => x.cplPrognose - y.cplPrognose).slice(0, 12) : [];
    const prompt = `Du bist der Kampagnen-Agent von Lokalpilot. Du planst Print-Anzeigen in kostenlosen Wochenblättern für die Marke ${marke()} (Vermittlung: Leser bekommen kostenlos 3 Angebote passender Anbieter aus der Region). Kategorien und Anbieter: ${katListe()}.
Kampagne: ${$("kw-name").value.trim()} · Kategorien: ${kats.join(", ")} · Ton: ${ton} · Viral-Baustein: ${viral} · Zeitraum ${von} bis ${bis} · Budget gesamt netto ${budget} € · Motive: ${motive === "alt" ? "nur vorhandene wiederverwenden" : motive === "neu" ? "nur neue texten" : "vorhandene wiederverwenden, wo passend, sonst neue texten"}.
Hinweise: ${$("kw-hinweis").value.trim() || "keine"}
Blätter mit Erscheinungsterminen (nur diese Termine, je Blatt und Termin höchstens eine Anzeige): ${JSON.stringify(bl)}
Vorhandene Motive: ${JSON.stringify(bib).slice(0, 30000)}
Lern-Modell, geschätzte Kosten pro Lead der besten Kombinationen: ${JSON.stringify(prog)}
Viral-Bausteine:
${viralText}
Layouts: A Foto + 3 Häkchen, B Frage + Badge, C Ein Anruf. Drei Angebote., D 3 Schritte, P Format-Parodie.
${RULES}
Kosten je Schaltung aus den Preisangaben ableiten, sonst realistisch schätzen (1/4 Seite im Anzeigenblatt ca. 350-900 €) und kostenGeschaetzt=true. Summe <= Budget. Wiederholung ist im Print wichtig. Wenn "Mix testen" gewählt ist, Töne/Bausteine bewusst variieren, damit das Lern-Modell vergleichen kann.
Antworte nur mit JSON: {"zusammenfassung":"2 Sätze","platzierungen":[{"blattId":"...","datum":"YYYY-MM-DD","kategorie":"...","motivCode":"Code oder null","neu":{"headline":"...","unterzeile":"...","bullets":["...","...","..."],"cta":"Jetzt anrufen:","layout":"A","ton":"...","viral":"...","bildidee":"1 Satz Bildmotiv (Englisch oder Deutsch), ohne Text im Bild"},"kosten":0,"kostenGeschaetzt":true,"begruendung":"1 Satz"}]}  (neu nur, wenn motivCode null ist)`;
    kwCtl = new AbortController(); $("kw-go").disabled = true; $("kw-stop").hidden = false; $("kw-log").innerHTML = "";
    kwLog("Lese Blätter, Termine, Motive und Lern-Modell …");
    try {
      kwLog("Agent plant die Kampagne …");
      const res = await sample.json(prompt, { signal: kwCtl.signal, cache: false }); const kiLauf = { art: "Kampagnen-Agent", ...realTok(prompt, res), am: todayISO() };
      const terms = new Map(bl.map((b) => [b.id, new Set(b.termine)])); const seen = new Set();
      const pl = (Array.isArray(res?.platzierungen) ? res.platzierungen : []).filter((x) => x && terms.get(String(x.blattId))?.has(String(x.datum)) && kats.includes(x.kategorie)).filter((x) => { const k = x.blattId + x.datum; if (seen.has(k)) return false; seen.add(k); return true; }).sort((x, y) => String(x.datum).localeCompare(String(y.datum)));
      if (!pl.length) throw { code: "invalid_json" };
      const total = pl.reduce((s, x) => s + Math.max(0, num(x.kosten)), 0);
      const limit = S.settings.limit == null || S.settings.limit === "" ? null : num(S.settings.limit); const auto = limit != null && total <= limit;
      kwLog(`${pl.length} Schaltungen geplant, ${eur(total)} von ${eur(budget)}.`);
      const kref = await db.collection("kampagnen").add({ name: $("kw-name").value.trim(), marke: marke(), kategorien: kats, ton, viral, von, bis, budget, blaetter: blaetter.map((b) => b.id), zusammenfassung: String(res.zusammenfassung || ""), planKosten: total, status: auto ? "Freigegeben" : "Wartet auf Freigabe", erstelltVon: "Kampagnen-Agent", kiKosten: [kiLauf], createdAt: Date.now(), ...(auto ? { freigegebenAm: Date.now() } : {}) });
      kwLog("Kampagne angelegt. Lege Anzeigen mit Tracking-Codes an …");
      const code = nextCodeFactory(); let n = 0;
      for (const x of pl) {
        const b = blattById(x.blattId); const src = x.motivCode ? S.anzeigen.find((a) => a.code === x.motivCode && a.motiv) : null; const nu = x.neu || {};
        const body = { code: code(b.stadt, x.kategorie), kampagneId: kref.id, blattId: x.blattId, kategorie: x.kategorie, botschaft: src?.botschaft || "Emotion", ton: src?.ton || nu.ton || (ton === "Mix testen" ? "Humor" : ton), viral: src?.viral || nu.viral || (viral === "Agent wählt" ? "Klassisch" : viral), layout: src?.layout || nu.layout || "A", format: "q-hoch", kontaktwege: ["Telefon", "URL", "QR-Code"], datum: String(x.datum), kosten: Math.max(0, num(x.kosten)) || stdPreis(blattById(x.blattId), "q-hoch") || 0, kostenGeschaetzt: num(x.kosten) > 0 ? !!x.kostenGeschaetzt : !stdPreis(blattById(x.blattId), "q-hoch"), status: auto ? "freigegeben" : "geplant", trackingNummer: "", marke: marke(), notiz: "Kampagnen-Agent: " + String(x.begruendung || ""), createdAt: Date.now() };
        if (src) body.motiv = { ...src.motiv, vonAnzeige: src.code };
        else if (nu.headline) { body.motiv = { typ: "entwurf", headline: String(nu.headline), unterzeile: String(nu.unterzeile || ""), bullets: (Array.isArray(nu.bullets) ? nu.bullets : []).slice(0, 3).map(String), cta: String(nu.cta || "Jetzt anrufen:"), layout: body.layout, bildidee: String(nu.bildidee || "") }; body.motiv.bildPrompt = bildPrompt(body.motiv, body); }
        await db.collection("anzeigen").add(body); n++;
      }
      kwLog(`${n} Anzeigen angelegt. ${auto ? "Automatisch freigegeben (unter Limit)." : limit == null ? "Kein Limit gesetzt: wartet auf eure Freigabe." : "Über Limit: wartet auf eure Freigabe."}`);
      toast(`Kampagne erstellt: ${n} Anzeigen`);
    } catch (err) { kwLog(err?.code ? sampleErr(err) : "Speichern fehlgeschlagen."); }
    finally { $("kw-go").disabled = false; $("kw-stop").hidden = true; }
  });

  // ================= KI-Studio (ein Klick) =================
  let stCtl = null;
  $("st-stop").addEventListener("click", () => stCtl?.abort());
  $("st-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!sample) { $("st-status").textContent = "Die KI ist in dieser Ansicht nicht verfügbar."; return; }
    if (!db) { toast("Datenbank nicht verbunden."); return; }
    const b = blattById($("st-blatt").value); if (!b) { toast("Bitte ein Blatt wählen."); return; }
    const kat = $("st-kategorie").value, ton = $("st-ton").value, viral = $("st-viral").value, layout = $("st-layout").value, nAnz = num($("st-anzahl").value) || 3;
    const prompt = `Du textest Print-Anzeigen für kostenlose Wochenblätter für die Marke ${marke()} (Vermittlung: 3 kostenlose Angebote passender Anbieter aus der Region). Anbieter für diese Kategorie: ${KAT_INFO[kat]?.anbieter || "Fachbetriebe"}.
Stadt: ${b.stadt} · Kategorie: ${kat} · Ton: ${ton} · Viral-Baustein: ${viral}${layout !== "auto" ? ` · Layout: ${layout}` : ""}.
Idee/Figur: ${$("st-hinweis").value.trim() || "frei"}
Viral-Bausteine:
${viralText}
Layouts: A Foto + 3 Häkchen, B Frage + Badge, C Ein Anruf. Drei Angebote., D 3 Schritte, P Format-Parodie.
${RULES}
Schreibe ${nAnz} deutlich unterschiedliche Anzeigen. Antworte nur mit einem JSON-Array: [{"name":"2-3 Wörter","headline":"...","unterzeile":"...","bullets":["...","...","..."],"cta":"Jetzt anrufen:","layout":"A|B|C|D|P","bildidee":"1 Satz Bildmotiv, ohne Text im Bild"}]`;
    stCtl = new AbortController(); $("st-go").disabled = true; $("st-stop").hidden = false; $("st-status").innerHTML = `<span class="thinking">Die KI textet und legt die Anzeigen an …</span>`;
    try {
      const res = await sample.json(prompt, { signal: stCtl.signal, cache: false }); const stT = realTok(prompt, res), stTin = stT.tin, stTout = stT.tout;
      const arr = (Array.isArray(res) ? res : []).filter((v) => v && v.headline).slice(0, nAnz); if (!arr.length) throw { code: "invalid_json" };
      const code = nextCodeFactory(); const made = []; const nArr = Math.max(1, (Array.isArray(res) ? res : []).filter((v) => v && v.headline).slice(0, nAnz).length);
      for (const v of arr) {
        const lay = ["A", "B", "C", "D", "P"].includes(v.layout) ? v.layout : layout !== "auto" ? layout : "A";
        const body = { code: code(b.stadt, kat), kampagneId: $("st-kampagne").value || "", blattId: b.id, kategorie: kat, botschaft: "Emotion", ton, viral, layout: lay, format: "q-hoch", kontaktwege: ["Telefon", "URL", "QR-Code"], datum: "", kosten: null, status: "geplant", trackingNummer: "", marke: marke(), notiz: "KI-Studio: " + String(v.name || ""), kiKosten: [{ art: "KI-Studio", tin: Math.round(stTin / nArr), tout: Math.round(stTout / nArr), am: todayISO() }], createdAt: Date.now() };
        body.motiv = { typ: "entwurf", name: String(v.name || ""), headline: String(v.headline), unterzeile: String(v.unterzeile || ""), bullets: (Array.isArray(v.bullets) ? v.bullets : []).slice(0, 3).map(String), cta: String(v.cta || "Jetzt anrufen:"), layout: lay, bildidee: String(v.bildidee || "") };
        body.motiv.bildPrompt = bildPrompt(body.motiv, body);
        const ref = await db.collection("anzeigen").add(body); made.push(ref.id);
      }
      lastStudio = made; renderStudio(); $("st-status").textContent = `${made.length} Anzeigen angelegt. Texte vor dem Druck gegenlesen.`;
    } catch (err) { $("st-status").textContent = err?.code ? sampleErr(err) : "Speichern fehlgeschlagen."; }
    finally { $("st-go").disabled = false; $("st-stop").hidden = true; }
  });
  function renderStudio() {
    const list = (lastStudio.length ? lastStudio.map(adById).filter(Boolean) : S.anzeigen.filter((a) => !a.demo && a.motiv?.typ === "entwurf").sort((x, y) => num(y.createdAt) - num(x.createdAt)).slice(0, 6));
    $("st-out").innerHTML = list.length ? `<div class="variants">${list.map((a) => `<div class="variant" data-id="${esc(a.id)}"><div class="vname">${esc(a.code)} · ${esc(a.viral || "Klassisch")}</div>${adPreview(a)}<div class="vmeta"><div><b>Bild-Prompt</b></div><div class="prompt">${esc(a.motiv.bildPrompt || bildPrompt(a.motiv, a))}</div></div><div class="btns">${bildServer() && braucheBild(a) ? `<button class="b small primary" data-act="bild">Bild erzeugen</button>` : ""}<button class="b small ghost" data-act="copy">Prompt kopieren</button><button class="b small ghost" data-act="open">In Anzeigen</button></div></div>`).join("")}</div>` : `<div class="empty"><strong>Noch nichts erstellt</strong>Links Blatt, Kategorie, Ton und Viral-Baustein wählen und auf „Anzeigen erstellen“ klicken. Die Anzeigen landen direkt in Lokalpilot.</div>`;
  }
  $("st-out").addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-act]"); if (!btn) return; const a = adById(btn.closest("[data-id]").dataset.id); if (!a) return;
    if (btn.dataset.act === "copy") { try { await navigator.clipboard.writeText(a.motiv.bildPrompt || bildPrompt(a.motiv, a)); toast("Prompt kopiert"); } catch (err) { toast("Kopieren nicht möglich – Text markieren."); } }
    if (btn.dataset.act === "open") { $("ad-kampagne").value = a.kampagneId || ""; showTab("anzeigen"); }
    if (btn.dataset.act === "bild") await bildButton(a, btn);
  });

  // ================= Anzeigen =================
  function fillSelects() {
    const keep = (sel, html) => { const v = sel.value; sel.innerHTML = html; if ([...sel.options].some((o) => o.value === v)) sel.value = v; };
    const bOpts = B().map((b) => ({ value: b.id, label: `${b.name} (${b.stadt})` }));
    keep($("a-blatt"), bOpts.length ? options(bOpts) : `<option value="">Zuerst ein Blatt anlegen</option>`);
    keep($("st-blatt"), bOpts.length ? options(bOpts) : `<option value="">Zuerst ein Blatt anlegen</option>`);
    const kOpts = KP().slice().sort((x, y) => num(y.createdAt) - num(x.createdAt)).map((k) => ({ value: k.id, label: k.name + (k.demo ? " (Beispiel)" : "") }));
    keep($("aw-kampagne"), `<option value="">Alle Kampagnen</option>` + options(kOpts));
    keep($("ad-kampagne"), `<option value="">Alle Kampagnen</option>` + options(kOpts));
    keep($("a-kampagne"), `<option value="">— ohne Kampagne —</option>` + options(kOpts.filter((o) => !kampById(o.value)?.demo)));
    { const echt = kOpts.filter((o) => !kampById(o.value)?.demo), demo = kOpts.filter((o) => kampById(o.value)?.demo);
      keep($("st-kampagne"), `<option value="">— ohne Kampagne —</option>` + (echt.length ? `<optgroup label="Eure Kampagnen">${options(echt)}</optgroup>` : "") + (demo.length ? `<optgroup label="Beispiele (nur Ansicht, nicht bearbeitbar)">${demo.map((o) => `<option value="${esc(o.value)}" disabled>${esc(o.label)}</option>`).join("")}</optgroup>` : "")); }
    const adOpts = A().filter((a) => !a.demo).sort((x, y) => String(y.datum).localeCompare(String(x.datum))).map((a) => ({ value: a.id, label: `${a.code} · ${blattById(a.blattId)?.name || "?"} · ${fmtDate(a.datum)}` }));
    keep($("k-anzeige"), adOpts.length ? options(adOpts) : `<option value="">Noch keine Anzeigen</option>`);
    const box = $("kw-blaetter"); const sel = readChecks(box); const fresh = !box.dataset.init;
    box.innerHTML = B().filter((b) => !b.demo).length ? checks("kwb", B().filter((b) => !b.demo).map((b) => ({ value: b.id, label: b.name })), fresh ? B().filter((b) => !b.demo).map((b) => b.id) : sel) : `<span class="hint">Zuerst Wochenblätter anlegen.</span>`;
    if (B().length) box.dataset.init = "1";
  }
  function nextCode(blatt, kat) { return nextCodeFactory()(blatt.stadt, kat); }
  function updateKostenHint() { const sp = stdPreis(blattById($("a-blatt").value), $("a-format").value); $("a-kosten").placeholder = sp ? `leer = Standardpreis ${eur(sp)}` : ""; }
  ["a-blatt", "a-format"].forEach((id) => document.getElementById(id)?.addEventListener("change", () => updateKostenHint()));
  function updateCodeHint() { updateKostenHint(); if (editingAd) { const a = adById(editingAd); $("a-codehint").innerHTML = a ? `Code <span class="code">${esc(a.code)}</span> bleibt gleich.` : ""; return; } const b = blattById($("a-blatt").value); $("a-codehint").innerHTML = b ? `Neuer Code: <span class="code">${esc(nextCode(b, $("a-kategorie").value))}</span>` : ""; }
  function renderAds() {
    const f = $("ad-filter").value, kf = $("ad-kampagne").value;
    const list = A().filter((a) => (!f || a.status === f) && (!kf || a.kampagneId === kf)).sort((x, y) => (!!x.demo - !!y.demo) || String(y.datum || "9").localeCompare(String(x.datum || "9")) || String(x.code).localeCompare(String(y.code)));
    if (!A().length) { $("ad-list").innerHTML = `<div class="empty"><strong>Noch keine Anzeigen</strong>Am schnellsten über „Neue Kampagne“ oder das KI-Studio.</div>`; return; }
    if (!list.length) { $("ad-list").innerHTML = `<div class="empty">Keine Anzeigen für diesen Filter.</div>`; return; }
    if (adView === "vorschau") {
      $("ad-list").innerHTML = `<div class="gallery">${list.map((a) => { const s = adStats(a); const b = blattById(a.blattId); const facts = [a.kategorie, a.viral && a.viral !== "Klassisch" ? a.viral : "", a.ton].filter(Boolean).map(esc).join(" · ");
        const stat = geschaltet(a) ? `<div class="adstat"><span><b>${s.kontakte}</b>Kontakte</span><span><b>${s.leads}</b>Leads</span>${s.cpl == null ? "" : `<span><b>${eur(s.cpl)}</b>/ Lead</span>`}</div>` : `<div class="adstat"><span>${a.kosten ? `<b>${eur(a.kosten)}</b>geplant` : "Kosten offen"}</span></div>`;
        const btns = a.demo ? "" : `<div class="btns">${a.motiv && !a.motiv.bildUrl && assets ? `<label class="b small ghost filebtn">Bild hochladen<input type="file" accept="image/jpeg,image/png,image/webp" data-act="upload"></label>` : ""}${bildServer() && braucheBild(a) ? `<button class="b small ghost" data-act="bild">Bild erzeugen</button>` : ""}<button class="b small ghost" data-act="edit">Bearbeiten</button></div>`;
        return `<div class="adcard" data-id="${esc(a.id)}"><div class="shot">${adPreview(a)}</div><div class="body"><div class="row1"><span class="code">${esc(a.code)}${a.demo ? ` · Beispiel` : ""}</span><span class="st ${esc(a.status)}">${esc(a.status)}</span></div>${a.motiv?.headline ? `<div class="hl">${esc(a.motiv.headline)}</div>` : ""}<div class="facts">${esc(b?.stadt || "—")} · ${a.datum ? fmtDate(a.datum) : "Termin offen"}<br>${facts}</div><div class="foot">${stat}${btns}</div></div></div>`; }).join("")}</div>`;
      return;
    }
    $("ad-list").innerHTML = `<div class="tablewrap"><table><thead><tr><th>Code</th><th>Erscheint</th><th>Blatt</th><th>Motiv</th><th>Viral · Ton</th><th>Tracking</th><th class="num">Kosten</th><th class="num">Kont. / Leads</th><th>Status</th><th></th></tr></thead><tbody>${list.map((a) => { const s = adStats(a); const link = adLink(a); return `<tr data-id="${esc(a.id)}"><td class="code">${esc(a.code)}${a.demo ? ` <span class="chip demo">Beispiel</span>` : ""}</td><td>${fmtDate(a.datum)}</td><td class="wrap">${esc(blattById(a.blattId)?.name || "—")}</td><td class="wrap">${esc(a.motiv?.headline || "—")}</td><td>${esc(a.viral || "Klassisch")}<div class="muted">${esc(a.ton || "—")} · Layout ${esc(a.layout || "A")}</div></td><td class="wrap"><div>${esc((a.kontaktwege || []).join(", ") || "—")}</div><div class="muted">${a.trackingNummer ? "☎ " + esc(a.trackingNummer) : "Nummer fehlt"}${link ? "<br>" + esc(link) : ""}</div></td><td class="num">${a.kosten != null && a.kosten !== "" ? eur(a.kosten, 2) : "—"}</td><td class="num">${s.kontakte} / ${s.leads}</td><td>${a.demo ? `<span class="chip ${esc(a.status)}">${esc(a.status)}</span>` : `<select class="status" data-act="status" aria-label="Status ${esc(a.code)}">${options(STATUS, a.status)}</select>`}</td><td>${a.demo ? "" : `<div class="btns"><button class="b small ghost" data-act="edit">Bearbeiten</button><button class="b small danger" data-act="del">Löschen</button></div>`}</td></tr>`; }).join("")}</tbody></table></div>`;
  }
  function resetAdForm() { editingAd = null; $("ad-form").reset(); $("ad-form-title").textContent = "Neue Anzeige"; $("a-save").textContent = "Anzeige anlegen"; $("a-cancel").hidden = true; $("a-status").value = "geplant"; $("a-format").value = "q-hoch"; $("a-ton").value = "Humor"; $("a-viral").value = "Klassisch"; $("a-layout").value = "A"; setChecks($("a-kontaktwege"), ["Telefon", "URL"]); fillSelects(); updateCodeHint(); }
  function editAd(a) {
    if (adView === "vorschau") setAdView("liste");
    editingAd = a.id; $("ad-form-title").textContent = `Anzeige ${a.code} bearbeiten`; $("a-save").textContent = "Änderungen speichern"; $("a-cancel").hidden = false;
    $("a-kampagne").value = a.kampagneId || ""; $("a-blatt").value = a.blattId || ""; $("a-kategorie").value = a.kategorie; $("a-botschaft").value = a.botschaft || BOTSCHAFTEN[2]; $("a-ton").value = a.ton || "Seriös"; $("a-viral").value = a.viral || "Klassisch"; $("a-layout").value = a.layout || "A"; $("a-format").value = a.format || "q-hoch";
    setChecks($("a-kontaktwege"), a.kontaktwege); $("a-datum").value = a.datum || ""; $("a-kosten").value = a.kosten ?? ""; $("a-status").value = a.status; $("a-nummer").value = a.trackingNummer || ""; $("a-notiz").value = a.notiz || ""; updateCodeHint(); $("ad-form").scrollIntoView({ behavior: "smooth", block: "start" });
  }
  $("ad-form").addEventListener("submit", async (e) => {
    e.preventDefault(); const blatt = blattById($("a-blatt").value); if (!blatt) { toast("Bitte ein Blatt wählen."); return; }
    const body = { kampagneId: $("a-kampagne").value, blattId: blatt.id, kategorie: $("a-kategorie").value, botschaft: $("a-botschaft").value, ton: $("a-ton").value, viral: $("a-viral").value, layout: $("a-layout").value, format: $("a-format").value, kontaktwege: readChecks($("a-kontaktwege")), datum: $("a-datum").value || "", kosten: $("a-kosten").value === "" ? (stdPreis(blatt, $("a-format").value) || null) : num($("a-kosten").value), status: $("a-status").value, trackingNummer: $("a-nummer").value.trim(), notiz: $("a-notiz").value.trim() };
    if (editingAd) { if (await write(() => db.collection("anzeigen").doc(editingAd).update(body), "Anzeige gespeichert")) resetAdForm(); }
    else { const code = nextCode(blatt, body.kategorie); if (await write(() => db.collection("anzeigen").add({ ...body, code, marke: marke(), createdAt: Date.now() }), `Anzeige ${code} angelegt`)) resetAdForm(); }
  });
  $("a-cancel").addEventListener("click", resetAdForm);
  $("a-blatt").addEventListener("change", updateCodeHint); $("a-kategorie").addEventListener("change", updateCodeHint);
  $("ad-list").addEventListener("change", async (e) => {
    const up = e.target.closest("input[data-act=upload]");
    if (up) { const file = up.files && up.files[0]; const a = adById(up.closest("[data-id]").dataset.id); if (!file || !a || !assets) return; toast("Bild wird hochgeladen …"); try { const r = await assets.upload(file); await write(() => db.collection("anzeigen").doc(a.id).update({ motiv: { ...(a.motiv || {}), typ: "bild", bildUrl: r.url, bildAssetId: r.id } }), `Bild für ${a.code} gespeichert`); } catch (err) { toast("Hochladen fehlgeschlagen. JPG oder PNG bis 20 MB."); } return; }
    const sel = e.target.closest("select[data-act=status]"); if (!sel) return; const id = sel.closest("[data-id]").dataset.id; await write(() => db.collection("anzeigen").doc(id).update({ status: sel.value }), "Status geändert");
  });
  $("ad-list").addEventListener("click", (e) => {
    const im = e.target.closest(".adimg"); if (im) { openLightbox(im.dataset.src); return; }
    const btn = e.target.closest("button[data-act]"); if (!btn) return; const a = adById(btn.closest("[data-id]").dataset.id); if (!a) return;
    if (btn.dataset.act === "edit") editAd(a);
    if (btn.dataset.act === "bild") bildButton(a, btn);
    if (btn.dataset.act === "del") armDelete(btn, () => write(() => db.collection("anzeigen").doc(a.id).delete(), `Anzeige ${a.code} gelöscht`));
  });
  function setAdView(v) { adView = v; $("v-anzeigen").querySelector(".split").classList.toggle("full", v === "vorschau"); $("vt-neu").hidden = v !== "vorschau"; $("vt-vorschau").setAttribute("aria-pressed", String(v === "vorschau")); $("vt-liste").setAttribute("aria-pressed", String(v === "liste")); lsSet("lp-adview", v); renderAds(); }
  $("vt-vorschau").addEventListener("click", () => setAdView("vorschau")); $("vt-liste").addEventListener("click", () => setAdView("liste"));
  $("vt-neu").addEventListener("click", () => { setAdView("liste"); resetAdForm(); });
  $("ad-filter").addEventListener("change", renderAds); $("ad-kampagne").addEventListener("change", renderAds);
  $("set-form").addEventListener("submit", async (e) => { e.preventDefault(); await write(() => db.doc("einstellungen/allgemein").set({ ...S.settings, basisUrl: $("s-url").value.trim(), waNummer: $("s-wa").value.trim() }), "Gespeichert"); });

  // ================= Kontakte =================
  function renderKontakte() {
    const all = K(); const list = all.slice().sort((x, y) => String(y.datum).localeCompare(String(x.datum))).slice(0, 120); const q = all.filter((k) => k.qualifiziert).length;
    $("k-sum").textContent = all.length ? `${int(all.length)} Kontakte, davon ${int(q)} qualifiziert` : "";
    if (!list.length) { $("k-list").innerHTML = `<div class="empty"><strong>Noch keine Kontakte</strong>Wenn auf eine Anzeige jemand anruft, schreibt oder den QR-Code nutzt, trage es links ein.</div>`; return; }
    $("k-list").innerHTML = `<div class="tablewrap"><table><thead><tr><th>Datum</th><th>Anzeige</th><th>Kanal</th><th>Kategorie</th><th>Lead</th><th class="num">Erlös</th><th></th></tr></thead><tbody>${list.map((k) => `<tr data-id="${esc(k.id)}"><td>${fmtDate(k.datum)}</td><td class="code">${esc(k.code || adById(k.anzeigeId)?.code || "—")}${k.demo ? ` <span class="chip demo">Beispiel</span>` : ""}</td><td>${esc(k.kanal)}</td><td>${esc(k.kategorie || "—")}</td><td>${k.qualifiziert ? `<span class="chip erschienen">ja</span>` : `<span class="chip">nein</span>`}</td><td class="num">${k.erloes ? eur(k.erloes, 2) : "—"}</td><td>${k.demo ? "" : `<button class="b small danger" data-act="kdel">Löschen</button>`}</td></tr>`).join("")}</tbody></table></div>`;
  }
  $("k-form").addEventListener("submit", async (e) => {
    e.preventDefault(); const a = adById($("k-anzeige").value); if (!a) { toast("Bitte eine Anzeige wählen."); return; }
    const body = { anzeigeId: a.id, code: a.code, kategorie: a.kategorie, kanal: $("k-kanal").value, datum: $("k-datum").value || todayISO(), plz: $("k-plz").value.trim(), qualifiziert: $("k-quali").checked, einwilligung: $("k-einw").checked, erloes: $("k-erloes").value === "" ? 0 : num($("k-erloes").value), notiz: $("k-notiz").value.trim(), createdAt: Date.now() };
    if (await write(() => db.collection("kontakte").add(body), `Kontakt zu ${a.code} gespeichert`)) { const ka = $("k-anzeige").value, kk = $("k-kanal").value; $("k-form").reset(); $("k-anzeige").value = ka; $("k-kanal").value = kk; $("k-datum").value = todayISO(); }
  });
  $("k-list").addEventListener("click", (e) => { const btn = e.target.closest("button[data-act=kdel]"); if (!btn) return; const id = btn.closest("tr").dataset.id; armDelete(btn, () => write(() => db.collection("kontakte").doc(id).delete(), "Kontakt gelöscht")); });

  // ================= Blätter =================
  function renderBlaetter() {
    const list = B(); if (!list.length) { $("b-list").innerHTML = `<div class="empty"><strong>Noch keine Wochenblätter</strong>Trage links das erste Blatt ein.</div>`; return; }
    $("b-list").innerHTML = `<div class="blattcards">${list.slice().sort((x, y) => String(x.stadt).localeCompare(String(y.stadt))).map((b) => { const n = A().filter((a) => a.blattId === b.id).length; return `<article class="blatt" data-id="${esc(b.id)}"><div class="tags">${b.demo ? `<span class="chip demo">Beispiel</span>` : ""}<span class="chip plain">${esc(b.stadt)}</span></div><h3>${esc(b.name)}</h3><dl><dt>Erscheint</dt><dd>${esc(b.tag || "—")}</dd><dt>Auflage</dt><dd>${b.auflage ? int(b.auflage) : "—"}</dd><dt>Verlag</dt><dd>${esc(b.verlag || "—")}</dd><dt>Preise</dt><dd>${esc(b.preisInfo || "—")}</dd><dt>Schluss</dt><dd>${esc(b.anzeigenschluss || "—")}</dd><dt>Kontakt</dt><dd>${/^https?:\/\//.test(b.kontakt || "") ? `<a href="${esc(b.kontakt)}" target="_blank" rel="noopener">Mediadaten</a>` : esc(b.kontakt || "—")}</dd><dt>Anzeigen</dt><dd>${n}</dd></dl>${b.notiz ? `<p class="hint">${esc(b.notiz)}</p>` : ""}${b.demo ? "" : `<div class="btns"><button class="b small ghost" data-act="bedit">Bearbeiten</button><button class="b small danger" data-act="bdel">Löschen</button></div>`}</article>`; }).join("")}</div>`;
  }
  function resetBlattForm() { editingBlatt = null; $("b-form").reset(); $("b-form-title").textContent = "Blatt hinzufügen"; $("b-cancel").hidden = true; }
  $("b-form").addEventListener("submit", async (e) => {
    e.preventDefault(); const tag = $("b-tag").value;
    const body = { name: $("b-name").value.trim(), stadt: $("b-stadt").value.trim(), tag: tag === "—" ? "" : tag, verlag: $("b-verlag").value.trim(), auflage: $("b-auflage").value === "" ? null : num($("b-auflage").value), anzeigenschluss: $("b-schluss").value.trim(), preisInfo: $("b-preis").value.trim(), kontakt: $("b-kontakt").value.trim(), notiz: $("b-notiz").value.trim() };
    if (!body.name || !body.stadt) return;
    if (editingBlatt ? await write(() => db.collection("blaetter").doc(editingBlatt).update(body), "Blatt gespeichert") : await write(() => db.collection("blaetter").add({ ...body, createdAt: Date.now() }), `${body.name} angelegt`)) resetBlattForm();
  });
  $("b-cancel").addEventListener("click", resetBlattForm);
  $("b-list").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-act]"); if (!btn) return; const b = blattById(btn.closest("article").dataset.id); if (!b) return;
    if (btn.dataset.act === "bedit") { editingBlatt = b.id; $("b-form-title").textContent = `${b.name} bearbeiten`; $("b-cancel").hidden = false; $("b-name").value = b.name || ""; $("b-stadt").value = b.stadt || ""; $("b-tag").value = b.tag || "—"; $("b-verlag").value = b.verlag || ""; $("b-auflage").value = b.auflage ?? ""; $("b-schluss").value = b.anzeigenschluss || ""; $("b-preis").value = b.preisInfo || ""; $("b-kontakt").value = b.kontakt || ""; $("b-notiz").value = b.notiz || ""; }
    if (btn.dataset.act === "bdel") { if (S.anzeigen.some((a) => a.blattId === b.id)) { toast("Dieses Blatt hat noch Anzeigen."); return; } armDelete(btn, () => write(() => db.collection("blaetter").doc(b.id).delete(), `${b.name} gelöscht`)); }
  });

  // ================= Nächste Testrunde =================
  let suggCtl = null;
  $("btn-suggest-stop").addEventListener("click", () => suggCtl?.abort());
  $("btn-suggest").addEventListener("click", async () => {
    if (!sample) { $("suggest-status").textContent = "Die KI ist in dieser Ansicht nicht verfügbar."; return; }
    const blaetter = B().filter((b) => !b.demo); if (!blaetter.length) { $("suggest-status").textContent = "Zuerst ein echtes Blatt anlegen."; return; }
    const model = trainModel(A());
    const ads = A().map((a) => { const s = adStats(a); return { code: a.code, stadt: stadtOf(a), status: a.status, kategorie: a.kategorie, ton: a.ton, viral: a.viral, layout: a.layout, kosten: a.kosten, kontakte: s.kontakte, leads: s.leads }; });
    const prompt = `Du planst die nächste Testrunde für Wochenblatt-Anzeigen. Ziel: günstigste qualifizierte Leads finden, ohne jedes Motiv in jeder Stadt testen zu müssen. Nutze die Prognose des Lern-Modells (Leads pro Euro je Merkmal) und teste gezielt Kombinationen mit guter Prognose oder hoher Unsicherheit.
Erlaubt: kategorie (${KATEGORIEN.join(", ")}), viral (${VIRAL.map((v) => v.id).join(", ")}), ton (${TOENE.join(", ")}).
Blätter: ${JSON.stringify(blaetter.map((b) => ({ id: b.id, name: b.name, stadt: b.stadt, tag: b.tag })))}
Ergebnisse: ${JSON.stringify(ads).slice(0, 50000)}
Lern-Modell-Faktoren: ${model ? JSON.stringify(Object.fromEntries(Object.entries(model.f).map(([k, m]) => [k, Object.fromEntries([...m].map(([v, x]) => [v, Math.round(x.factor * 100) / 100]))]))) : "noch keine"}
Antworte nur mit JSON-Array von 3-5 Vorschlägen: [{"blattId":"...","kategorie":"...","viral":"...","ton":"...","begruendung":"1-2 Sätze"}]`;
    suggCtl = new AbortController(); $("btn-suggest").disabled = true; $("btn-suggest-stop").hidden = false; $("suggest-status").innerHTML = `<span class="thinking">Die KI wertet aus …</span>`; $("sugg").innerHTML = "";
    try {
      const res = await sample.json(prompt, { signal: suggCtl.signal, cache: false });
      const arr = (Array.isArray(res) ? res : []).filter((s) => s && blattById(String(s.blattId)) && KATEGORIEN.includes(s.kategorie)).slice(0, 5);
      if (!arr.length) throw { code: "invalid_json" };
      $("suggest-status").textContent = "Übernehmen, was ihr testen wollt – im KI-Studio entstehen dann die Motive.";
      $("sugg").innerHTML = arr.map((s, i) => `<div class="card" data-i="${i}"><h3>${esc(blattById(s.blattId).stadt)} · ${esc(s.kategorie)} · ${esc(s.viral || "Klassisch")}</h3><p>${esc(s.ton || "")}</p><p>${esc(s.begruendung || "")}</p><div class="btns"><button class="b small primary" data-act="mk">Im KI-Studio erstellen</button></div></div>`).join("");
      $("sugg").onclick = (ev) => { const b = ev.target.closest("button[data-act=mk]"); if (!b) return; const s = arr[Number(b.closest(".card").dataset.i)]; showTab("studio"); $("st-blatt").value = s.blattId; $("st-kategorie").value = s.kategorie; if (VIRAL.some((v) => v.id === s.viral)) $("st-viral").value = s.viral; if (TOENE.includes(s.ton)) $("st-ton").value = s.ton; $("st-hinweis").value = s.begruendung || ""; };
    } catch (err) { $("suggest-status").textContent = sampleErr(err); }
    finally { $("btn-suggest").disabled = false; $("btn-suggest-stop").hidden = true; }
  });

  // ================= Navigation & Start =================
  function openLightbox(src) { $("lightbox-img").src = src; $("lightbox").hidden = false; }
  $("lightbox").addEventListener("click", () => { $("lightbox").hidden = true; });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("lightbox").hidden = true; });
  const tabs = [...document.querySelectorAll("nav.tabs button")];
  function showTab(name) {
    currentTab = name;
    tabs.forEach((t) => t.setAttribute("aria-selected", String(t.dataset.tab === name)));
    document.querySelectorAll(".view").forEach((v) => (v.hidden = v.id !== "v-" + name));
    const pg = PAGES[name]; if (pg) { $("page-title").textContent = pg[0]; $("page-sub").textContent = pg[1]; }
    $("page-actions").innerHTML = name === "kampagnen" ? "" : name === "anzeigen" || name === "auswertung" ? `<button class="b primary" type="button" data-cta="1"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>Neue Kampagne</button>` : "";
    lsSet("lp-tab", name); if (name === "strategie") renderStrategie(); if (name === "studio") renderStudio(); window.scrollTo({ top: 0 });
  }
  tabs.forEach((t) => t.addEventListener("click", () => showTab(t.dataset.tab)));
  const goNewCampaign = () => { showTab("kampagnen"); setTimeout(() => $("kw-name").focus(), 50); };
  $("cta-side").addEventListener("click", goNewCampaign);
  $("page-actions").addEventListener("click", (e) => { if (e.target.closest("[data-cta]")) goNewCampaign(); });
  $("dim").addEventListener("change", renderAuswertung); $("aw-kampagne").addEventListener("change", renderAuswertung);
  $("demo-toggle").addEventListener("change", () => { showDemo = $("demo-toggle").checked; lsSet("lp-demo", showDemo); renderAll(); });

  function renderAll() {
    recompute();
    $("n-anzeigen").textContent = A().length || ""; $("n-kontakte").textContent = K().length || ""; $("n-blaetter").textContent = B().length || ""; $("n-kampagnen").textContent = KP().length || "";
    $("demo-note").hidden = !(showDemo && S.anzeigen.some((a) => a.demo));
    fillSelects(); updateCodeHint(); renderAuswertung(); renderKampagnen(); renderAds(); renderKontakte(); renderBlaetter(); renderKompass();
    if (currentTab === "strategie") renderStrategie(); if (currentTab === "studio") renderStudio();
  }

  // Formular-Grundwerte
  $("a-kategorie").innerHTML = options(KATEGORIEN); $("st-kategorie").innerHTML = options(KATEGORIEN.filter((k) => k !== "Sammelanzeige"));
  $("a-botschaft").innerHTML = options(BOTSCHAFTEN, "Emotion");
  $("a-ton").innerHTML = options(TOENE, "Humor"); $("st-ton").innerHTML = options(TOENE, "Ironisch"); $("kw-ton").innerHTML = options(["Mix testen", ...TOENE], "Mix testen");
  $("a-viral").innerHTML = options(VIRAL.map((v) => v.id)); $("st-viral").innerHTML = options(VIRAL.map((v) => v.id), "Format-Parodie"); $("kw-viral").innerHTML = options(["Agent wählt", ...VIRAL.map((v) => v.id)], "Agent wählt");
  $("a-layout").innerHTML = options(Object.entries(LAYOUTS).map(([value, label]) => ({ value, label })), "A"); $("st-layout").innerHTML = `<option value="auto">KI wählt passend</option>` + options(Object.entries(LAYOUTS).map(([value, label]) => ({ value, label })));
  $("a-format").innerHTML = options(FORMATE.map((f) => ({ value: f.id, label: f.label })), "q-hoch");
  $("a-kontaktwege").innerHTML = checks("akw", KANAELE, ["Telefon", "URL"]);
  $("a-status").innerHTML = options(STATUS, "geplant"); $("ad-filter").innerHTML += options(STATUS);
  $("k-kanal").innerHTML = options(KONTAKT_KANAELE); $("b-tag").innerHTML = options(["—", ...TAGE]);
  $("kw-kat").innerHTML = checks("kwk", LEAD_KATS.map((k) => ({ value: k, label: KAT_INFO[k].name || k })), CORE_KATS);
  $("k-datum").value = todayISO();
  { const t = Date.now(); $("kw-von").value = isoLocal(new Date(t + 14 * 864e5)); $("kw-bis").value = isoLocal(new Date(t + 70 * 864e5)); }
  showDemo = lsGet("lp-demo", true); $("demo-toggle").checked = showDemo;
  adView = lsGet("lp-adview", "vorschau") === "liste" ? "liste" : "vorschau";
  window.addEventListener("hashchange", () => { const h = (location.hash || "").slice(1); if (PAGES[h] && h !== currentTab) showTab(h); });
  const hashTab = (location.hash || "").slice(1);
  showTab(PAGES[hashTab] ? hashTab : PAGES[lsGet("lp-tab", "auswertung")] ? lsGet("lp-tab", "auswertung") : "auswertung");
  setAdView(adView); resetAdForm(); renderAll();

  const setConn = (st, text) => { $("conn-dot").className = "dot " + st; $("conn-text").textContent = text; };
  if (!window.claude || typeof window.claude.use !== "function") { setConn("off", "Offline-Vorschau"); $("db-banner").hidden = false; return; }
  claude.use("assets").then((a) => { assets = a; renderAds(); });
  claude.use("sample").then((s) => { sample = s; if (!s) { $("st-go").disabled = true; $("kw-go").disabled = true; $("btn-suggest").disabled = true; } });
  claude.use("db").then((d) => {
    db = d; if (!db) { setConn("off", "Datenbank nicht verfügbar"); $("db-banner").hidden = false; return; }
    setConn("on", "Live · geteilt im Team");
    const onErr = () => setConn("off", "Verbindung unterbrochen – neu laden");
    let pending = null; const schedule = () => { if (pending) return; pending = setTimeout(() => { pending = null; renderAll(); }, 30); };
    const sub = (name) => db.collection(name).onSnapshot((snap) => { S[name] = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })); schedule(); }, onErr);
    sub("blaetter"); sub("anzeigen"); sub("kontakte"); sub("kampagnen");
    db.doc("einstellungen/allgemein").onSnapshot((snap) => {
      S.settings = { basisUrl: "", waNummer: "", marke: "", limit: null, erloes: null, erledigt: {}, ...(snap.exists ? snap.data() : {}) };
      $("crumb").textContent = marke(); $("side-marke").textContent = "Marke: " + marke();
      for (const [id, key] of [["s-marke", "marke"], ["s-limit", "limit"], ["s-erloes", "erloes"], ["s-url", "basisUrl"], ["s-wa", "waNummer"]]) if (document.activeElement !== $(id)) $(id).value = S.settings[key] ?? "";
      for (const [id, key] of [["s-kin", "inMTok"], ["s-kout", "outMTok"], ["s-credit", "creditEur"]]) if (document.activeElement !== $(id)) $(id).value = kiP()[key];
      if (document.activeElement !== $("s-metacpm")) $("s-metacpm").value = metaCpm();
      schedule();
    }, onErr);
  });
})();

/* Erklär-Tooltips an den Formularfeldern: kleines „?“ neben der Beschriftung, Hover oder Tippen zeigt die Erklärung. */
(() => {
  const TIPS = {
    // Neue Kampagne
    "kw-name": "Frei wählbarer Name, nur für euch. Erscheint in der Kampagnen-Liste, in Analytics und in den Filtern. Tipp: Stadt + Idee + Zeitraum, z. B. „Salzgitter Winter · Lokalpatriotismus“.",
    "kw-blaetter": "In welchen Wochenblättern der Agent schalten darf. Er plant Termine nur an den echten Erscheinungstagen dieser Blätter.",
    "kw-kat": "Wofür geworben wird. Der Agent verteilt die Schaltungen auf diese Kategorien, jede Anzeige bekommt genau eine.",
    "kw-ton": "Tonalität der Texte (seriös, humorvoll, ironisch …). „Mix testen“: Der Agent mischt bewusst verschiedene Töne, damit Analytics später zeigt, welcher am besten wirkt.",
    "kw-viral": "Der kreative Kniff, der eine Anzeige auffallen und weitererzählen lässt, z. B. Serienfigur, Format-Parodie, Lokalpatriotismus. „Klassisch“ = normale Nutzen-Anzeige als Vergleichsgruppe. „Agent wählt“: Der Agent entscheidet je Anzeige, auch nach dem Lern-Modell.",
    "kw-budget": "Gesamtbudget netto für die Zeitungsschaltungen der ganzen Kampagne. Der Agent plant nur so viele Termine, wie hineinpassen. KI-Texte und -Bilder kosten zusätzlich meist nur Cent-Beträge.",
    "kw-motive": "Ein Motiv ist eine fertige Anzeige (Headline, Text, Bild) mit eigenem Code.\n• Vorhandene + neue: Der Agent nimmt eure bewährten Motive (z. B. die Punk-Serie), wo sie passen, und textet für den Rest neue.\n• Nur vorhandene: nichts Neues, nur schon erstellte Motive wieder schalten. Gut, um Gewinner in einer neuen Stadt zu testen.\n• Nur neue texten: alles frisch, alte Motive bleiben außen vor.\nNeue Motive brauchen danach noch ein Bild (Higgsfield).",
    "kw-von": "Zeitraum, in dem die Anzeigen erscheinen sollen (nicht das Buchungsdatum). Der Agent sucht darin die Erscheinungstage der gewählten Blätter, z. B. jeden Samstag, und verteilt die Schaltungen darauf. Achtung: Der Anzeigenschluss liegt meist einige Tage vor dem Erscheinen, also den Start nicht zu knapp wählen. Vorbelegt ist „in 2 bis 10 Wochen“.",
    "kw-bis": "Letzter Tag, an dem eine Anzeige erscheinen darf. Je länger der Zeitraum, desto mehr Termine stehen zur Auswahl. Das Budget begrenzt trotzdem die Anzahl.",
    "kw-hinweis": "Freitext an den Agenten, wird wörtlich mitgegeben. Zum Beispiel: bestimmte Motive bevorzugen, eine Kategorie nur in einem Blatt, Feiertage meiden, Schwerpunkt auf eine Stadt.",
    // Automatik & Marke
    "s-marke": "Unter welchem Namen die Anzeigen erscheinen (Text und Bild-Prompt). Lokalpilot ist nur das Werkzeug, in der Anzeige steht die Marke, z. B. Modernisieren24.",
    "s-limit": "Bis zu diesem Betrag (€ je Kampagne) gibt der Agent eine neue Kampagne selbst frei. Ist sie teurer, wartet sie auf euren Klick. Leer = jede Kampagne wartet auf euren Klick. Freigegeben heißt noch nicht gebucht: Die Buchung beim Verlag ist ein eigener Schritt.",
    "s-erloes": "Was ihr im Schnitt für einen verkauften Lead bekommt (Verkaufspreis an den Abnehmer). Damit rechnet Lokalpilot Deckungsbeitrag und Prognosen.",
    "s-kin": "Preis der KI (Anthropic) je 1 Million Tokens, die an die KI geschickt werden (Anweisungen, Daten). Dient nur der Kostenanzeige „KI-Texte“. 3 € entspricht etwa Claude Sonnet. 1 Million Tokens sind grob 600.000 Wörter.",
    "s-kout": "Preis je 1 Million Tokens, die die KI zurückschreibt (Antworten, Anzeigentexte). Meist 5× teurer als die Eingabe. 15 € entspricht etwa Claude Sonnet.",
    "s-credit": "Was euch ein Higgsfield-Credit kostet (Abo-Preis ÷ enthaltene Credits). Dient der Kostenanzeige „KI-Bilder“.",
    "s-metacpm": "Was 1.000 Einblendungen bei Meta (Facebook/Instagram) etwa kosten. Analytics vergleicht damit, was 1.000 Exemplare Auflage im Wochenblatt kosten („Lokal günstiger als Meta?“).",
    // KI-Studio
    "st-kampagne": "Zu welcher Kampagne die neuen Anzeigen gehören. Wählbar sind nur eure eigenen Kampagnen. Beispielkampagnen sind ausgegraut, weil Beispieldaten nicht bearbeitet werden. Ohne Kampagne landen die Anzeigen lose unter „Anzeigen“.",
    "st-blatt": "Für welches Wochenblatt getextet wird. Bestimmt Stadt (Lokalbezug), Tracking-Code und Format.",
    "st-kategorie": "Wofür die Anzeigen werben.",
    "st-anzahl": "Wie viele Varianten die KI auf einmal erstellt. Mehrere Varianten lassen sich später gegeneinander testen.",
    "st-ton": "Tonalität der Texte, z. B. seriös, humorvoll oder ironisch.",
    "st-viral": "Der kreative Kniff der Anzeige, z. B. Serienfigur, Format-Parodie, Lokalpatriotismus. „Klassisch“ = normale Nutzen-Anzeige.",
    "st-layout": "Aufbau der Anzeige: A Foto + 3 Häkchen · B Frage + Badge · C „Ein Anruf. Drei Angebote.“ · D 3 Schritte · P Format-Parodie. „KI wählt passend“ entscheidet je Anzeige.",
    "st-hinweis": "Optionale Vorgabe für die Idee, z. B. eine Figur, ein Ort, ein Spruch oder ein Anlass.",
  };
  let box;
  const zeige = (el) => {
    if (!box) { box = document.createElement("div"); box.className = "tipbox"; box.setAttribute("role", "tooltip"); document.body.appendChild(box); }
    box.textContent = el.dataset.tip; box.hidden = false;
    const r = el.getBoundingClientRect(), w = Math.min(320, window.innerWidth - 24);
    box.style.width = w + "px";
    const left = Math.max(12, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 12));
    box.style.left = left + "px";
    const h = box.offsetHeight, unten = r.bottom + 8;
    box.style.top = (unten + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 8) : unten) + "px";
  };
  const weg = () => { if (box) box.hidden = true; };
  const einbauen = () => {
    for (const [id, text] of Object.entries(TIPS)) {
      const el = document.getElementById(id); if (!el) continue;
      const ziel = el.closest("fieldset")?.querySelector("legend") || el.closest("label");
      if (!ziel || ziel.querySelector(".tip")) continue;
      const t = document.createElement("span");
      t.className = "tip"; t.tabIndex = 0; t.textContent = "?"; t.dataset.tip = text; t.setAttribute("aria-label", text);
      const txt = [...ziel.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
      if (txt) { const w = document.createElement("span"); w.className = "tiplbl"; txt.replaceWith(w); w.append(txt, t); } else ziel.prepend(t);
      t.addEventListener("mouseenter", () => zeige(t)); t.addEventListener("mouseleave", weg);
      t.addEventListener("focus", () => zeige(t)); t.addEventListener("blur", weg);
      t.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); box && !box.hidden && box.textContent === text ? weg() : zeige(t); });
    }
  };
  window.addEventListener("scroll", weg, true);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", einbauen); else einbauen();
})();
