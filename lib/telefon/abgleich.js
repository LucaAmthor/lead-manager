import { holen, aendern } from "@/lib/buchung/db";
import { agentAktualisieren, assistentKonfiguriert, assistentStand } from "@/lib/telefon/assistent";

/**
 * Bringt den Assistenten bei ElevenLabs automatisch auf den Stand im Code – nur wenn sich etwas geändert hat
 * (Kennung in einstellungen/telefon.assistentStand). Läuft beim Start jeder neuen Production-Instanz (instrumentation.js),
 * also direkt nach jedem Deploy. Manuell weiter über /telefon → „Assistent aktualisieren“.
 */
export async function assistentAbgleichen({ erzwingen = false } = {}) {
  if (!assistentKonfiguriert()) return { ok: false, grund: "kein ELEVENLABS_API_KEY" };
  const t = (await holen("einstellungen", "telefon")) || {};
  if (!t.assistentAgentId) return { ok: false, grund: "kein Assistent angelegt" };
  const stand = assistentStand();
  if (!erzwingen && t.assistentStand === stand) return { ok: true, unveraendert: true };
  await agentAktualisieren(t.assistentAgentId);
  await aendern("einstellungen", "telefon", { assistentStand: stand, assistentAktualisiertAm: Date.now() });
  return { ok: true, stand };
}
