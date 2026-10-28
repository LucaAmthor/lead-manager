// Läuft einmal beim Start jeder Server-Instanz. In Production: Assistent bei ElevenLabs automatisch aktualisieren,
// wenn sich Prompt/Begrüßung/Werkzeuge im Code geändert haben (nach jedem Deploy). Höchstens 8 s, Fehler nur ins Log.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.VERCEL_ENV !== "production") return;
  try {
    const { assistentAbgleichen } = await import("./lib/telefon/abgleich");
    const r = await Promise.race([assistentAbgleichen(), new Promise((ok) => setTimeout(() => ok({ ok: false, grund: "Zeitlimit" }), 8000))]);
    if (r && !r.unveraendert) console.log("Telefon: Assistent-Abgleich", JSON.stringify(r));
  } catch (e) {
    console.error("Telefon: Assistent-Abgleich fehlgeschlagen", e);
  }
}
