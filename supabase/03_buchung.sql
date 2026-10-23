-- Lokalpilot: Buchungs-Agent einrichten (nach 01_schema.sql einmal im Supabase SQL Editor ausführen)
-- Buchungen, Mails und Einstellungen liegen wie alles andere in lp_docs (Sammlungen buchungen, buchung_mails,
-- einstellungen/buchung). Neu sind nur ein Tresor für Shop-Zugangsdaten und ein privater Speicher für Belege.

-- 1) Tresor für Zugangsdaten der Anzeigenshops (crossvertise, jetztwerben, Verlags-Shops).
--    Keine Zugriffsregel für angemeldete Nutzer: lesen und schreiben kann nur der Server (Service-Schlüssel).
create table if not exists public.lp_secrets (
  key text primary key,            -- z. B. "shop:market.crossvertise.com"
  value jsonb not null,            -- { "login": "...", "passwort": "..." }
  updated_at timestamptz not null default now()
);
alter table public.lp_secrets enable row level security;
revoke all on public.lp_secrets from anon, authenticated;

-- 2) Belege der Buchungen (Screenshots, Auftragsbestätigungen, Druck-PDFs) – privat, nur für Mitglieder lesbar
insert into storage.buckets (id, name, public) values ('lp-buchung', 'lp-buchung', false)
on conflict (id) do nothing;
drop policy if exists "lp-buchung lesen" on storage.objects;
create policy "lp-buchung lesen" on storage.objects for select to authenticated
  using (bucket_id = 'lp-buchung' and public.lp_is_member());

-- 3) Grundeinstellungen: Automatik aus, Testmodus an. Erst nach dem ersten erfolgreichen Test umschalten.
insert into public.lp_docs (collection, id, data) values ('einstellungen', 'buchung', jsonb_build_object(
  'automatik', false,
  'testmodus', true,
  'testEmpfaenger', 'luca.amthor@solarsale24.com',
  'vorlaufTage', 21,
  'mindestVorlaufTage', 4,
  'preisToleranzProzent', 15,
  'monatsLimit', null,
  'nachfassenNachTagen', 2,
  'absenderName', 'Modernisieren24 Anzeigen',
  'firma', jsonb_build_object('name', '', 'strasse', '', 'plz', '', 'ort', '', 'ustId', '', 'ansprechpartner', 'Luca Amthor', 'telefon', '', 'rechnungsEmail', '')
)) on conflict (collection, id) do nothing;
