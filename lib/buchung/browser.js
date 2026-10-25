import Browserbase from "@browserbasehq/sdk";
import { anthropic } from "./ki";

// Browser-Agent: Claude steuert einen Cloud-Browser (Browserbase) per Computer Use – Screenshots ansehen, klicken,
// tippen, scrollen. Zusätzlich bekommt er eigene Werkzeuge (z. B. Preisprüfung vor dem Abschicken, Druck-PDF wählen,
// Zugangsdaten). Der Lauf endet, sobald der Agent das Werkzeug „fertig“ aufruft oder ein Limit erreicht ist.

const BREITE = 1280;
const HOEHE = 800;
const BILDER_IM_VERLAUF = 3; // ältere Screenshots fliegen aus dem Verlauf (spart Tokens)

const toolVersion = () => process.env.BROWSER_TOOL_VERSION || "20250124";
const betaHeader = (v) => (v === "20251124" ? "computer-use-2025-11-24" : "computer-use-2025-01-24");
export const browserModell = () => process.env.BROWSER_MODEL || process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";

const TASTEN = {
  return: "Enter", enter: "Enter", kp_enter: "Enter", tab: "Tab", escape: "Escape", esc: "Escape", backspace: "Backspace",
  delete: "Delete", space: "Space", up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight",
  page_down: "PageDown", page_up: "PageUp", pagedown: "PageDown", pageup: "PageUp", home: "Home", end: "End",
  ctrl: "Control", control: "Control", alt: "Alt", shift: "Shift", super: "Meta", cmd: "Meta", meta: "Meta", win: "Meta",
};
export function taste(xdotool) {
  return String(xdotool || "")
    .split("+")
    .map((t) => {
      const k = t.trim();
      const m = TASTEN[k.toLowerCase()];
      if (m) return m;
      if (/^f\d{1,2}$/i.test(k)) return k.toUpperCase();
      return k.length === 1 ? k : k.charAt(0).toUpperCase() + k.slice(1);
    })
    .join("+");
}

const schlafen = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {object} o
 * @param {string} o.system      Rolle, Regeln und Ziel für den Agenten
 * @param {string} o.auftrag     erste Nutzernachricht (konkrete Aufgabe)
 * @param {string} o.startUrl
 * @param {Array}  o.werkzeuge   [{ name, description, input_schema, run: async (input, ctx) => string|object, ende?: bool }]
 * @param {(t:string)=>void} o.log
 */
