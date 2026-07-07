-- ============================================
-- BURG Apps v2 — Rollen-systeem
-- Schema + RLS policies + change_user_role()
-- Uitvoeren in de Supabase SQL editor van het nieuwe project.
-- ============================================

create extension if not exists pgcrypto;

-- ============================================
-- ENUM voor rollen
-- ============================================
create type user_role as enum ('admin', 'manager', 'user');

-- ============================================
-- PROFILES tabel (1-op-1 met auth.users)
-- ============================================
create table profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  email text not null,
  naam text,
  role user_role not null default 'user',
  actief boolean not null default true,
  -- Toegangsvlag los van de rol-hiërarchie: geeft binnen "Mijn Omgeving"
  -- extra tabbladen (Second Check / Analytics / Monitoring), ongeacht of
  -- iemand admin/manager/user is. Vervangt de hardgecodeerde e-mailcheck
  -- uit het originele mijn-omgeving.html.
  mijn_omgeving_uitgebreid boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================
-- AUDIT LOG voor rolwijzigingen
-- target_user_id/changed_by zijn NULLABLE met "on delete set null": een
-- profiel mag permanent verwijderd worden (zie admin-delete-user Edge
-- Function) zonder dat de audit-geschiedenis daardoor geblokkeerd wordt
-- door een foreign-key-violation. De log-regel blijft bestaan, alleen de
-- verwijzing naar de verwijderde gebruiker wordt leeg.
-- ============================================
create table role_audit_log (
  id uuid default gen_random_uuid() primary key,
  target_user_id uuid references profiles(id) on delete set null,
  changed_by uuid references profiles(id) on delete set null,
  old_role user_role,
  new_role user_role,
  changed_at timestamptz not null default now()
);

-- ============================================
-- TOOL USAGE — App Counter (admin-only gebruiksteller per tool)
-- Eén rij per keer dat een gebruiker een tool opent. user_id is om
-- dezelfde reden als hierboven nullable met "on delete set null".
-- ============================================
create table tool_usage (
  id uuid default gen_random_uuid() primary key,
  tool_id text not null,
  user_id uuid references profiles(id) on delete set null,
  used_at timestamptz not null default now()
);

-- ============================================
-- Trigger: automatisch profile aanmaken bij nieuwe auth user
-- ============================================
create function handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, role)
  values (new.id, new.email, 'user');
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- ============================================
-- Trigger: updated_at automatisch bijwerken
-- ============================================
create function handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger on_profile_updated
  before update on profiles
  for each row execute procedure handle_updated_at();

-- ============================================
-- RLS aanzetten
-- ============================================
alter table profiles enable row level security;
alter table role_audit_log enable row level security;
alter table tool_usage enable row level security;

-- ============================================
-- Helper: eigen rol ophalen zonder RLS-recursie
-- Een policy op `profiles` die een subquery op `profiles` doet, triggert
-- opnieuw diezelfde policies (RLS-policies worden als OR gecombineerd, dus
-- die subquery wordt voor elke select op profiles geëvalueerd) — dat geeft
-- letterlijk "infinite recursion detected in policy for relation profiles".
-- SECURITY DEFINER laat deze functie draaien als tabel-eigenaar, die RLS op
-- profiles niet ondergaat, dus geen recursie meer.
-- ============================================
create or replace function my_role()
returns user_role
language sql
security definer
stable
set search_path = public
as $$
  select role from profiles where id = auth.uid();
$$;

-- ============================================
-- PROFILES: lezen
-- ============================================
-- Iedereen mag zijn eigen profiel lezen
create policy "eigen profiel lezen"
  on profiles for select
  using (auth.uid() = id);

-- Admins mogen alle profielen lezen
create policy "admin leest alle profielen"
  on profiles for select
  using (my_role() = 'admin');

-- Managers mogen alle profielen lezen (read-only overzicht, geen edit-rechten)
create policy "manager leest alle profielen"
  on profiles for select
  using (my_role() = 'manager');

-- ============================================
-- PROFILES: wijzigen
-- ============================================
-- Er is bewust GEEN UPDATE-policy op profiles. Een policy die enkel test
-- "is de aanroeper admin" (ongeacht welke rij hij target) staat toe dat een
-- admin via een kale .update() de rol van elke andere gebruiker wijzigt,
-- buiten change_user_role() om — zonder de laatste-admin-check en zonder
-- audit-log entry. Alle rolwijzigingen lopen daarom uitsluitend via
-- change_user_role(): die functie is SECURITY DEFINER en voert haar eigen
-- UPDATE uit als tabel-eigenaar, dus ze heeft geen client-UPDATE-policy
-- nodig om te kunnen schrijven.

-- ============================================
-- AUDIT LOG: alleen admins zien 'm, alleen systeem schrijft
-- ============================================
create policy "admin leest audit log"
  on role_audit_log for select
  using (my_role() = 'admin');

create policy "admin schrijft audit log"
  on role_audit_log for insert
  with check (my_role() = 'admin');

-- ============================================
-- TOOL USAGE: iedereen logt eigen gebruik, admin leest alles, gebruiker
-- leest zijn eigen rijen (nodig voor "meest gebruikt" op het dashboard)
-- ============================================
create policy "gebruiker logt eigen tool-gebruik"
  on tool_usage for insert
  with check (auth.uid() = user_id);

create policy "admin leest tool-gebruik"
  on tool_usage for select
  using (my_role() = 'admin');

create policy "gebruiker leest eigen tool-gebruik"
  on tool_usage for select
  using (auth.uid() = user_id);

