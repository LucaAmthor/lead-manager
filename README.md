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

## Buchungs-Agent (Seite `/buchungen`)

Bucht freigegebene Anzeigen bei den Zeitungen – **direkt im Online-Shop**, wenn das Blatt einen hat (Verlags-Shop, crossvertise, jetztwerben.de), sonst **per Anfrage an die Anzeigenabteilung**. Klappt die Direktbuchung nicht, wechselt er automatisch auf die Anfrage.

- **Direktbuchung:** Claude steuert einen Cloud-Browser (Browserbase, Computer Use): Formular ausfüllen, Druck-PDF in exakten Maßen hochladen, Zahlung nur auf Rechnung. Vor dem letzten Klick prüft der Server Preis und Zahlart (`bestellung_pruefen`). Screenshots und Druck-PDFs landen als Belege im privaten Bucket `lp-buchung`, jede Sitzung ist bei Browserbase als Aufzeichnung abrufbar.
- **Anfrage:** Mail über Resend mit Kennzeichen `[LP-…]` im Betreff: „verbindlich, sofern der Preis X € netto nicht übersteigt“. Antworten kommen per Webhook, die KI erkennt Angebot, Auftragsbestätigung, Rückfrage, Absage. Danach Zusage, Druckdaten (PDF), Nachfassen nach 2 Werktagen.
- **Sicherheitsnetz:** Automatik-Schalter (aus), Testmodus (an: Mails an den Test-Empfänger, Shop stoppt vor dem Abschicken), Höchstpreis je Buchung = Plan + Toleranz, Kampagnen- und Monatslimit, Mails fremder Absender werden nicht automatisch verarbeitet. Darüber wartet der Agent auf eure Freigabe.
- **Code:** `lib/buchung/` (agent = Ablauf, regeln = Limits/Fälligkeit, browser = Browser-Agent, mail = Resend, druck = PDF), Routen unter `app/api/buchung/`.

### Einrichten
1. Supabase → SQL Editor: `supabase/03_buchung.sql` ausführen.
2. Resend: Domain (z. B. modernisieren24.de) verifizieren, **Receiving** aktivieren (MX-Eintrag), Webhook `email.received` → `https://<app>/api/buchung/mail`.
3. Browserbase-Konto anlegen (API-Key).
4. Variablen aus `.env.example` (Abschnitt Buchungs-Agent) in Vercel eintragen, neu deployen. Der stündliche Lauf steht in `vercel.json`.
5. Auf `/buchungen` Firmendaten eintragen, je Blatt Shop-Adresse oder E-Mail prüfen („Weg prüfen“), im Testmodus eine Buchung durchspielen, dann Testmodus aus und Automatik an.

## Telefon (Seite `/telefon`)

Jede Anzeige bekommt automatisch eine eigene Rufnummer aus einem Pool lokaler Twilio-Nummern. Anrufe klingeln zuerst bei allen, die im Browser-Telefon (unten rechts auf jeder Seite) „bereit“ sind, dann auf dem nächsten Ziel (z. B. Flos Handy, Annahme mit Taste 1), zuletzt Mailbox. Jeder Anruf wird automatisch als Kontakt der Anzeige gezählt.

- **Pool:** Nummer wird vergeben, sobald eine Anzeige freigegeben ist oder in ≤ 45 Tagen erscheint (stündlich, beim Kampagnen-Agenten sofort, spätestens beim Bild-Erzeugen). Nach Erscheinen + 56 Tagen ruht sie 42 Tage (Nachzügler zählen zur alten Anzeige), dann Wiederverwendung. Fehlende Nummern kauft Lokalpilot bis zur Höchstzahl selbst.
- **Browser-Telefon:** zeigt Anrufer, Anzeige, Kategorie, frühere Anfragen, Leitfaden je Kategorie, Einwilligungstext und ein Erfassungsformular. Rückrufe gehen mit der Anzeigen-Nummer als Absender raus.
- **Auslastung:** Gesprächszeit ÷ Zeit „bereit“ je Person, Anrufe nach Uhrzeit, Annahmequote. Bei verpassten Anrufen (Standard: 2 in 60 Min) Mail an die Admins.
- **Übergabe an einen Telefondienst:** dessen Nummer unter Einstellungen → Anruf-Weg als erste Stufe eintragen.
- **Code:** `lib/telefon/` (twilio = REST/Signatur/Token, daten = Pool/Kontakte/Alarm, routing = Anruf-Weg, skripte = Leitfäden), Routen unter `app/api/telefon/`, Browser-Telefon in `app/_telefon/`.

### Einrichten
1. Vercel: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` eintragen, neu deployen.
2. Twilio Console → Regulatory Compliance → Bundle „Deutschland · Local · Business“ mit Handelsregisterauszug und Adresse des Firmensitzes (die Nummern müssen im Ortsnetz dieser Adresse liegen).
3. `/telefon`: „Browser-Telefon einrichten“, Ortsnetz und Handy-Nummer in den Einstellungen eintragen.

## Kurz-Links, QR, Social, Website-Leads

- `/r/<code>` (oder `<KURZLINK_HOSTS>/<code>`) zählt den Besuch und leitet zur Landingpage der Kategorie weiter (`?lp=<code>&utm_*`). `?q=1` = QR-Scan, `?s=1` = Social.
- QR je Anzeige: `/api/qr?code=…&format=svg|png` (`&art=wa` = WhatsApp-QR mit Code). Links stehen in der Anzeigen-Liste.
- Social: Button „Social“ an jeder Anzeige vergibt eine eigene Social-Nummer und zeigt Link + Post-Vorschlag. Viral-Faktor = Social-Kontakte ÷ Print-Kontakte.
- Website: `<script src="https://<app>/lp-tracking.js" defer></script>` einbinden und beim Absenden des Formulars `window.lokalpilot.lead({ name, telefon, email, plz, kategorie, antworten, einwilligung, einwilligungText })` aufrufen. Landet als Kontakt mit Anzeigen-Code.

## WhatsApp (Seite `/whatsapp`)

Meta Cloud API. Die KI antwortet sofort, fragt die Leitfaden-Fragen ab, holt die Einwilligung ein und übergibt an einen Menschen, wenn nötig. Wer selbst schreibt, übernimmt den Chat. Zuordnung über den Code in der ersten Nachricht (wa.me-Link mit vorausgefülltem Text).
Einrichten: siehe Kasten auf `/whatsapp` und `.env.example`.
