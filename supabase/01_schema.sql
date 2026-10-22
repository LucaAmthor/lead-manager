-- Lokalpilot: Datenbank einrichten
-- Einmal im Supabase SQL Editor ausführen (Dashboard → SQL Editor → New query → einfügen → Run).
-- Alle Tabellen beginnen mit lp_, damit sie neben anderen Projekten (z. B. Zalasi) in derselben Datenbank liegen können.

-- 1) Wer darf rein? (Login per E-Mail-Link, Zugriff nur für eingetragene Mitglieder)
create table if not exists public.lp_members (
  email text primary key,
  rolle text not null default 'mitglied' check (rolle in ('admin', 'mitglied')),
  created_at timestamptz not null default now()
);

-- 2) Daten: ein Dokument je Datensatz, gruppiert nach Sammlung (blaetter, kampagnen, anzeigen, kontakte, einstellungen)
create table if not exists public.lp_docs (
  collection text not null,
  id text not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by text default (auth.jwt() ->> 'email'),
  primary key (collection, id)
);
create index if not exists lp_docs_collection_idx on public.lp_docs (collection);

create or replace function public.lp_is_member()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.lp_members where lower(email) = lower(auth.jwt() ->> 'email'));
$$;

-- Felder zusammenführen (für „update“ aus der App)
create or replace function public.lp_merge(p_collection text, p_id text, p_patch jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare result jsonb;
begin
  update public.lp_docs set data = data || p_patch, updated_at = now(), updated_by = auth.jwt() ->> 'email'
  where collection = p_collection and id = p_id
  returning data into result;
  if result is null then raise exception 'Dokument % / % nicht gefunden', p_collection, p_id; end if;
  return result;
end $$;

-- 3) Zugriffsregeln
alter table public.lp_members enable row level security;
alter table public.lp_docs enable row level security;

drop policy if exists "lp_members lesen" on public.lp_members;
create policy "lp_members lesen" on public.lp_members for select to authenticated
  using (lower(email) = lower(auth.jwt() ->> 'email') or public.lp_is_member());

drop policy if exists "lp_docs lesen" on public.lp_docs;
create policy "lp_docs lesen" on public.lp_docs for select to authenticated using (public.lp_is_member());
drop policy if exists "lp_docs anlegen" on public.lp_docs;
create policy "lp_docs anlegen" on public.lp_docs for insert to authenticated with check (public.lp_is_member());
drop policy if exists "lp_docs ändern" on public.lp_docs;
create policy "lp_docs ändern" on public.lp_docs for update to authenticated using (public.lp_is_member()) with check (public.lp_is_member());
drop policy if exists "lp_docs löschen" on public.lp_docs;
create policy "lp_docs löschen" on public.lp_docs for delete to authenticated using (public.lp_is_member());

-- 4) Live-Updates für alle, die gleichzeitig arbeiten
alter table public.lp_docs replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.lp_docs;
exception when duplicate_object then null; end $$;

-- 5) Bilder (öffentlich lesbar, hochladen nur für Mitglieder)
insert into storage.buckets (id, name, public) values ('lp-bilder', 'lp-bilder', true)
on conflict (id) do nothing;
drop policy if exists "lp-bilder hochladen" on storage.objects;
create policy "lp-bilder hochladen" on storage.objects for insert to authenticated
  with check (bucket_id = 'lp-bilder' and public.lp_is_member());

-- 6) Erste Mitglieder. Weitere Personen genauso eintragen.
insert into public.lp_members (email, rolle) values
  ('luca.amthor@solarsale24.com', 'admin'),
  ('velobagg@gmail.com', 'admin')
on conflict (email) do nothing;