export async function browserAgent({ system, auftrag, startUrl, werkzeuge = [], log = () => {}, maxSchritte = 60, maxMs = 11 * 60 * 1000 }) {
  if (!process.env.BROWSERBASE_API_KEY) throw Object.assign(new Error("BROWSERBASE_API_KEY fehlt in Vercel"), { code: "capability_disabled" });
  const bb = new Browserbase({ apiKey: process.env.BROWSERBASE_API_KEY });
  const basis = {
    ...(process.env.BROWSERBASE_PROJECT_ID ? { projectId: process.env.BROWSERBASE_PROJECT_ID } : {}),
    timeout: Math.min(Math.ceil(maxMs / 1000) + 120, Number(process.env.BROWSERBASE_MAX_SEKUNDEN || 840)),
  };
  let session;
  try {
    session = await bb.sessions.create({
      ...basis,
      region: process.env.BROWSERBASE_REGION || "eu-central-1",
      browserSettings: { viewport: { width: BREITE, height: HOEHE }, blockAds: true, solveCaptchas: true },
    });
  } catch (e) {
    // Gratis-Tarif kennt nicht alle Optionen (z. B. Captcha-Lösen): dann mit Grundeinstellungen starten
    log(`Browser-Start mit Extras abgelehnt (${String(e.message).slice(0, 120)}), starte einfach`);
    session = await bb.sessions.create({ ...basis, browserSettings: { viewport: { width: BREITE, height: HOEHE } } });
  }
  const replayUrl = `https://www.browserbase.com/sessions/${session.id}`;
  log(`Browser gestartet (${replayUrl})`);

  // Erst hier laden: sonst stürzt jede Buchungs-Route ab, wenn Playwright auf Vercel hakt.
  const { chromium } = await import("playwright-core");
  const browser = await chromium.connectOverCDP(session.connectUrl);
  const context = browser.contexts()[0];
  let page = context.pages()[0] || (await context.newPage());
  const ctx = {
    upload: null, // { name, buffer } – wird beim nächsten Dateiauswahl-Dialog eingesetzt
    screenshots: [], // { grund, buffer }
    get page() {
      return page;
    },
    async screenshot(grund) {
      const buffer = await page.screenshot({ type: "jpeg", quality: 70 }).catch(() => null);
      if (buffer) ctx.screenshots.push({ grund, buffer });
      return buffer;
    },
  };
  const beobachten = (p) => {
    p.on("filechooser", async (fc) => {
      if (!ctx.upload) {
        log("Dateiauswahl geöffnet, aber keine Datei vorbereitet");
        return;
      }
      try {
        await fc.setFiles({ name: ctx.upload.name, mimeType: ctx.upload.mimeType || "application/pdf", buffer: Buffer.from(ctx.upload.buffer) });
        log(`Datei hochgeladen: ${ctx.upload.name}`);
      } catch (e) {
        log(`Upload fehlgeschlagen: ${e.message}`);
      }
    });
  };
  beobachten(page);
  context.on("page", (p) => {
    page = p;
    beobachten(p);
    log("Neuer Tab geöffnet");
  });

  let maus = [0, 0];
  const bild = async () => {
    await page.waitForLoadState("domcontentloaded", { timeout: 4000 }).catch(() => {});
    const buf = await page.screenshot({ type: "jpeg", quality: 60 });
    return [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: buf.toString("base64") } }];
  };

  async function aktion(i) {
    const a = i.action;
    const [x, y] = i.coordinate || maus;
    const klick = async (button, clickCount = 1) => {
      const mods = i.text ? taste(i.text).split("+") : [];
      for (const m of mods) await page.keyboard.down(m);
      await page.mouse.click(x, y, { button, clickCount });
      for (const m of mods.reverse()) await page.keyboard.up(m);
      maus = [x, y];
    };
    switch (a) {
      case "screenshot":
        return bild();
      case "left_click": await klick("left"); break;
      case "right_click": await klick("right"); break;
      case "middle_click": await klick("middle"); break;
      case "double_click": await klick("left", 2); break;
      case "triple_click": await klick("left", 3); break;
      case "mouse_move": await page.mouse.move(x, y); maus = [x, y]; break;
      case "left_mouse_down": await page.mouse.down(); break;
      case "left_mouse_up": await page.mouse.up(); break;
      case "left_click_drag": {
        const [sx, sy] = i.start_coordinate || maus;
        await page.mouse.move(sx, sy); await page.mouse.down(); await page.mouse.move(x, y, { steps: 12 }); await page.mouse.up();
        maus = [x, y];
        break;
      }
      case "type": await page.keyboard.type(String(i.text || ""), { delay: 12 }); break;
      case "key": await page.keyboard.press(taste(i.text)); break;
      case "hold_key": {
        const k = taste(i.text);
        await page.keyboard.down(k); await schlafen(Math.min(5000, (i.duration || 1) * 1000)); await page.keyboard.up(k);
        break;
      }
      case "scroll": {
        if (i.coordinate) { await page.mouse.move(x, y); maus = [x, y]; }
        const n = (i.scroll_amount || 3) * 100;
        const d = i.scroll_direction;
        await page.mouse.wheel(d === "left" ? -n : d === "right" ? n : 0, d === "up" ? -n : d === "down" ? n : 0);
        break;
      }
      case "wait": await schlafen(Math.min(10, i.duration || 2) * 1000); break;
      case "cursor_position": return `X=${maus[0]}, Y=${maus[1]}`;
      case "zoom": {
        const [x1, y1, x2, y2] = i.region || [0, 0, BREITE, HOEHE];
        const buf = await page.screenshot({ type: "jpeg", quality: 80, clip: { x: x1, y: y1, width: Math.max(1, x2 - x1), height: Math.max(1, y2 - y1) } });
        return [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: buf.toString("base64") } }];
      }
      default:
        return `Unbekannte Aktion: ${a}`;
    }
    await schlafen(600);
    return bild();
  }

  const v = toolVersion();
  const tools = [
    { type: `computer_${v}`, name: "computer", display_width_px: BREITE, display_height_px: HOEHE },
    {
      name: "oeffne_url",
      description: "Öffnet eine Adresse im aktuellen Tab.",
      input_schema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
    },
    ...werkzeuge.map(({ name, description, input_schema }) => ({ name, description, input_schema })),
  ];
  const eigene = Object.fromEntries(werkzeuge.map((w) => [w.name, w]));

  const messages = [{ role: "user", content: [{ type: "text", text: auftrag }] }];
  const usage = { tin: 0, tout: 0, model: browserModell() };
  const start = Date.now();
  let ergebnis = null;
  let schritte = 0;
  let leerlauf = 0;

  try {
    if (startUrl) await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 30000 }).catch((e) => log(`Start-URL: ${e.message}`));
    while (!ergebnis && schritte < maxSchritte && Date.now() - start < maxMs) {
      schritte++;
      bilderKuerzen(messages);
      const res = await anthropic(
        { model: browserModell(), max_tokens: 3000, system, tools, messages },
        { beta: betaHeader(v) }
      );
      usage.tin += res.usage?.input_tokens || 0;
      usage.tout += res.usage?.output_tokens || 0;
      messages.push({ role: "assistant", content: res.content });
      const text = (res.content || []).filter((c) => c.type === "text").map((c) => c.text).join(" ").trim();
      if (text) log("Agent: " + text.slice(0, 400));
      const aufrufe = (res.content || []).filter((c) => c.type === "tool_use");
      if (!aufrufe.length) {
        if (++leerlauf >= 2) break;
        messages.push({ role: "user", content: [{ type: "text", text: "Mach weiter. Wenn du fertig bist oder nicht weiterkommst, rufe das Werkzeug „fertig“ auf." }] });
        continue;
      }
      leerlauf = 0;
      const ergebnisse = [];
      for (const t of aufrufe) {
        let inhalt;
        let fehler = false;
        try {
          if (t.name === "computer") inhalt = await aktion(t.input || {});
          else if (t.name === "oeffne_url") {
            await page.goto(String(t.input.url), { waitUntil: "domcontentloaded", timeout: 30000 });
            inhalt = await bild();
          } else if (eigene[t.name]) {
            const r = await eigene[t.name].run(t.input || {}, ctx);
            inhalt = typeof r === "string" ? r : JSON.stringify(r);
            if (eigene[t.name].ende) ergebnis = { werkzeug: t.name, ...(t.input || {}) };
          } else {
            inhalt = `Unbekanntes Werkzeug ${t.name}`;
            fehler = true;
          }
        } catch (e) {
          inhalt = `Fehler: ${e.message}`;
          fehler = true;
        }
        ergebnisse.push({ type: "tool_result", tool_use_id: t.id, content: inhalt, ...(fehler ? { is_error: true } : {}) });
      }
      messages.push({ role: "user", content: ergebnisse });
    }
    await ctx.screenshot("ende");
  } finally {
    await browser.close().catch(() => {});
  }
  if (!ergebnis) log(schritte >= maxSchritte ? "Schritt-Limit erreicht" : Date.now() - start >= maxMs ? "Zeit-Limit erreicht" : "Agent hat aufgehört");
  return { ergebnis, schritte, usage, sessionId: session.id, replayUrl, screenshots: ctx.screenshots };
}

// Nur die letzten Screenshots behalten, ältere durch einen Platzhalter ersetzen
export function bilderKuerzen(messages, behalten = BILDER_IM_VERLAUF) {
  let gesehen = 0;
  for (let m = messages.length - 1; m >= 0; m--) {
    const c = messages[m].content;
    if (!Array.isArray(c)) continue;
    for (const block of c) {
      if (block.type !== "tool_result" || !Array.isArray(block.content)) continue;
      if (block.content.some((x) => x.type === "image")) {
        gesehen++;
        if (gesehen > behalten) block.content = [{ type: "text", text: "[älterer Screenshot entfernt]" }];
      }
    }
  }
}