-- ============================================
-- "Laatste admin"-bescherming
-- RLS alleen voorkomt zelf-degradatie, maar niet dat de laatste admin
-- door een andere admin wordt gedegradeerd. Daarom loopt elke rolwijziging
-- via deze functie i.p.v. een directe UPDATE op profiles.
-- ============================================
create or replace function change_user_role(
  target_id uuid,
  new_role_value user_role
)
returns void as $$
declare
  admin_count int;
  old_role_value user_role;
begin
  -- check: ben ik zelf admin?
  if not exists (select 1 from profiles where id = auth.uid() and role = 'admin') then
    raise exception 'Alleen admins mogen rollen wijzigen';
  end if;

  -- check: een admin mag zichzelf niet degraderen, ook niet als er nog
  -- andere admins over zijn. Dit stond origineel alleen in de RLS UPDATE-
  -- policy (WITH CHECK), maar die policy is verwijderd omdat hij een
  -- bypass van deze functie mogelijk maakte. Zonder deze check hier zou
  -- zelf-degradatie alsnog lukken zolang er >1 admin is.
  if auth.uid() = target_id and new_role_value <> 'admin' then
    raise exception 'Een admin mag zichzelf niet degraderen';
  end if;

  -- Lock alle admin-rijen voor de duur van deze transactie. Zonder deze lock
  -- kunnen twee gelijktijdige aanroepen elk een stale admin_count lezen en
  -- de laatste twee admins tegelijk degraderen (check-then-act race).
  perform 1 from profiles where role = 'admin' for update;

  select role into old_role_value from profiles where id = target_id;

  -- check: is dit de laatste admin?
  if old_role_value = 'admin' and new_role_value <> 'admin' then
    select count(*) into admin_count from profiles where role = 'admin';
    if admin_count <= 1 then
      raise exception 'Kan de laatste admin niet degraderen';
    end if;
  end if;

  update profiles set role = new_role_value where id = target_id;

  insert into role_audit_log (target_user_id, changed_by, old_role, new_role)
  values (target_id, auth.uid(), old_role_value, new_role_value);
end;
$$ language plpgsql security definer;

-- ============================================
-- Gebruiker (de)activeren — zachte verwijdering
-- Zelfde beschermingspatroon als change_user_role(): alleen admin, geen
-- zelf-deactivatie, geen deactivatie van de laatste actieve admin, met
-- row-locking tegen dezelfde race condition.
-- ============================================
create or replace function set_user_actief(
  target_id uuid,
  new_actief boolean
)
returns void as $$
declare
  actieve_admin_count int;
  target_role user_role;
begin
  if not exists (select 1 from profiles where id = auth.uid() and role = 'admin') then
    raise exception 'Alleen admins mogen gebruikers (de)activeren';
  end if;

  if auth.uid() = target_id and new_actief = false then
    raise exception 'Een admin mag zichzelf niet deactiveren';
  end if;

  select role into target_role from profiles where id = target_id;

  if target_role = 'admin' and new_actief = false then
    perform 1 from profiles where role = 'admin' and actief = true for update;
    select count(*) into actieve_admin_count from profiles where role = 'admin' and actief = true;
    if actieve_admin_count <= 1 then
      raise exception 'Kan de laatste actieve admin niet deactiveren';
    end if;
  end if;

  update profiles set actief = new_actief where id = target_id;
end;
$$ language plpgsql security definer;

-- ============================================
-- Gebruiker hernoemen — alleen admin
-- Nodig o.a. voor Doorgroei Tracker: de naam moet exact overeenkomen met
-- de naam-schrijfwijze in de bron-Sheet om de rol-gebaseerde filtering
-- (user ziet alleen eigen rijen) te laten werken.
-- ============================================
create or replace function set_user_naam(
  target_id uuid,
  new_naam text
)
returns void as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and role = 'admin') then
    raise exception 'Alleen admins mogen namen wijzigen';
  end if;

  update profiles set naam = new_naam where id = target_id;
end;
$$ language plpgsql security definer;

-- ============================================
-- Mijn Omgeving: uitgebreide toegang (de)activeren — alleen admin
-- Los van de rol-hiërarchie: bepaalt of iemand binnen Mijn Omgeving de
-- extra tabbladen (Second Check/Analytics/Monitoring) te zien krijgt.
-- ============================================
create or replace function set_mijn_omgeving_uitgebreid(
  target_id uuid,
  new_waarde boolean
)
returns void as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and role = 'admin') then
    raise exception 'Alleen admins mogen deze toegang wijzigen';
  end if;

  update profiles set mijn_omgeving_uitgebreid = new_waarde where id = target_id;
end;
$$ language plpgsql security definer;

-- ============================================
-- Mijn Omgeving: e-mailadressen van uitgebreide gebruikers
-- Nodig omdat de swipe-verdeling (distributeUnassignedJobs/
-- redistributePendingJobs, in het losse burg-jobs-project) moet weten wie
-- er mag swipen, los van rol en los van aanwezigheid. RLS op profiles laat
-- alleen admin/manager alle profielen lezen — een gewone 'user' met
-- mijn_omgeving_uitgebreid zou dus zelf niet kunnen navragen wie er verder
-- nog mag swipen. SECURITY DEFINER + grant aan alle authenticated
-- gebruikers, en geeft bewust ALLEEN e-mailadressen terug (geen rol, naam
-- of actief-status).
-- ============================================
create or replace function uitgebreid_emails()
returns setof text
language sql
security definer
stable
set search_path = public
as $$
  select email from profiles where mijn_omgeving_uitgebreid = true and actief = true;
$$;

grant execute on function uitgebreid_emails() to authenticated;
