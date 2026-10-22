# Lokalpilot

Lokale Kampagnen auf Autopilot. Die Idee: Kleine, lokale Wochenblätter erreichen 1.000 Haushalte oft günstiger als Meta 1.000 Einblendungen. KI-Agenten planen, texten und tracken Anzeigen in Wochenblättern (erste Marke: Modernisieren24) und lernen aus jedem Test.

- **Frontend + Server:** Next.js auf Vercel
- **Daten, Login, Bilder:** Supabase (Tabellen `lp_*`, Bucket `lp-bilder`)
- **KI:** Anthropic Claude über `/api/ki` (Schlüssel bleibt auf dem Server)

## Einrichten

1. **Supabase → SQL Editor:** `supabase/01_schema.sql` ausführen. Die Daten aus dem Prototyp übernimmt ein Admin nach dem ersten Login per Klick (oder per `supabase/02_daten.sql`).
   Weitere Mitglieder: `insert into lp_members (email, rolle) values ('name@firma.de', 'mitglied');`
2. **Supabase → Authentication → URL Configuration:** Site URL = Vercel-Adresse (z. B. `https://lokalpilot.vercel.app`), unter Redirect URLs `https://<adresse>/auth/callback` eintragen.
3. **Vercel → Projekt importieren** (Framework wird als Next.js erkannt) und die Variablen aus `.env.example` eintragen. Danach Deploy.
4. **Vercel → Settings → Functions:** Region Frankfurt (`fra1`). **Deployment Protection:** für Production aus (Lokalpilot hat einen eigenen Login).

## Lokal starten

```bash
npm install
cp .env.example .env.local   # Werte eintragen
npm run dev
```

## Aufbau

- `app/lokalpilot.jsx` verbindet die Oberfläche mit Supabase (Live-Daten), der KI-Route und dem Bildspeicher.
- `public/lokalpilot.js` ist die App-Logik aus dem Prototyp (Kampagnen-Agent, KI-Studio, Analytics, Lern-Modell, Kompass).
- `public/bilder/` enthält die Anzeigenmotive aus dem Prototyp (`/_blob/<id>` wird dorthin umgeleitet).
