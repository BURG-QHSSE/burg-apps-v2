-- ============================================
-- BURG Apps v2 — Rollen-systeem
-- Schema + RLS policies + change_user_role()
-- Uitvoeren in de Supabase SQL editor van het nieuwe project.
-- ============================================

create extension if not exists pgcrypto;

-- ============================================
-- ENUM voor rollen
-- ============================================
create type user_role as enum ('admin', 'manager', 'user', 'hr');
-- Let op: 'hr' is later toegevoegd via `alter type user_role add value 'hr'`
-- (zie project-geschiedenis) — deze create-statement is puur ter
-- documentatie van de huidige staat, niet letterlijk opnieuw uitvoerbaar
-- op een vers project zonder een losse ADD VALUE voor 'hr'.

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
  -- Telt dit profiel mee als consultant in de yield-berekening op het
  -- dashboard (aantal consultants / aantal plaatsingen deze maand)? Los van
  -- de rol-hiërarchie, net als mijn_omgeving_uitgebreid — een admin vinkt
  -- dit per persoon aan in het Adminpaneel, ongeacht rol.
  yield_telt_mee boolean not null default false,
  -- Periode waarbinnen dit profiel meetelt voor yield — los bijgehouden van
  -- yield_telt_mee zelf (uitzetten van de vlag wist beide, zie
  -- set_yield_telt_mee), zodat een medewerker die uit dienst gaat alleen
  -- meetelt in de maanden dat die daadwerkelijk werkte. yield_tot is
  -- nullable: leeg = nog steeds actief/geen einddatum bekend. Beide worden
  -- ook echt gebruikt in yield_consultant_count() hieronder, niet alleen
  -- informatief getoond.
  yield_sinds date,
  yield_tot date,
  -- Of deze hr/admin-gebruiker "GPB wacht op goedkeuring"-notificaties
  -- krijgt (zie sync_notificaties_gpb_update() verderop) — standaard aan,
  -- individueel uit te zetten voor wie deze meldingen niet wil (bv. een
  -- admin die geen HR-achtige taken doet).
  gpb_goedkeuring_notificaties boolean not null default true,
  -- Sales vs consultant-indeling, los van role (toegangsniveau). Door admin
  -- handmatig ingesteld via AdminPanel (set_user_team) - geen auto-vulling.
  -- Gebruikt door Call Insights (call_insights_nieuwe_recordings,
  -- toolRegistry.canAccessTool) om te bepalen wie recruitment-consultant is;
  -- herbruikbaar voor toekomstige tools. NULL = nog niet ingedeeld.
  team text check (team in ('sales', 'consultant')),
  -- Losstaand van call_insights_instellingen.live_voor_consultants (de
  -- globale schakelaar voor alle consultants, nog uit sinds 2026-09-16):
  -- geeft één specifieke consultant vast toegang tot Call Insights om te
  -- testen, zonder de tool voor het hele team open te zetten. Door admin
  -- gezet via set_call_insights_test_toegang, gelezen door
  -- toolRegistry.canAccessTool(). Verandert niets aan de normale
  -- auth.uid()-scoping (+ RLS) in CallInsights.jsx/call_field_suggestions —
  -- deze persoon ziet dus alsnog uitsluitend zijn eigen gesprekken.
  call_insights_test_toegang boolean not null default false,
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
$$ language plpgsql security definer set search_path = public;

-- Alleen ooit via de trigger hieronder aangeroepen (dus onder de definer's
-- eigen rechten, EXECUTE-grants raken triggerwerking niet) -- nooit
-- rechtstreeks via RPC. Revoke sluit toch het per-ongeluk-aanroepbare pad af
-- dat de standaard PUBLIC-grant anders open zou laten (2026-09-23-audit).
revoke execute on function handle_new_user() from public;

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

-- Losse twin van handle_updated_at() hierboven, gebruikt door
-- trg_dev_projects_updated_at op dev_projects (zie ONTWIKKELING verderop) --
-- bestond al live maar ontbrak nog in dit bestand (schema drift, gevonden
-- tijdens de 2026-09-23-audit).
create or replace function set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

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

-- BEWUST WEL uitvoerbaar door anon (in tegenstelling tot alle andere
-- SECURITY DEFINER-functies in dit schema, die tijdens de 2026-09-23-audit
-- juist van anon zijn ontnomen): my_role() wordt rechtstreeks binnen RLS
-- USING-clauses aangeroepen (zie de policies op profiles/role_audit_log/
-- tool_usage/plaatsingen/proeftijd_kandidaten hieronder), en die worden
-- geëvalueerd onder de AANROEPENDE rol -- inclusief anon, want anon heeft op
-- die tabellen gewoon volledige tabel-grants (standaard Supabase-gedrag,
-- RLS is daar de echte poort, niet de grant). EXECUTE hier weghalen bij
-- anon breekt die evaluatie met "permission denied for function my_role"
-- i.p.v. de bedoelde stille "0 rijen" -- live bevestigd en teruggedraaid
-- nadat de brede anon-revoke van deze audit dit per ongeluk meenam.
-- my_role() zelf is voor anon niet exploiteerbaar: het geeft NULL terug
-- (geen auth.uid()), en NULL in een SQL/RLS-boolean-context sluit een rij
-- uit i.p.v. 'm toe te staan -- dat is een ander mechanisme dan de PL/pgSQL
-- "IF <NULL> wordt als false behandeld"-bug die de GPB-functies wél hadden.

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

-- HR heeft dezelfde rechten als manager (zie ROLE_HIERARCHY in
-- toolRegistry.js: hr en manager delen hetzelfde niveau) — los daarvan
-- kan een toekomstige tool zelf nog los onderscheid maken tussen
-- manager/user/hr, dat gebeurt dan in die tool zelf, niet hier.
create policy "hr leest alle profielen"
  on profiles for select
  using (my_role() = 'hr');

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
$$ language plpgsql security definer set search_path = public;

-- Zie de "revoke ... from public"-toelichting bij create_gpb_beoordeling
-- verderop in dit bestand: zonder deze revoke blijft de standaard Postgres
-- PUBLIC-grant (dus ook anon) van kracht. De interne "not exists(...)"-check
-- hierboven blokkeert anon al functioneel (EXISTS is nooit NULL, dus deze
-- functie zelf had niet de PL/pgSQL-NULL-bug van de GPB-functies), maar
-- deze revoke sluit het defensief toch af i.p.v. te vertrouwen op de
-- functielogica alleen (2026-09-23-audit).
revoke execute on function change_user_role(uuid, user_role) from public;
grant execute on function change_user_role(uuid, user_role) to authenticated;

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
$$ language plpgsql security definer set search_path = public;

-- zie de revoke-toelichting bij change_user_role hierboven
revoke execute on function set_user_actief(uuid, boolean) from public;
grant execute on function set_user_actief(uuid, boolean) to authenticated;

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
$$ language plpgsql security definer set search_path = public;

-- zie de revoke-toelichting bij change_user_role hierboven
revoke execute on function set_user_naam(uuid, text) from public;
grant execute on function set_user_naam(uuid, text) to authenticated;

-- ============================================
-- Sales vs consultant-indeling (de)activeren — alleen admin, vanuit het
-- AdminPanel. Los van de rol-hiërarchie (role), zie kolomcomment bij
-- profiles.team. Bepaalt sinds 2026-09-16 wie meetelt voor Call Insights-
-- matching (call_insights_nieuwe_recordings hieronder).
-- ============================================
create or replace function set_user_team(
  target_id uuid,
  new_team text
)
returns void as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and role = 'admin') then
    raise exception 'Alleen admins mogen dit wijzigen';
  end if;

  if new_team is not null and new_team not in ('sales', 'consultant') then
    raise exception 'Ongeldige team-waarde: %', new_team;
  end if;

  update profiles set team = new_team where id = target_id;
end;
$$ language plpgsql security definer set search_path = public;

-- zie de revoke-toelichting bij change_user_role hierboven
revoke execute on function set_user_team(uuid, text) from public;
grant execute on function set_user_team(uuid, text) to authenticated;

-- ============================================
-- Eén consultant vast toegang geven tot Call Insights om te testen (los van
-- de globale live_voor_consultants-schakelaar) — alleen admin, vanuit
-- AdminPanel. Zie kolomcomment bij profiles.call_insights_test_toegang.
-- ============================================
create or replace function set_call_insights_test_toegang(
  target_id uuid,
  new_waarde boolean
)
returns void as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and role = 'admin') then
    raise exception 'Alleen admins mogen dit wijzigen';
  end if;

  update profiles set call_insights_test_toegang = new_waarde where id = target_id;
end;
$$ language plpgsql security definer set search_path = public;

-- zie de revoke-toelichting bij change_user_role hogerop in dit bestand
revoke execute on function set_call_insights_test_toegang(uuid, boolean) from public;
grant execute on function set_call_insights_test_toegang(uuid, boolean) to authenticated;

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
$$ language plpgsql security definer set search_path = public;

-- zie de revoke-toelichting bij change_user_role hogerop in dit bestand
revoke execute on function set_mijn_omgeving_uitgebreid(uuid, boolean) from public;
grant execute on function set_mijn_omgeving_uitgebreid(uuid, boolean) to authenticated;

-- ============================================
-- Mijn Omgeving: e-mailadressen van iedereen met uitgebreide toegang —
-- nodig zodat een uitgebreide gebruiker kan zien wie er nog meer uitgebreide
-- toegang heeft, zonder de volledige profiles-tabel te mogen lezen (RLS
-- laat een gewone 'user' alleen de eigen rij lezen). SECURITY DEFINER +
-- grant ALLEEN aan authenticated (nooit anon/public — dit gaf tot
-- 2026-09-21 personeels-e-mailadressen vrij aan niet-ingelogde bezoekers
-- via de publieke REST-API, gevonden door de wekelijkse security-audit en
-- gefixt door de PUBLIC/anon-grant te revoken).
-- ============================================
create or replace function uitgebreid_emails()
returns setof text
language sql
stable security definer
set search_path to 'public'
as $$
  select email from profiles where mijn_omgeving_uitgebreid = true and actief = true;
$$;

revoke execute on function uitgebreid_emails() from public, anon;
grant execute on function uitgebreid_emails() to authenticated;

-- ============================================
-- Yield-thermometer: wie telt mee als consultant (de)activeren — alleen
-- admin, vanuit het Adminpaneel. Zelfde patroon als
-- set_mijn_omgeving_uitgebreid hierboven.
-- ============================================
-- yield_sinds is alleen geldig zolang yield_telt_mee aan staat: uitzetten
-- wist de datum daarom bewust mee (in dezelfde update, niet via een losse
-- call) — anders kan een medewerker die niet meer meetelt toch nog een
-- "sinds"/"tot"-datum tonen. Aanzetten raakt eventueel al aanwezige datums
-- niet aan (die kunnen dan nog kloppen).
create or replace function set_yield_telt_mee(
  target_id uuid,
  new_waarde boolean
)
returns void as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and role = 'admin') then
    raise exception 'Alleen admins mogen dit wijzigen';
  end if;

  update profiles
  set yield_telt_mee = new_waarde,
      yield_sinds = case when new_waarde then yield_sinds else null end,
      yield_tot = case when new_waarde then yield_tot else null end
  where id = target_id;
end;
$$ language plpgsql security definer set search_path = public;

-- zie de revoke-toelichting bij change_user_role hogerop in dit bestand
revoke execute on function set_yield_telt_mee(uuid, boolean) from public;
grant execute on function set_yield_telt_mee(uuid, boolean) to authenticated;

-- Los van set_yield_telt_mee gehouden (zelfde reden als set_user_naam los
-- van change_user_role): het los kunnen zetten van de datum zonder de
-- yield_telt_mee-vlag aan te raken.
create or replace function set_yield_sinds(
  target_id uuid,
  nieuwe_datum date
)
returns void as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and role = 'admin') then
    raise exception 'Alleen admins mogen dit wijzigen';
  end if;

  update profiles set yield_sinds = nieuwe_datum where id = target_id;
end;
$$ language plpgsql security definer set search_path = public;

-- zie de revoke-toelichting bij change_user_role hogerop in dit bestand
revoke execute on function set_yield_sinds(uuid, date) from public;
grant execute on function set_yield_sinds(uuid, date) to authenticated;

-- Tegenhanger van set_yield_sinds: einddatum van de yield-periode (bv.
-- laatste werkdag bij uit-dienst-treding). Los gehouden om dezelfde reden.
create or replace function set_yield_tot(
  target_id uuid,
  nieuwe_datum date
)
returns void as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and role = 'admin') then
    raise exception 'Alleen admins mogen dit wijzigen';
  end if;

  update profiles set yield_tot = nieuwe_datum where id = target_id;
end;
$$ language plpgsql security definer set search_path = public;

-- zie de revoke-toelichting bij change_user_role hogerop in dit bestand
revoke execute on function set_yield_tot(uuid, date) from public;
grant execute on function set_yield_tot(uuid, date) to authenticated;

-- ============================================
-- Yield-thermometer: aantal consultants dat meetelt — nodig omdat RLS op
-- profiles een gewone 'user' alleen zijn eigen rij laat lezen (zie
-- policies hierboven). SECURITY DEFINER + grant aan alle authenticated
-- gebruikers, en geeft bewust ALLEEN een getal terug (geen namen, rollen of
-- andere profieldata) — dezelfde aanpak als de eerdere uitgebreid_emails().
--
-- yield_sinds/yield_tot maken dit datum-bewust: iemand telt alleen mee als
-- vandaag binnen die periode valt (null = geen grens aan die kant), zodat
-- een medewerker die uit dienst gaat automatisch alleen meetelt in de
-- maanden dat die daadwerkelijk werkte, zonder dat een admin er telkens
-- aan hoeft te denken om de vlag op tijd uit te zetten.
-- ============================================
create or replace function yield_consultant_count()
returns int
language sql
security definer
stable
set search_path = public
as $$
  select count(*)::int from profiles
  where yield_telt_mee = true
    and actief = true
    and (yield_sinds is null or yield_sinds <= current_date)
    and (yield_tot is null or yield_tot >= current_date);
$$;

-- Tot 2026-09-22 stond dit nog open voor anon/public (zelfde bugklasse als
-- uitgebreid_emails() hierboven, gevonden bij het dichten van dát gat) —
-- alleen authenticated hoort dit te mogen.
revoke execute on function yield_consultant_count() from public, anon;

grant execute on function yield_consultant_count() to authenticated;

-- ============================================
-- Yield-thermometer: log van plaatsingen. Bewust een aparte, simpele tabel
-- (geen koppeling met jobs/burg-jobs — dat is een los Supabase-project en
-- gaat over vacatures, niet over plaatsingen) — elke rij is één plaatsing
-- op een datum. Iedereen mag lezen (alleen datum + wie het toevoegde, geen
-- gevoelige data), alleen hr/admin mag toevoegen/verwijderen — zie
-- Dashboard.jsx (YieldThermometer-widget) en AdminPanel.jsx (yield_telt_mee
-- checkbox).
-- ============================================
create table plaatsingen (
  id uuid default gen_random_uuid() primary key,
  geplaatst_op date not null default current_date,
  toegevoegd_door uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table plaatsingen enable row level security;

-- "using (true)" zonder auth.uid()-check zou dit voor de anon-rol
-- (ongeauthenticeerd, via de publieke anon-sleutel) leesbaar maken — dat is
-- hier bewust gesloten, in lijn met elke andere policy in dit schema.
create policy "ingelogde gebruikers lezen plaatsingen"
  on plaatsingen for select
  using (auth.uid() is not null);

create policy "hr/admin voegen plaatsingen toe"
  on plaatsingen for insert
  with check (my_role() in ('hr', 'admin'));

create policy "hr/admin verwijderen plaatsingen"
  on plaatsingen for delete
  using (my_role() in ('hr', 'admin'));

-- ============================================
-- PROEFTIJD TRACKER — gedeelde lijst kandidaten in proeftijd.
-- Bewust geen rol-restrictie: elke ingelogde gebruiker mag alle kandidaten
-- lezen (gedeeld overzicht), maar alleen zijn eigen kandidaten toevoegen en
-- verwijderen — de INSERT/DELETE-policies dwingen dat af via created_by,
-- dus dit is geen client-side-only beperking.
-- created_by is nullable met "on delete set null" om dezelfde reden als
-- role_audit_log/tool_usage hierboven — een verwijderd profiel mag de
-- historische rijen niet blokkeren. created_by_naam is een bewuste
-- denormalisatie: RLS op profiles laat een 'user' alleen zijn eigen
-- profiel lezen, dus een join zou voor de meeste mensen leeg tonen wie
-- een collega heeft toegevoegd. De naam wordt daarom als tekst
-- meegeschreven op het moment van toevoegen (blijft ook correct als de
-- aanmaker later van naam verandert of verwijderd wordt).
-- ============================================
create table proeftijd_kandidaten (
  id uuid default gen_random_uuid() primary key,
  naam text not null,
  start_datum date not null,
  duur_maanden int not null,
  created_by uuid references profiles(id) on delete set null,
  created_by_naam text,
  created_at timestamptz not null default now()
);

alter table proeftijd_kandidaten enable row level security;

create policy "ingelogde gebruikers lezen proeftijd-kandidaten"
  on proeftijd_kandidaten for select
  using (auth.uid() is not null);

create policy "gebruiker voegt eigen proeftijd-kandidaten toe"
  on proeftijd_kandidaten for insert
  with check (auth.uid() = created_by);

create policy "gebruiker verwijdert eigen proeftijd-kandidaten"
  on proeftijd_kandidaten for delete
  using (auth.uid() = created_by);

-- ============================================
-- Adminpaneel: laatste inlogtijd per gebruiker
-- auth.users is niet rechtstreeks opvraagbaar voor de client (geen RLS op
-- het auth-schema). Deze SECURITY DEFINER-functie geeft daarom alleen
-- id + last_sign_in_at terug, en uitsluitend aan een admin — de WHERE-
-- constructie levert een lege set op voor iedereen die geen admin is,
-- i.p.v. een foutmelding.
-- ============================================
create or replace function admin_last_sign_ins()
returns table(id uuid, last_sign_in_at timestamptz)
language sql
security definer
stable
set search_path = public
as $$
  select u.id, u.last_sign_in_at
  from auth.users u
  where my_role() = 'admin';
$$;

-- zie de revoke-toelichting bij change_user_role hogerop in dit bestand
revoke execute on function admin_last_sign_ins() from public;
grant execute on function admin_last_sign_ins() to authenticated;

-- ============================================
-- GPB BEOORDELINGSTOOL — halfjaarlijkse beoordelingen.
--
-- Bewust geen invite-links/tokens: iedereen heeft al een burg-apps-v2-
-- account, dus medewerker/leidinggevende loggen gewoon in en zien hun
-- openstaande beoordeling in de tool zelf (geen externe e-mail nodig).
--
-- Rollen binnen déze tool zijn LOS van de algemene ROLE_HIERARCHY-ladder
-- (net als bij Kansen Swiper's mijn_omgeving_uitgebreid): een manager ziet
-- hier alleen zijn eigen team als leidinggevende, HR/admin ziet alles —
-- dat is geen oplopende trap maar drie aparte populaties.
--
-- Net als bij `profiles` is er BEWUST geen UPDATE-policy: elke wijziging
-- (invullen, goedkeuren, definitief maken) loopt via een SECURITY DEFINER
-- functie die zelf controleert of de aanroeper de juiste persoon is én of
-- de beoordeling in de juiste status staat — zelfde patroon als
-- change_user_role().
-- ============================================
create type gpb_status as enum ('concept', 'goedgekeurd', 'definitief');

create table gpb_beoordelingen (
  id uuid default gen_random_uuid() primary key,
  medewerker_id uuid references profiles(id) on delete set null,
  -- Snapshot van de naam op aanmaakmoment: blijft leesbaar in het
  -- overzicht/rapport ook als het profiel later verwijderd wordt.
  medewerker_naam text not null,
  leidinggevende_id uuid references profiles(id) on delete set null,
  afdeling text not null,
  functieniveau int not null,
  periode text not null,
  status gpb_status not null default 'concept',

  -- Vaste vorm (6 pijlers x 3 stellingen), vandaar jsonb i.p.v. een losse
  -- tabel: [{ scores: [n,n,n], toelichtingen: [t,t,t] }, ...] x 6.
  medewerker_antwoorden jsonb,
  medewerker_ingevuld_at timestamptz,
  leidinggevende_antwoorden jsonb,
  leidinggevende_ingevuld_at timestamptz,

  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  goedgekeurd_by uuid references profiles(id) on delete set null,
  goedgekeurd_at timestamptz,
  definitief_at timestamptz
);

-- Doelen krijgen wél een eigen tabel (i.p.v. jsonb): moeten over
-- beoordelingsrondes heen terug te vinden zijn ("agenda voor het
-- vervolggesprek"), dat vraagt om een normale, query-bare rij per doel.
create table gpb_doelen (
  id uuid default gen_random_uuid() primary key,
  beoordeling_id uuid not null references gpb_beoordelingen(id) on delete cascade,
  omschrijving text not null,
  pijler int not null,
  deadline date not null,
  created_at timestamptz not null default now()
);

alter table gpb_beoordelingen enable row level security;
alter table gpb_doelen enable row level security;

create policy "hr/admin lezen alle gpb-beoordelingen"
  on gpb_beoordelingen for select
  using (my_role() in ('hr', 'admin'));

create policy "medewerker leest eigen gpb-beoordeling"
  on gpb_beoordelingen for select
  using (auth.uid() = medewerker_id);

create policy "leidinggevende leest toegewezen gpb-beoordelingen"
  on gpb_beoordelingen for select
  using (auth.uid() = leidinggevende_id);

-- ============================================
-- GPB: leesview die leidinggevende_antwoorden verbergt voor de medewerker
-- zelf zolang HR de beoordeling nog niet heeft goedgekeurd (status =
-- 'concept'). RLS hierboven is alleen rij-niveau: zonder deze view zou de
-- medewerker de kolom leidinggevende_antwoorden gewoon in de ruwe response
-- krijgen zodra de leidinggevende heeft ingevuld, nog voor HR-goedkeuring.
-- security_invoker zorgt dat de RLS-policies hierboven gewoon van
-- toepassing blijven (de view voegt alleen kolom-maskering toe) — de
-- leidinggevende zelf en hr/admin blijven de antwoorden altijd zien, want
-- voor hen is auth.uid() <> medewerker_id.
-- ============================================
create or replace view gpb_beoordelingen_view
with (security_invoker = true) as
select
  id,
  medewerker_id,
  medewerker_naam,
  leidinggevende_id,
  afdeling,
  functieniveau,
  periode,
  status,
  medewerker_antwoorden,
  medewerker_ingevuld_at,
  case
    when auth.uid() = medewerker_id and status = 'concept' then null
    else leidinggevende_antwoorden
  end as leidinggevende_antwoorden,
  leidinggevende_ingevuld_at,
  created_by,
  created_at,
  goedgekeurd_by,
  goedgekeurd_at,
  definitief_at
from gpb_beoordelingen;

grant select on gpb_beoordelingen_view to authenticated;

-- Verwijderen is een simpele, niet-toestandsafhankelijke actie (in
-- tegenstelling tot invullen/goedkeuren/definitief maken hierboven), dus
-- hiervoor volstaat een gewone RLS-policy i.p.v. een RPC. gpb_doelen
-- ruimt zichzelf op via de "on delete cascade" op beoordeling_id.
create policy "hr/admin verwijderen gpb-beoordelingen"
  on gpb_beoordelingen for delete
  using (my_role() in ('hr', 'admin'));

create policy "leest gpb-doelen bij toegankelijke beoordeling"
  on gpb_doelen for select
  using (
    exists (
      select 1 from gpb_beoordelingen b
      where b.id = gpb_doelen.beoordeling_id
        and (
          my_role() in ('hr', 'admin')
          or b.medewerker_id = auth.uid()
          or b.leidinggevende_id = auth.uid()
        )
    )
  );

-- ============================================
-- GPB: aanmaken (alleen HR/admin — de "Dashboard-gebruiker"-rol uit het
-- principes-document).
-- ============================================
create or replace function create_gpb_beoordeling(
  p_medewerker_id uuid,
  p_medewerker_naam text,
  p_leidinggevende_id uuid,
  p_afdeling text,
  p_functieniveau int,
  p_periode text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  nieuw_id uuid;
begin
  -- "my_role() is null or" is niet cosmetisch: my_role() geeft NULL terug voor
  -- een niet-ingelogde aanroeper (anon), en in PL/pgSQL wordt "IF <NULL>" als
  -- false behandeld -- zonder deze null-check vuurt de exception dan NIET en
  -- loopt de functie gewoon door. Zelfde bugklasse gevonden en gefixt in alle
  -- 10 GPB-functies op 2026-09-23 (zie ook de "is distinct from"-fix bij
  -- submit_gpb_medewerker/leidinggevende en save_gpb_*_concept hieronder).
  if my_role() is null or my_role() not in ('hr', 'admin') then
    raise exception 'Alleen HR of admin mag een beoordeling aanmaken';
  end if;

  if my_role() = 'admin' and p_medewerker_id <> auth.uid()
     and exists (select 1 from profiles where id = auth.uid() and gpb_others_restricted) then
    raise exception 'Je hebt geen rechten om GPB-beoordelingen voor andere medewerkers klaar te zetten';
  end if;

  insert into gpb_beoordelingen (medewerker_id, medewerker_naam, leidinggevende_id, afdeling, functieniveau, periode)
  values (p_medewerker_id, p_medewerker_naam, p_leidinggevende_id, p_afdeling, p_functieniveau, p_periode)
  returning id into nieuw_id;

  return nieuw_id;
end;
$$;

-- Zonder deze revoke blijft de standaard Postgres PUBLIC-grant (elke functie
-- is bij aanmaak uitvoerbaar door PUBLIC, waar anon lid van is) van kracht
-- naast de grant hieronder -- "grant ... to authenticated" alleen sluit anon
-- dus NIET uit. Zelfde patroon toegepast op alle GPB-functies en
-- admin/yield-functies in dit bestand (2026-09-23-audit).
revoke execute on function create_gpb_beoordeling(uuid, text, uuid, text, int, text) from public;
grant execute on function create_gpb_beoordeling(uuid, text, uuid, text, int, text) to authenticated;

-- ============================================
-- GPB: medewerker slaat zijn zelfevaluatie + 3 doelen op — als concept,
-- net zo vaak te herzien als nodig zolang de status 'concept' is. Mag
-- alleen de toegewezen medewerker. Zodra HR goedkeurt (status wijzigt),
-- kan de medewerker niet meer bewerken (zie keur_gpb_goed). De
-- ingevuld_at-timestamp blijft de EERSTE keer opslaan markeren (via
-- coalesce), zodat "heeft ingevuld" bruikbaar blijft voor tellers/labels
-- ook al is er daarna nog aan gesleuteld.
-- ============================================
create or replace function submit_gpb_medewerker(
  p_beoordeling_id uuid,
  p_antwoorden jsonb,
  p_doelen jsonb  -- [{ omschrijving, pijler, deadline }, ...] x 3
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b gpb_beoordelingen;
  doel jsonb;
begin
  select * into b from gpb_beoordelingen where id = p_beoordeling_id;

  if b.id is null then
    raise exception 'Beoordeling niet gevonden';
  end if;
  -- "is distinct from" i.p.v. "<>": auth.uid() is NULL voor een niet-
  -- ingelogde aanroeper, en "NULL <> x" evalueert tot NULL, niet true -- de
  -- "IF NULL" hieromheen wordt door PL/pgSQL als false behandeld, dus de
  -- exception vuurde voorheen NIET voor anon en de update ging gewoon door.
  -- "is distinct from" behandelt NULL wel als een vergelijkbare waarde en
  -- geeft hier altijd true terug voor een niet-ingelogde caller. Gevonden en
  -- gefixt 2026-09-23 (alle vier submit/save_gpb_*-functies hadden dit).
  if auth.uid() is distinct from b.medewerker_id then
    raise exception 'Alleen de toegewezen medewerker mag dit invullen';
  end if;
  if b.status <> 'concept' then
    raise exception 'Zelfevaluatie kan niet meer bewerkt worden na goedkeuring door HR';
  end if;
  if jsonb_array_length(p_antwoorden) <> 6 then
    raise exception 'Verwacht 6 pijlers met antwoorden';
  end if;

  update gpb_beoordelingen
  set medewerker_antwoorden = p_antwoorden,
      medewerker_ingevuld_at = coalesce(medewerker_ingevuld_at, now())
  where id = p_beoordeling_id;

  delete from gpb_doelen where beoordeling_id = p_beoordeling_id;
  for doel in select * from jsonb_array_elements(p_doelen) loop
    insert into gpb_doelen (beoordeling_id, omschrijving, pijler, deadline)
    values (
      p_beoordeling_id,
      doel->>'omschrijving',
      (doel->>'pijler')::int,
      (doel->>'deadline')::date
    );
  end loop;
end;
$$;

revoke execute on function submit_gpb_medewerker(uuid, jsonb, jsonb) from public;
grant execute on function submit_gpb_medewerker(uuid, jsonb, jsonb) to authenticated;

-- ============================================
-- GPB: leidinggevende slaat zijn beoordeling op — als concept, te herzien
-- zolang de beoordeling niet definitief is (dus ook nog na HR-goedkeuring,
-- bewust optioneel bewerkbaar tot HR 'm definitief maakt). Mag alleen de
-- toegewezen leidinggevende. Bewust ONAFHANKELIJK van de
-- medewerker-zelfevaluatie (niet sequentieel) — medewerker en
-- leidinggevende kunnen dit simultaan, los van elkaar invullen.
-- ============================================
create or replace function submit_gpb_leidinggevende(
  p_beoordeling_id uuid,
  p_antwoorden jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b gpb_beoordelingen;
begin
  select * into b from gpb_beoordelingen where id = p_beoordeling_id;

  if b.id is null then
    raise exception 'Beoordeling niet gevonden';
  end if;
  -- zie submit_gpb_medewerker hierboven voor waarom "is distinct from" i.p.v. "<>"
  if auth.uid() is distinct from b.leidinggevende_id then
    raise exception 'Alleen de toegewezen leidinggevende mag dit invullen';
  end if;
  if b.status = 'definitief' then
    raise exception 'Beoordeling is definitief gemaakt en kan niet meer bewerkt worden';
  end if;
  if jsonb_array_length(p_antwoorden) <> 6 then
    raise exception 'Verwacht 6 pijlers met antwoorden';
  end if;

  update gpb_beoordelingen
  set leidinggevende_antwoorden = p_antwoorden,
      leidinggevende_ingevuld_at = coalesce(leidinggevende_ingevuld_at, now())
  where id = p_beoordeling_id;
end;
$$;

revoke execute on function submit_gpb_leidinggevende(uuid, jsonb) from public;
grant execute on function submit_gpb_leidinggevende(uuid, jsonb) to authenticated;

-- ============================================
-- GPB: tussentijdse concept-autosave, los van submit_gpb_medewerker/
-- submit_gpb_leidinggevende. Bewust GEEN medewerker_ingevuld_at/definitieve
-- semantiek hier: dit is puur "wat er nu getypt is niet kwijtraken bij
-- wegnavigeren", geen indiening. ingevuld_at blijft daarom de indicator
-- voor "heeft de zelfevaluatie/beoordeling echt ingediend" — gebruikt door
-- de leidinggevende-UI en telOpenstaandeGpbActies() — anders zou die al na
-- de eerste toets bij een half leeg formulier verdwijnen.
--
-- Doelen met een lege omschrijving/deadline worden overgeslagen (niet
-- opgeslagen als kapotte rij) omdat gpb_doelen.omschrijving/deadline NOT
-- NULL zijn — een concept mag onvolledig zijn, submit_gpb_medewerker blijft
-- de plek waar volledige doelen verplicht worden (frontend-validatie).
-- ============================================
create or replace function save_gpb_medewerker_concept(
  p_beoordeling_id uuid,
  p_antwoorden jsonb,
  p_doelen jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b gpb_beoordelingen;
  doel jsonb;
begin
  select * into b from gpb_beoordelingen where id = p_beoordeling_id;

  if b.id is null then
    raise exception 'Beoordeling niet gevonden';
  end if;
  -- zie submit_gpb_medewerker hierboven voor waarom "is distinct from" i.p.v. "<>"
  if auth.uid() is distinct from b.medewerker_id then
    raise exception 'Alleen de toegewezen medewerker mag dit invullen';
  end if;
  if b.status <> 'concept' then
    raise exception 'Zelfevaluatie kan niet meer bewerkt worden na goedkeuring door HR';
  end if;
  if jsonb_array_length(p_antwoorden) <> 6 then
    raise exception 'Verwacht 6 pijlers met antwoorden';
  end if;

  update gpb_beoordelingen
  set medewerker_antwoorden = p_antwoorden
  where id = p_beoordeling_id;

  delete from gpb_doelen where beoordeling_id = p_beoordeling_id;
  for doel in select * from jsonb_array_elements(p_doelen) loop
    if coalesce(doel->>'omschrijving', '') <> '' and coalesce(doel->>'deadline', '') <> '' then
      insert into gpb_doelen (beoordeling_id, omschrijving, pijler, deadline)
      values (
        p_beoordeling_id,
        doel->>'omschrijving',
        (doel->>'pijler')::int,
        (doel->>'deadline')::date
      );
    end if;
  end loop;
end;
$$;

revoke execute on function save_gpb_medewerker_concept(uuid, jsonb, jsonb) from public;
grant execute on function save_gpb_medewerker_concept(uuid, jsonb, jsonb) to authenticated;

create or replace function save_gpb_leidinggevende_concept(
  p_beoordeling_id uuid,
  p_antwoorden jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b gpb_beoordelingen;
begin
  select * into b from gpb_beoordelingen where id = p_beoordeling_id;

  if b.id is null then
    raise exception 'Beoordeling niet gevonden';
  end if;
  -- zie submit_gpb_medewerker hierboven voor waarom "is distinct from" i.p.v. "<>"
  if auth.uid() is distinct from b.leidinggevende_id then
    raise exception 'Alleen de toegewezen leidinggevende mag dit invullen';
  end if;
  if b.status = 'definitief' then
    raise exception 'Beoordeling is definitief gemaakt en kan niet meer bewerkt worden';
  end if;
  if jsonb_array_length(p_antwoorden) <> 6 then
    raise exception 'Verwacht 6 pijlers met antwoorden';
  end if;

  update gpb_beoordelingen
  set leidinggevende_antwoorden = p_antwoorden
  where id = p_beoordeling_id;
end;
$$;

revoke execute on function save_gpb_leidinggevende_concept(uuid, jsonb) from public;
grant execute on function save_gpb_leidinggevende_concept(uuid, jsonb) to authenticated;

-- ============================================
-- GPB: goedkeuren en definitief maken (alleen HR/admin, in die volgorde —
-- zie de statuslevenscyclus in het principes-document).
-- ============================================
create or replace function keur_gpb_goed(p_beoordeling_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b gpb_beoordelingen;
begin
  -- zie create_gpb_beoordeling hierboven voor waarom "my_role() is null or"
  if my_role() is null or my_role() not in ('hr', 'admin') then
    raise exception 'Alleen HR of admin mag goedkeuren';
  end if;

  select * into b from gpb_beoordelingen where id = p_beoordeling_id;

  if b.id is null then
    raise exception 'Beoordeling niet gevonden';
  end if;

  if my_role() = 'admin' and b.medewerker_id <> auth.uid()
     and exists (select 1 from profiles where id = auth.uid() and gpb_others_restricted) then
    raise exception 'Je hebt geen rechten om andermans GPB-beoordeling goed te keuren';
  end if;

  if b.medewerker_ingevuld_at is null or b.leidinggevende_ingevuld_at is null then
    raise exception 'Beide beoordelingen moeten eerst ingevuld zijn';
  end if;
  if b.status <> 'concept' then
    raise exception 'Alleen een concept-beoordeling kan goedgekeurd worden';
  end if;

  update gpb_beoordelingen
  set status = 'goedgekeurd', goedgekeurd_by = auth.uid(), goedgekeurd_at = now()
  where id = p_beoordeling_id;
end;
$$;

revoke execute on function keur_gpb_goed(uuid) from public;

create or replace function maak_gpb_definitief(p_beoordeling_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b gpb_beoordelingen;
begin
  -- zie create_gpb_beoordeling hierboven voor waarom "my_role() is null or"
  if my_role() is null or my_role() not in ('hr', 'admin') then
    raise exception 'Alleen HR of admin mag definitief maken';
  end if;

  select * into b from gpb_beoordelingen where id = p_beoordeling_id;

  if b.id is null then
    raise exception 'Beoordeling niet gevonden';
  end if;

  if my_role() = 'admin' and b.medewerker_id <> auth.uid()
     and exists (select 1 from profiles where id = auth.uid() and gpb_others_restricted) then
    raise exception 'Je hebt geen rechten om andermans GPB-beoordeling definitief te maken';
  end if;

  if b.status <> 'goedgekeurd' then
    raise exception 'Alleen een goedgekeurde beoordeling kan definitief gemaakt worden';
  end if;

  update gpb_beoordelingen
  set status = 'definitief', definitief_at = now()
  where id = p_beoordeling_id;
end;
$$;

-- ============================================
-- GPB: HR/admin corrigeert scores/toelichtingen/doelen vanuit het
-- vergelijkingsscherm (Beheer-overzicht) — feedback was dat tijdens het
-- bespreken van een GPB (functioneringsgesprek) soms nog een score of
-- argumentatie moet worden bijgesteld, zonder dat de medewerker/
-- leidinggevende het formulier zelf opnieuw hoeft te openen. Bewust los
-- van submit_gpb_medewerker/leidinggevende (die blijven "ik dien mijn
-- eigen antwoorden in"; dit is "HR corrigeert bestaande antwoorden") en
-- raakt daarom ook bewust NIET de _ingevuld_at-tijdstempels aan. Net als
-- de leidinggevende-kant blijft dit mogelijk tot 'definitief', daarna is
-- het rapport vastgezet.
-- ============================================
create or replace function hr_update_gpb_medewerker(
  p_beoordeling_id uuid,
  p_antwoorden jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b gpb_beoordelingen;
begin
  -- zie create_gpb_beoordeling hierboven voor waarom "my_role() is null or"
  if my_role() is null or my_role() not in ('hr', 'admin') then
    raise exception 'Alleen HR of admin mag dit aanpassen';
  end if;

  select * into b from gpb_beoordelingen where id = p_beoordeling_id;

  if b.id is null then
    raise exception 'Beoordeling niet gevonden';
  end if;
  if b.status = 'definitief' then
    raise exception 'Beoordeling is definitief gemaakt en kan niet meer bewerkt worden';
  end if;
  if jsonb_array_length(p_antwoorden) <> 6 then
    raise exception 'Verwacht 6 pijlers met antwoorden';
  end if;

  update gpb_beoordelingen
  set medewerker_antwoorden = p_antwoorden
  where id = p_beoordeling_id;
end;
$$;

revoke execute on function hr_update_gpb_medewerker(uuid, jsonb) from public;
grant execute on function hr_update_gpb_medewerker(uuid, jsonb) to authenticated;

create or replace function hr_update_gpb_leidinggevende(
  p_beoordeling_id uuid,
  p_antwoorden jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b gpb_beoordelingen;
begin
  -- zie create_gpb_beoordeling hierboven voor waarom "my_role() is null or"
  if my_role() is null or my_role() not in ('hr', 'admin') then
    raise exception 'Alleen HR of admin mag dit aanpassen';
  end if;

  select * into b from gpb_beoordelingen where id = p_beoordeling_id;

  if b.id is null then
    raise exception 'Beoordeling niet gevonden';
  end if;
  if b.status = 'definitief' then
    raise exception 'Beoordeling is definitief gemaakt en kan niet meer bewerkt worden';
  end if;
  if jsonb_array_length(p_antwoorden) <> 6 then
    raise exception 'Verwacht 6 pijlers met antwoorden';
  end if;

  update gpb_beoordelingen
  set leidinggevende_antwoorden = p_antwoorden
  where id = p_beoordeling_id;
end;
$$;

revoke execute on function hr_update_gpb_leidinggevende(uuid, jsonb) from public;
grant execute on function hr_update_gpb_leidinggevende(uuid, jsonb) to authenticated;

create or replace function hr_update_gpb_doelen(
  p_beoordeling_id uuid,
  p_doelen jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b gpb_beoordelingen;
  doel jsonb;
begin
  -- zie create_gpb_beoordeling hierboven voor waarom "my_role() is null or"
  if my_role() is null or my_role() not in ('hr', 'admin') then
    raise exception 'Alleen HR of admin mag dit aanpassen';
  end if;

  select * into b from gpb_beoordelingen where id = p_beoordeling_id;

  if b.id is null then
    raise exception 'Beoordeling niet gevonden';
  end if;
  if b.status = 'definitief' then
    raise exception 'Beoordeling is definitief gemaakt en kan niet meer bewerkt worden';
  end if;

  delete from gpb_doelen where beoordeling_id = p_beoordeling_id;
  for doel in select * from jsonb_array_elements(p_doelen) loop
    insert into gpb_doelen (beoordeling_id, omschrijving, pijler, deadline)
    values (
      p_beoordeling_id,
      doel->>'omschrijving',
      (doel->>'pijler')::int,
      (doel->>'deadline')::date
    );
  end loop;
end;
$$;

revoke execute on function hr_update_gpb_doelen(uuid, jsonb) from public;
grant execute on function hr_update_gpb_doelen(uuid, jsonb) to authenticated;

-- ============================================
-- Bel Overzicht: belstatistieken per medewerker uit 3CX CDR-data
--
-- `call_daily_stats` wordt gevuld door aggregate_call_stats() hieronder,
-- aangeroepen door pg_cron job `aggregate-call-stats-15min` (elke 15 min,
-- voor zowel vandaag als gisteren — de ruwe 3CX-CDR-staging-tabellen
-- `cdroutput`/`cdrbilling` zelf zijn geen onderdeel van het applicatie-
-- schema en daarom hier niet gedocumenteerd). Alleen daadwerkelijk
-- gevoerde (beantwoorde) gesprekken tellen mee.
-- `call_weekly_stats`/`call_quarterly_stats` zijn views die daar automatisch
-- op groeperen — geen aparte opslag, geen aparte schrijf-policy nodig.
-- ============================================
create table call_daily_stats (
  user_id uuid not null references profiles(id) on delete cascade,
  call_date date not null,
  calls_in int not null default 0,
  calls_out int not null default 0,
  minutes_in numeric not null default 0,
  minutes_out numeric not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, call_date)
);

alter table call_daily_stats enable row level security;

-- Iedereen mag elkaars belcijfers zien, geen rol-restrictie: dit is
-- analytics, geen gevoelige profieldata.
create policy "authenticated read daily stats"
  on call_daily_stats for select
  to authenticated
  using (true);

-- Herberekent calls_in/calls_out/minutes_in/minutes_out per user_id voor
-- p_date, uit de ruwe cdroutput-CDR-legs (gekoppeld via cx_extension_mapping
-- hieronder). Uitsluitend aangeroepen door pg_cron (als postgres) — nooit
-- door client-code — vandaar de revoke hieronder i.p.v. een grant aan
-- authenticated/anon (tot 2026-09-21 stond dit nog open, gevonden door de
-- wekelijkse security-audit).
create or replace function aggregate_call_stats(p_date date)
returns void
language plpgsql
security definer
as $$
begin
  with legs as (
    select
      m.user_id,
      o.call_history_id,
      min(o.cdr_answered_at) as answered_at,
      max(o.cdr_ended_at) as ended_at,
      bool_or(o.source_dn_number = m.extension) as was_source
    from cdroutput o
    join cx_extension_mapping m
      on m.extension in (o.source_dn_number, o.destination_dn_number)
    where o.cdr_started_at::date = p_date
      and o.cdr_answered_at is not null
    group by m.user_id, o.call_history_id
  )
  insert into call_daily_stats (user_id, call_date, calls_in, calls_out, minutes_in, minutes_out, updated_at)
  select
    user_id,
    p_date,
    count(*) filter (where not was_source) as calls_in,
    count(*) filter (where was_source) as calls_out,
    coalesce(round(sum(extract(epoch from (ended_at - answered_at))) filter (where not was_source) / 60.0, 2), 0) as minutes_in,
    coalesce(round(sum(extract(epoch from (ended_at - answered_at))) filter (where was_source) / 60.0, 2), 0) as minutes_out,
    now()
  from legs
  group by user_id
  on conflict (user_id, call_date)
  do update set
    calls_in = excluded.calls_in,
    calls_out = excluded.calls_out,
    minutes_in = excluded.minutes_in,
    minutes_out = excluded.minutes_out,
    updated_at = now();
end;
$$;

revoke execute on function aggregate_call_stats(date) from public, anon, authenticated;
grant execute on function aggregate_call_stats(date) to service_role;

create view call_weekly_stats as
  select
    user_id,
    date_trunc('week', call_date::timestamptz)::date as week_start,
    sum(calls_in) as calls_in,
    sum(calls_out) as calls_out,
    sum(minutes_in) as minutes_in,
    sum(minutes_out) as minutes_out
  from call_daily_stats
  group by user_id, date_trunc('week', call_date::timestamptz);

create view call_quarterly_stats as
  select
    user_id,
    date_trunc('quarter', call_date::timestamptz)::date as quarter_start,
    sum(calls_in) as calls_in,
    sum(calls_out) as calls_out,
    sum(minutes_in) as minutes_in,
    sum(minutes_out) as minutes_out
  from call_daily_stats
  group by user_id, date_trunc('quarter', call_date::timestamptz);

-- Koppeling 3CX-toestel <-> profiel: bepaalt welke medewerkers in Bel
-- Overzicht getoond worden (de "roster"), los van of iemand die specifieke
-- dag/week/kwartaal daadwerkelijk gebeld heeft.
create table cx_extension_mapping (
  extension text primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table cx_extension_mapping enable row level security;

create policy "authenticated read extension mapping"
  on cx_extension_mapping for select
  to authenticated
  using (true);

-- Namen bij de belcijfers: RLS op profiles laat een gewone 'user' alleen de
-- eigen rij lezen (zie policies hierboven), dus zonder deze functie zou een
-- gewone gebruiker enkel de eigen naam kunnen tonen en voor collega's niets.
-- SECURITY DEFINER + grant aan alle authenticated gebruikers, en geeft
-- bewust ALLEEN id+naam terug (geen e-mail, rol of andere profielvelden) —
-- dezelfde aanpak als uitgebreid_emails()/yield_consultant_count().
create or replace function call_stats_profiel_namen()
returns table (id uuid, naam text)
language sql
security definer
stable
set search_path = public
as $$
  select id, naam from profiles;
$$;

grant execute on function call_stats_profiel_namen() to authenticated;

grant execute on function keur_gpb_goed(uuid) to authenticated;

-- ============================================
-- ONTWIKKELING (admin-only tabblad) — dev_projects + troubleshoot_items.
--
-- dev_projects: gedeelde project/idee-lijst voor Max en Nils. Volledig
-- admin-only (ALL-policy), geen aparte insert/update/delete-policies nodig.
-- uren_per_week/tijd_bespaard_minuten zijn gedeelde velden ("laatste
-- wijziging wint") — de _aangepast_door/_aangepast_at-kolommen worden
-- vanuit de client gezet bij het opslaan (zie devProjectsApi.js), niet via
-- een trigger, want alleen díe twee velden hebben dit nodig, niet elke
-- update van de rij.
--
-- troubleshoot_items: meldingen (ideeen/problemen) ingediend door ALLE
-- gebruikers via het floating helpdesk-widgetje (TroubleshootWidget.jsx),
-- maar alleen admin (Max/Nils/Amber) kan de inbox lezen en de status
-- wijzigen. vanuit_tool is het pathname op moment van indienen (bv.
-- '/tools/fee-checker'), puur informatief voor de admin-inbox.
-- ============================================
create table dev_projects (
  id uuid default gen_random_uuid() primary key,
  titel text not null,
  notities text,
  prioriteit text not null default 'midden' check (prioriteit in ('laag', 'midden', 'hoog')),
  deadline date,
  status text not null default 'open' check (status in ('open', 'bezig', 'klaar')),
  uren_per_week numeric,
  uren_per_week_aangepast_door uuid references profiles(id) on delete set null,
  uren_per_week_aangepast_at timestamptz,
  tijd_bespaard_minuten numeric,
  tijd_bespaard_aangepast_door uuid references profiles(id) on delete set null,
  tijd_bespaard_aangepast_at timestamptz,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table dev_projects is 'Gedeelde project/idee-lijst voor Max en Nils (BURG Apps intern tabblad). Alleen zichtbaar/bewerkbaar voor admin.';
comment on column dev_projects.uren_per_week is 'Gedeeld veld: door zowel Max als Nils aan te passen, laatste wijziging wint.';
comment on column dev_projects.tijd_bespaard_minuten is 'Geschatte tijdsbesparing per eenmalig gebruik door een consultant, in minuten. Gedeeld veld, laatste wijziging wint.';

alter table dev_projects enable row level security;

create policy "admin volledige toegang dev_projects"
  on dev_projects for all
  using (my_role() = 'admin')
  with check (my_role() = 'admin');

create table troubleshoot_items (
  id uuid default gen_random_uuid() primary key,
  type text not null check (type in ('idee', 'probleem')),
  omschrijving text not null,
  ingediend_door uuid references profiles(id) on delete set null,
  vanuit_tool text,
  status text not null default 'nieuw' check (status in ('nieuw', 'in_behandeling', 'afgehandeld')),
  created_at timestamptz not null default now()
);

comment on table troubleshoot_items is 'Meldingen (ideeen/problemen) ingediend door alle gebruikers via het helpdesk-widgetje. Alleen admin (Max/Nils/Amber) kan de inbox lezen en status wijzigen.';

alter table troubleshoot_items enable row level security;

create policy "iedereen kan een melding indienen"
  on troubleshoot_items for insert
  with check (auth.uid() = ingediend_door);

create policy "admin leest meldingen"
  on troubleshoot_items for select
  using (my_role() = 'admin');

create policy "admin wijzigt status meldingen"
  on troubleshoot_items for update
  using (my_role() = 'admin')
  with check (my_role() = 'admin');

-- Slack-notificatie bij een nieuwe troubleshoot-melding, via een Incoming
-- Webhook naar #developer-gods (Slack-app "BURG App Meldingen").
--
-- De webhook-URL staat NIET hier, maar in Supabase Vault onder de naam
-- 'troubleshoot_slack_webhook_url' — zelfde reden als BURG_JOBS_SERVICE_ROLE_KEY
-- niet in dit bestand staat: een geheim hoort niet in git. Eenmalig handmatig
-- gezet via SQL editor:
--   select vault.create_secret('<webhook-url>', 'troubleshoot_slack_webhook_url', '...');
-- Vereist ook eenmalig: create extension if not exists pg_net;
create or replace function notify_slack_troubleshoot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  webhook_url text;
  submitter_naam text;
  type_label text;
begin
  select decrypted_secret into webhook_url
  from vault.decrypted_secrets
  where name = 'troubleshoot_slack_webhook_url';

  if webhook_url is null then
    return new;
  end if;

  select naam into submitter_naam from profiles where id = new.ingediend_door;
  type_label := case new.type when 'idee' then 'Idee' when 'probleem' then 'Probleem' else new.type end;

  perform net.http_post(
    url := webhook_url,
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := jsonb_build_object(
      'text',
      format(
        E'*Nieuwe %s in BURG App*\nDoor: %s\nVanuit: %s\n\n%s\n\n<https://app.burgqhsse.nl/tools/dev-projecten|Bekijk in Ontwikkeling → Meldingen>',
        type_label,
        coalesce(submitter_naam, 'Onbekend'),
        coalesce(new.vanuit_tool, '-'),
        new.omschrijving
      )
    )
  );

  return new;
end;
$$;

-- Alleen ooit via de trigger hieronder aangeroepen, nooit rechtstreeks via
-- RPC -- zie de revoke-toelichting bij handle_new_user hogerop in dit
-- bestand voor waarom dit toch expliciet wordt afgesloten.
revoke execute on function notify_slack_troubleshoot() from public;

create trigger troubleshoot_items_notify_slack
  after insert on troubleshoot_items
  for each row
  execute function notify_slack_troubleshoot();

-- ============================================
-- NOTIFICATIES — generiek, persoonlijk notificatiesysteem voor de topbar
-- (NotificatiesMenu.jsx, voor ELKE ingelogde gebruiker, niet admin-only).
--
-- Eén rij = één notificatie voor één specifieke user_id. Wordt UITSLUITEND
-- geschreven door de triggers hieronder (op troubleshoot_items en
-- gpb_beoordelingen) — nooit direct vanuit de client, vandaar geen insert/
-- update-policy voor authenticated. `gelezen` wordt automatisch op true
-- gezet zodra de onderliggende brontoestand oplost (ticket niet meer
-- 'nieuw', GPB-timestamp ingevuld, GPB-status weg van 'concept') — er is
-- bewust GEEN handmatige "markeer als gelezen"-actie in de UI.
--
-- bron_tabel/bron_id zijn GEEN foreign key (kan niet: bron_tabel wisselt
-- per rij tussen troubleshoot_items/gpb_beoordelingen) — opruimen bij
-- verwijdering van de bronrij gebeurt daarom expliciet via een eigen
-- AFTER DELETE-trigger op gpb_beoordelingen (troubleshoot_items-rijen
-- worden door deze app nooit verwijderd, alleen van status gewisseld, dus
-- daar is geen cleanup-trigger voor nodig).
--
-- unique(user_id, bron_tabel, bron_id, type) + `on conflict do nothing` in
-- elke fan-out insert maakt alle triggers idempotent.
-- ============================================
create table notificaties (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  type text not null check (type in (
    'troubleshoot_nieuw',
    'gpb_medewerker_invullen',
    'gpb_leidinggevende_invullen',
    'gpb_wacht_op_goedkeuring'
  )),
  titel text not null,
  omschrijving text,
  link text,
  bron_tabel text not null,
  bron_id uuid not null,
  gelezen boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, bron_tabel, bron_id, type)
);

comment on table notificaties is 'Persoonlijk, generiek notificatiesysteem. Rijen worden uitsluitend door triggers geschreven (troubleshoot_items, gpb_beoordelingen); gelezen wordt automatisch gesynchroniseerd met de brontoestand, nooit handmatig door de gebruiker.';

create index notificaties_unread_idx on notificaties (user_id) where gelezen = false;
create index notificaties_bron_idx on notificaties (bron_tabel, bron_id);

alter table notificaties enable row level security;

create policy "gebruiker leest eigen notificaties"
  on notificaties for select
  using (auth.uid() = user_id);

-- Troubleshoot: fan-out naar alle actieve admins bij een nieuwe melding
-- (behalve naar de indiener zelf, als die toevallig admin is). Coëxisteert
-- met notify_slack_troubleshoot() hierboven — twee onafhankelijke AFTER
-- INSERT-triggers op dezelfde tabel.
create or replace function notify_notificaties_troubleshoot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  submitter_naam text;
  type_label text;
begin
  select naam into submitter_naam from profiles where id = new.ingediend_door;
  type_label := case new.type when 'idee' then 'Idee' when 'probleem' then 'Probleem' else new.type end;

  insert into notificaties (user_id, type, titel, omschrijving, link, bron_tabel, bron_id)
  select
    p.id,
    'troubleshoot_nieuw',
    format('%s van %s', type_label, coalesce(submitter_naam, 'onbekend')),
    new.omschrijving,
    '/tools/dev-projecten?tab=meldingen',
    'troubleshoot_items',
    new.id
  from profiles p
  where p.role = 'admin'
    and p.actief = true
    and (new.ingediend_door is null or p.id <> new.ingediend_door)
  on conflict (user_id, bron_tabel, bron_id, type) do nothing;

  return new;
end;
$$;

create trigger troubleshoot_items_notify_notificaties
  after insert on troubleshoot_items
  for each row
  execute function notify_notificaties_troubleshoot();

revoke execute on function notify_notificaties_troubleshoot() from public, anon, authenticated;

-- Troubleshoot: zodra status weg is uit 'nieuw', de bijbehorende
-- notificatie(s) op gelezen zetten.
create or replace function resolve_notificaties_troubleshoot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'nieuw' and new.status <> 'nieuw' then
    update notificaties
    set gelezen = true
    where bron_tabel = 'troubleshoot_items' and bron_id = new.id and not gelezen;
  end if;

  return new;
end;
$$;

create trigger troubleshoot_items_resolve_notificaties
  after update on troubleshoot_items
  for each row
  execute function resolve_notificaties_troubleshoot();

revoke execute on function resolve_notificaties_troubleshoot() from public, anon, authenticated;

-- GPB: bij aanmaken een persoonlijke notificatie voor zowel de medewerker
-- als de leidinggevende (elk alleen als het id niet null is).
create or replace function notify_notificaties_gpb_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.medewerker_id is not null then
    insert into notificaties (user_id, type, titel, omschrijving, link, bron_tabel, bron_id)
    values (
      new.medewerker_id,
      'gpb_medewerker_invullen',
      'Vul je GPB-zelfevaluatie in',
      format('Periode %s — %s', new.periode, new.afdeling),
      '/tools/gpb-beoordelingstool?tab=mijn',
      'gpb_beoordelingen',
      new.id
    )
    on conflict (user_id, bron_tabel, bron_id, type) do nothing;
  end if;

  if new.leidinggevende_id is not null then
    insert into notificaties (user_id, type, titel, omschrijving, link, bron_tabel, bron_id)
    values (
      new.leidinggevende_id,
      'gpb_leidinggevende_invullen',
      format('Vul beoordeling in voor %s', new.medewerker_naam),
      format('Periode %s — %s', new.periode, new.afdeling),
      '/tools/gpb-beoordelingstool?tab=team',
      'gpb_beoordelingen',
      new.id
    )
    on conflict (user_id, bron_tabel, bron_id, type) do nothing;
  end if;

  return new;
end;
$$;

create trigger gpb_beoordelingen_notify_insert
  after insert on gpb_beoordelingen
  for each row
  execute function notify_notificaties_gpb_insert();

revoke execute on function notify_notificaties_gpb_insert() from public, anon, authenticated;

-- GPB: resolve per kant zodra ingevuld, fan-out naar hr/admin zodra beide
-- kanten klaar zijn (status nog concept), en die hr/admin-notificaties
-- weer resolven zodra de status concept verlaat (goedgekeurd/definitief).
create or replace function sync_notificaties_gpb_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.medewerker_ingevuld_at is null and new.medewerker_ingevuld_at is not null then
    update notificaties
    set gelezen = true
    where bron_tabel = 'gpb_beoordelingen' and bron_id = new.id
      and type = 'gpb_medewerker_invullen' and not gelezen;
  end if;

  if old.leidinggevende_ingevuld_at is null and new.leidinggevende_ingevuld_at is not null then
    update notificaties
    set gelezen = true
    where bron_tabel = 'gpb_beoordelingen' and bron_id = new.id
      and type = 'gpb_leidinggevende_invullen' and not gelezen;
  end if;

  if new.medewerker_ingevuld_at is not null
     and new.leidinggevende_ingevuld_at is not null
     and new.status = 'concept' then
    insert into notificaties (user_id, type, titel, omschrijving, link, bron_tabel, bron_id)
    select
      p.id,
      'gpb_wacht_op_goedkeuring',
      format('GPB wacht op goedkeuring voor %s', new.medewerker_naam),
      format('Periode %s — %s', new.periode, new.afdeling),
      '/tools/gpb-beoordelingstool?tab=beheer',
      'gpb_beoordelingen',
      new.id
    from profiles p
    where p.role in ('hr', 'admin')
      and p.actief = true
      and p.gpb_goedkeuring_notificaties
    on conflict (user_id, bron_tabel, bron_id, type) do nothing;
  end if;

  if old.status = 'concept' and new.status <> 'concept' then
    update notificaties
    set gelezen = true
    where bron_tabel = 'gpb_beoordelingen' and bron_id = new.id
      and type = 'gpb_wacht_op_goedkeuring' and not gelezen;
  end if;

  return new;
end;
$$;

create trigger gpb_beoordelingen_sync_notificaties
  after update on gpb_beoordelingen
  for each row
  execute function sync_notificaties_gpb_update();

revoke execute on function sync_notificaties_gpb_update() from public, anon, authenticated;

-- GPB: bij verwijderen van een beoordeling de bijbehorende notificaties
-- opruimen (bron_id is geen FK, dus geen automatische cascade).
create or replace function cleanup_notificaties_gpb_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from notificaties where bron_tabel = 'gpb_beoordelingen' and bron_id = old.id;
  return old;
end;
$$;

create trigger gpb_beoordelingen_cleanup_notificaties
  after delete on gpb_beoordelingen
  for each row
  execute function cleanup_notificaties_gpb_delete();

revoke execute on function cleanup_notificaties_gpb_delete() from public, anon, authenticated;

-- zie de revoke-toelichting bij change_user_role hogerop in dit bestand
revoke execute on function maak_gpb_definitief(uuid) from public;
grant execute on function maak_gpb_definitief(uuid) to authenticated;

-- ============================================
-- KANDIDAAT MATCHER (open voor iedereen) — matching_runs + matching_resultaten
-- + bullhorn_session_cache.
--
-- Doel: een consultant zet in Bullhorn zelf een bulk-Notitie (actie
-- "Matching", tekst = het kale vacature-ID) op de kandidaten van een
-- boolean search; deze tool haalt die kandidaten op via die notitie
-- (zie getMatchingKandidatenViaNotitie in kandidaat-matcher/bullhorn.ts),
-- anonimiseert per kandidaat het CV/intake-veld (geen namen/mail/telefoon/
-- LinkedIn/postcode naar Claude — zie de kandidaat-matcher Edge Function
-- voor de anonimiseringslogica) en laat Claude scoren tegen de
-- vacaturetekst.
--
-- Notitie i.p.v. Tearsheet/distributielijst: een nieuwe Tearsheet is tot
-- ~1 week onzichtbaar voor het gedeelde REST-service-account (bevestigd
-- met Bullhorn support), Note is wél realtime zichtbaar. matching_runs
-- heette hiervoor tearsheet_id/tearsheet_naam - op 2026-08-26 hernoemd naar
-- vacature_id/vacature_naam toen op de Notitie-aanpak werd overgestapt.
--
-- Sinds 2026-08-27 open voor iedereen (zie toolRegistry.js minimumRole:
-- 'user' - was eerst 'manager', diezelfde dag nog verder verruimd).
-- Voorheen admin-only in afwachting van een AVG-/Bullhorn-rechten-gesprek
-- met Sam over bredere uitrol - dat gesprek is (nog) niet gevoerd, deze
-- uitbreiding was een expliciete keuze van de gebruiker om daar niet langer
-- op te wachten. Zie ook matcher-gebruik hieronder - de admin-only
-- gebruiksoverzicht-tool die er gelijk bij is gebouwd om dit te kunnen
-- volgen.
--
-- Een Edge Function-aanroep mag maar ~150s duren (Supabase's wall-clock-
-- limiet per invocatie, geldt op zowel Free als Pro voor een normale
-- request/response-aanroep — er is geen manier om dit te verhogen op een
-- gehost project). Daarom is het ophalen + scoren opgeknipt in een
-- "start-run" (maakt de rijen hieronder aan met status 'wacht') en een
-- herhaaldelijk aan te roepen "process-batch" (pakt een klein aantal
-- 'wacht'-rijen per keer) — zie kandidaat-matcher/index.ts.
-- ============================================
create table matching_runs (
  id uuid default gen_random_uuid() primary key,
  created_by uuid references profiles(id) on delete set null,
  created_by_naam text,
  vacature_id bigint not null,
  vacature_naam text not null,
  vacaturetekst text not null,
  aantal_kandidaten int not null default 0,
  status text not null default 'bezig' check (status in ('bezig', 'klaar', 'fout', 'kostenlimiet')),
  foutmelding text,
  geschatte_kosten_usd numeric not null default 0,
  created_at timestamptz not null default now()
);

comment on table matching_runs is 'Eén matching-run = één vacature + vacaturetekst-combinatie. aantal_kandidaten is het totaal bij start-run, voor de voortgangsindicatie in de UI. geschatte_kosten_usd is de lopende som van alle Claude-aanroepen (zie MAX_KOSTEN_PER_RUN_USD in kandidaat-matcher/index.ts) — status ''kostenlimiet'' betekent dat de run is gestopt omdat dat bedrag is bereikt, met resterende kandidaten op ''fout'' gezet i.p.v. verder te scoren.';

alter table matching_runs enable row level security;

create policy "iedereen toegang matching_runs"
  on matching_runs for all
  using (my_role() in ('admin','manager','hr','user'))
  with check (my_role() in ('admin','manager','hr','user'));

create table matching_resultaten (
  id uuid default gen_random_uuid() primary key,
  run_id uuid not null references matching_runs(id) on delete cascade,
  bullhorn_id bigint not null,
  score int check (score between 0 and 100),
  onderbouwing text,
  status text not null default 'wacht' check (status in ('wacht', 'bezig', 'klaar', 'fout')),
  foutmelding text,
  bullhorn_status text,
  salaris_band text,
  uurtarief_band text,
  -- dateAdded van de meest recente bruikbare Intake-notitie (zelfde notitie
  -- als sync_candidates.py in het "description"-veld verwerkt) - puur zodat
  -- de consultant kan zien hoe vers de intake-info is; gaat nooit naar Claude.
  laatste_intake_datum timestamptz,
  -- Welk Claude-model / welke QHSSE_SYSTEEM_PROMPT-versie (zie claude.ts)
  -- deze rij produceerde - puur traceerbaarheid, nooit gebruikt voor filtering
  -- of scoring. Null voor rijen van vóór deze kolom bestond.
  model text,
  prompt_versie text,
  -- true bij een afgekapte Claude-respons (stop_reason=max_tokens) of een
  -- mislukte JSON-parse (RANK_FALLBACK-tekst) - in beide gevallen is de score
  -- minder betrouwbaar dan een normaal geslaagde beoordeling. Getoond als
  -- ⚠️-indicator in KandidaatMatcher.jsx, geen aparte goedkeuringsstap.
  laag_vertrouwen boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, bullhorn_id)
);

comment on table matching_resultaten is 'Eén rij per kandidaat op de tearsheet van een matching-run. Naam/overige PII staan hier bewust NIET in — alleen bullhorn_id, de score en de onderbouwing (die zelf ook nooit de kandidaatnaam bevat, want Claude zag alleen het geanonimiseerde profiel). De consultant klikt door naar Bullhorn zelf voor de naam. bullhorn_status/salaris_band/uurtarief_band zijn puur voor de filterbalk in de UI — gaan NOOIT naar Claude (zie kandidaat-matcher/index.ts en salarisfilter.ts): de consultant beoordeelt salaris/status zelf, Claude scoort uitsluitend op de inhoudelijke match tussen description en vacaturetekst. model/prompt_versie/laag_vertrouwen zijn traceerbaarheids-/vertrouwensvelden (zie kandidaat-matcher/claude.ts) - nooit naar Claude, puur voor de consultant en voor debugging van toekomstige promptwijzigingen.';

create index matching_resultaten_run_status_idx on matching_resultaten (run_id, status);

alter table matching_resultaten enable row level security;

create policy "iedereen toegang matching_resultaten"
  on matching_resultaten for all
  using (my_role() in ('admin','manager','hr','user'))
  with check (my_role() in ('admin','manager','hr','user'));

-- Bullhorn-sessies leven ~20 minuten; een run bestaat uit meerdere losse
-- process-batch-aanroepen (elk een eigen Edge Function-invocatie zonder
-- gedeeld geheugen), dus wordt de sessie hier gecachet i.p.v. elke keer
-- opnieuw in te loggen. Enkele-rij-tabel (id vastgezet op 1). Bewust GEEN
-- RLS-policies (tabel blijft met RLS aan maar zonder policies = dicht voor
-- anon/authenticated) — alleen de Edge Function met de service-role-key
-- mag dit lezen/schrijven, een Bullhorn-sessietoken hoort nooit naar een
-- client te kunnen lekken.
create table bullhorn_session_cache (
  id smallint primary key default 1 check (id = 1),
  bh_rest_token text,
  rest_url text,
  verloopt_op timestamptz,
  updated_at timestamptz not null default now()
);

comment on table bullhorn_session_cache is 'Eén-rij cache van de Bullhorn REST-sessie (BhRestToken/restUrl), alleen gebruikt door de kandidaat-matcher Edge Function via de service-role-client. Geen RLS-policies: ontoegankelijk voor anon/authenticated.';

alter table bullhorn_session_cache enable row level security;

-- Pakt atomisch een batch 'wacht'-rijen van een run en zet ze op 'bezig' —
-- FOR UPDATE SKIP LOCKED voorkomt dat twee gelijktijdige process-batch-
-- aanroepen (bv. de browser die een vorige aanroep nog niet had verwerkt
-- vóór een volgende) dezelfde kandidaat dubbel oppakken. Uitsluitend
-- aangeroepen door de Edge Function via de service-role-client, vandaar de
-- revoke hieronder i.p.v. een grant aan authenticated.
create or replace function matching_pak_batch(p_run_id uuid, p_aantal int)
returns setof matching_resultaten
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
    update matching_resultaten
    set status = 'bezig', updated_at = now()
    where id in (
      select id from matching_resultaten
      where run_id = p_run_id and status = 'wacht'
      order by created_at
      limit p_aantal
      for update skip locked
    )
    returning *;
end;
$$;

revoke execute on function matching_pak_batch(uuid, int) from public, anon, authenticated;
grant execute on function matching_pak_batch(uuid, int) to service_role;

-- Telt geschatte_kosten_usd atomisch op (i.p.v. lees-optel-schrijf vanuit de
-- Edge Function) — voorkomt dat twee gelijktijdige process-batch-aanroepen
-- voor dezelfde run elkaars kostenupdate overschrijven. Geeft de bijgewerkte
-- rij terug zodat de Edge Function meteen tegen MAX_KOSTEN_PER_RUN_USD kan
-- checken zonder een aparte select.
create or replace function matching_verhoog_kosten(p_run_id uuid, p_delta_usd numeric)
returns setof matching_runs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
    update matching_runs
    set geschatte_kosten_usd = geschatte_kosten_usd + p_delta_usd
    where id = p_run_id
    returning *;
end;
$$;

revoke execute on function matching_verhoog_kosten(uuid, numeric) from public, anon, authenticated;
grant execute on function matching_verhoog_kosten(uuid, numeric) to service_role;

-- ============================================
-- Call Insights: automatisch gedetecteerde Bullhorn-veldwijzigingen uit
-- 3CX-gesprekssamenvattingen
--
-- Databron `recordings`/`recording_participant` wordt (net als
-- `cdroutput`/`cdrbilling` bij Bel Overzicht) buiten dit bestand om gevuld —
-- 3CX's eigen "Data Connectors"-feature schrijft die elke 15 minuten
-- rechtstreeks naar deze database (summary/transcription per gesprek, via
-- Grok-transcriptie ingesteld in 3CX zelf). Die tabellen horen niet bij het
-- applicatieschema en worden hier bewust niet gedocumenteerd.
-- ============================================

-- Eén rij per verwerkte recording (ongeacht of dat een kandidaat-match of
-- suggesties opleverde) — voorkomt dat de cron dezelfde recording telkens
-- opnieuw oppakt en opnieuw Claude-kosten maakt. skipped_reason
-- 'meerdere_kandidaten' + kandidaat_kandidaten: het externe nummer matchte
-- meer dan één kandidaat in de telefoon-index — i.p.v. gokken laat de UI de
-- consultant zelf kiezen (zie resolveCandidateMatch-actie), waarna Claude
-- alsnog draait voor de gekozen kandidaat.
create table call_insights_processed (
  recording_url text primary key,
  processed_at timestamptz not null default now(),
  bullhorn_candidate_id bigint,
  user_id uuid references profiles(id),
  skipped_reason text,
  kandidaat_kandidaten bigint[],
  call_started_at timestamptz
);

comment on table call_insights_processed is 'Bijhoudt welke recordings (uit de 3CX-staging-tabel recordings) al door de call-insights Edge Function verwerkt zijn, ook als dat geen kandidaat-match of suggesties opleverde (skipped_reason). kandidaat_kandidaten is alleen gevuld bij skipped_reason=''meerdere_kandidaten'' (ambigue telefoonnummer-match, wacht op keuze van de consultant). Select is toegestaan voor de eigen rijen (auth.uid() = user_id) zodat de UI openstaande keuzes kan tonen; alle schrijfacties lopen via de Edge Function (service-role).';

alter table call_insights_processed enable row level security;

create policy "consultant leest eigen verwerkte recordings"
  on call_insights_processed for select
  to authenticated
  using (auth.uid() = user_id);

-- MVP: Call Insights is voorlopig admin-only (zie toolRegistry.js) en een
-- admin bekijkt daarbij de gekozen actieve consultant, niet noodzakelijk
-- zichzelf — vandaar deze aparte admin-policy naast de eigen-rijen-policy
-- hierboven (policies worden OR-gecombineerd).
create policy "admin leest alle verwerkte recordings"
  on call_insights_processed for select
  to authenticated
  using (my_role() = 'admin');

-- Eén rij per voorgestelde veldwijziging (een gesprek kan tot 5 rijen
-- opleveren, één per gedetecteerd veld). field_name is de letterlijke
-- Bullhorn-veldnaam (customText22/customText11/address/employmentPreference/
-- status) — zie call-insights Edge Function voor de vaste veldenlijst en
-- picklist-opties.
create table call_field_suggestions (
  id uuid default gen_random_uuid() primary key,
  recording_url text not null references call_insights_processed(recording_url) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  bullhorn_candidate_id bigint not null,
  call_started_at timestamptz not null,
  field_name text not null check (field_name in ('customText22', 'customText11', 'address', 'employmentPreference', 'status')),
  current_value text,
  suggested_value text not null,
  quote text,
  -- Kopie van recordings.summary op het moment van detectie (niet een live
  -- join, want recordings is een 3CX-staging-tabel buiten RLS-bereik van
  -- gewone gebruikers) — puur zodat de consultant in de UI het volledige
  -- gesprek kan lezen, niet alleen het korte citaat per veld.
  call_summary text,
  status text not null default 'pending' check (status in ('pending', 'geaccepteerd', 'afgewezen')),
  final_value text,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table call_field_suggestions is 'Eén rij per door Claude gedetecteerde, nog te beoordelen Bullhorn-veldwijziging uit een 3CX-gesprek. user_id is de consultant die het gesprek voerde (via cx_extension_mapping), niet de kandidaat. Statuswijzigingen (accepteren/afwijzen) lopen uitsluitend via de call-insights Edge Function — die schrijft ook meteen naar Bullhorn bij accepteren — vandaar geen insert/update-policy voor authenticated, alleen select.';

create index call_field_suggestions_user_status_idx on call_field_suggestions (user_id, status);

alter table call_field_suggestions enable row level security;

create policy "consultant leest eigen suggesties"
  on call_field_suggestions for select
  to authenticated
  using (auth.uid() = user_id);

-- Zelfde reden als bij call_insights_processed hierboven: MVP is admin-only,
-- admin bekijkt de gekozen actieve consultant, niet per se zichzelf.
create policy "admin leest alle suggesties"
  on call_field_suggestions for select
  to authenticated
  using (my_role() = 'admin');

-- Bel Overzicht: verwerkings-/suggestiestatistieken per consultant over een
-- periode, voor callInsightsApi.js (admin-gebruiksoverzicht). Bewust GEEN
-- SECURITY DEFINER: draait als de aanroeper, dus de onderliggende selects op
-- call_insights_processed/call_field_suggestions blijven zelf door RLS
-- begrensd (geen risico op een cross-user datalek via deze functie). Bestond
-- al live maar ontbrak nog in dit bestand (schema drift, gevonden tijdens de
-- 2026-09-23-audit, samen met set_updated_at hierboven).
create or replace function call_insights_gebruik_overzicht(p_vanaf timestamptz, p_tot timestamptz)
returns table(user_id uuid, verwerkt bigint, kosten_usd numeric, suggesties bigint, geaccepteerd bigint, afgewezen bigint, pending bigint)
language sql
stable
set search_path = public
as $$
  select
    coalesce(p.user_id, s.user_id) as user_id,
    coalesce(p.verwerkt, 0) as verwerkt,
    coalesce(p.kosten_usd, 0) as kosten_usd,
    coalesce(s.suggesties, 0) as suggesties,
    coalesce(s.geaccepteerd, 0) as geaccepteerd,
    coalesce(s.afgewezen, 0) as afgewezen,
    coalesce(s.pending, 0) as pending
  from (
    select user_id, count(*) as verwerkt, coalesce(sum(kosten_usd), 0) as kosten_usd
    from call_insights_processed
    where skipped_reason is distinct from 'historische_backlog_overgeslagen'
      and call_started_at >= p_vanaf and call_started_at < p_tot
    group by user_id
  ) p
  full outer join (
    select
      user_id,
      count(*) as suggesties,
      count(*) filter (where status = 'geaccepteerd') as geaccepteerd,
      count(*) filter (where status = 'afgewezen') as afgewezen,
      count(*) filter (where status = 'pending') as pending
    from call_field_suggestions
    where call_started_at >= p_vanaf and call_started_at < p_tot
    group by user_id
  ) s on s.user_id = p.user_id;
$$;

-- LEGACY, NIET MEER GEBRUIKT (sinds 2026-09-16, commit "verwijder overbodige
-- extensie-uitsluiting + legacy MVP-picker"): call_insights_nieuwe_recordings
-- hieronder filtert nu op profiles.team = 'consultant' i.p.v. deze
-- uitsluitingslijst. Tabel bewust niet gedropt (geen destructieve migratie),
-- maar wordt nergens meer gelezen of geschreven — kan ooit opgeruimd worden.
create table call_insights_uitgesloten_extensies (
  extension text primary key,
  reden text,
  created_at timestamptz not null default now()
);

comment on table call_insights_uitgesloten_extensies is 'LEGACY (sinds 2026-09-16, vervangen door profiles.team) - niet meer gelezen door call_insights_nieuwe_recordings. Bewust niet gedropt, geen destructieve migratie.';

alter table call_insights_uitgesloten_extensies enable row level security;

create policy "admin volledige toegang call_insights_uitgesloten_extensies"
  on call_insights_uitgesloten_extensies for all
  using (my_role() = 'admin')
  with check (my_role() = 'admin');

-- LEGACY, NIET MEER GEBRUIKT (zie call_insights_uitgesloten_extensies
-- hierboven) — Call Insights verwerkt sinds 2026-09-16 alle actieve
-- consultants tegelijk (profiles.team = 'consultant'), niet meer één MVP-
-- consultant via deze tabel.
create table call_insights_mvp_actieve_consultant (
  id smallint primary key default 1 check (id = 1),
  user_id uuid references profiles(id),
  updated_at timestamptz not null default now()
);

comment on table call_insights_mvp_actieve_consultant is 'LEGACY (sinds 2026-09-16, vervangen door profiles.team) - niet meer gelezen door call_insights_nieuwe_recordings. Bewust niet gedropt, geen destructieve migratie.';

alter table call_insights_mvp_actieve_consultant enable row level security;

create policy "admin volledige toegang call_insights_mvp_actieve_consultant"
  on call_insights_mvp_actieve_consultant for all
  using (my_role() = 'admin')
  with check (my_role() = 'admin');

-- Voorkomt overlappende cron-runs van syncNewCalls/syncRecordingsFromXapi
-- (2026-09-16, na een live race condition: twee gelijktijdige runs gaven een
-- dubbele call_field_suggestions-rij + een gemiste recording). Rij-gebaseerde
-- lock i.p.v. pg_advisory_lock, omdat sessie-gebonden advisory locks
-- onbetrouwbaar zijn door PgBouncer-connection-pooling. Pre-geseed met
-- precies twee rijen ('syncNewCalls'/'syncRecordingsFromXapi') —
-- call_insights_probeer_lock werkt alleen voor namen die al een rij hebben.
-- Uitsluitend gebruikt door de call-insights Edge Function via de
-- service-role-client, die RLS altijd omzeilt — RLS staat daarom aan zonder
-- policies (zelfde patroon als bullhorn_session_cache/cdroutput hieronder/
-- hierboven). Tot 2026-09-21 stond RLS hier nog uit, met volledige
-- lees/schrijftoegang voor anon — gevonden door de wekelijkse security-audit.
create table call_insights_sync_lock (
  naam text primary key,
  vergrendeld_tot timestamptz
);

alter table call_insights_sync_lock enable row level security;

create or replace function call_insights_probeer_lock(p_naam text, p_duur_seconden int)
returns boolean
language plpgsql
as $$
declare
  aantal int;
begin
  update call_insights_sync_lock
  set vergrendeld_tot = now() + make_interval(secs => p_duur_seconden)
  where naam = p_naam and (vergrendeld_tot is null or vergrendeld_tot < now());
  get diagnostics aantal = row_count;
  return aantal > 0;
end;
$$;

create or replace function call_insights_geef_lock_vrij(p_naam text)
returns void
language sql
as $$
  update call_insights_sync_lock set vergrendeld_tot = null where naam = p_naam;
$$;

revoke execute on function call_insights_probeer_lock(text, int) from public, anon, authenticated;
revoke execute on function call_insights_geef_lock_vrij(text) from public, anon, authenticated;
grant execute on function call_insights_probeer_lock(text, int) to service_role;
grant execute on function call_insights_geef_lock_vrij(text) to service_role;

-- Vindt nieuwe, nog niet verwerkte recordings + bepaalt welke deelnemer de
-- interne consultant is (via cx_extension_mapping) en welke het externe
-- nummer is. Uitsluitend aangeroepen door de call-insights Edge Function via
-- de service-role-client (net als matching_pak_batch), vandaar de revoke
-- hieronder i.p.v. een grant aan authenticated. `distinct on` omdat een
-- recording in theorie meerdere externe deelnemers kan hebben
-- (conferentiegesprek) — we nemen dan bewust maar één rij per recording.
-- Filtert op profiles.team = 'consultant' (en actief) i.p.v. de oude
-- call_insights_uitgesloten_extensies/call_insights_mvp_actieve_consultant
-- hierboven (sinds 2026-09-16, zie set_user_team en de comments bij die tabellen).
create or replace function call_insights_nieuwe_recordings(p_limiet int)
returns table (
  recording_url text,
  start_time timestamptz,
  summary text,
  user_id uuid,
  extern_nummer text
)
language sql
security definer
stable
set search_path = public
as $$
  select sub.recording_url, sub.start_time, sub.summary, sub.user_id, sub.extern_nummer
  from (
    select distinct on (r.recording_url)
      r.recording_url,
      r.start_time,
      r.summary,
      m.user_id,
      extern.caller_number as extern_nummer
    from recordings r
    join recording_participant intern
      on intern.fk_recording_url = r.recording_url
    join cx_extension_mapping m
      on m.extension = intern.dn
    join recording_participant extern
      on extern.fk_recording_url = r.recording_url
      and extern.cdr_participant_id is distinct from intern.cdr_participant_id
    where r.summary is not null
      and length(r.summary) > 20
      and exists (
        select 1 from profiles p
        where p.id = m.user_id and p.team = 'consultant' and p.actief
      )
      and not exists (
        select 1 from call_insights_processed p where p.recording_url = r.recording_url
      )
    order by r.recording_url, r.start_time
  ) sub
  -- Nieuwste eerst (sinds 2026-09-18, was chronologisch oudste-eerst — zie
  -- bugfix hieronder). Bij oudste-eerst pakte elke batch van p_limiet steeds
  -- dezelfde al-lang-onopgeloste "geen match"-recordings (die 24u lang
  -- herhaald geprobeerd worden, zie call_insights_processed/GEEN_MATCH_RETRY_
  -- PERIODE_MS in de Edge Function) zodra de wachtrij groter werd dan
  -- p_limiet — nieuwe, mogelijk wél te matchen recordings kwamen daardoor
  -- nooit meer aan bod (live bevestigd: 59 vastzittende recordings van de
  -- vorige dag blokkeerden alle 18 nieuwe recordings van de huidige dag).
  -- Nieuwste-eerst garandeert dat vers binnengekomen recordings altijd
  -- voorrang krijgen; de restcapaciteit van elke batch ruimt de oude
  -- achterstand alsnog op (of die verloopt vanzelf na 24u) — MAAR zie de
  -- spiegelbeeld-bug hieronder bij call_insights_verlopen_recordings.
  order by sub.start_time desc
  limit p_limiet;
$$;

revoke execute on function call_insights_nieuwe_recordings(int) from public, anon, authenticated;
grant execute on function call_insights_nieuwe_recordings(int) to service_role;

-- Spiegelbeeld van de nieuwste-eerst-fix hierboven, gevonden door de
-- wekelijkse geautomatiseerde verificatie-routine (2026-09-18, 15:00 run):
-- zodra de instroom van nieuwe recordings de batchgrootte (SYNC_BATCH_SIZE)
-- structureel overtreft, bereiken de oudste, allang-24u-verlopen recordings
-- de hoofdlus in syncNewCalls nooit meer — en dus ook nooit de
-- 'geen_match'-afschrijving die daar gebeurt zodra GEEN_MATCH_RETRY_PERIODE_MS
-- is verstreken. Ze bleven zo voor altijd onverwerkt ÉN ongemarkeerd hangen
-- (live bevestigd: 38 recordings van vóór vandaag, 31 daarvan >24u oud).
-- Losstaande, ongelimiteerde "veeg"-functie specifiek voor alles voorbij de
-- retry-termijn (p_voor), los van de nieuwste-eerst-volgorde/batchgrootte
-- hierboven — syncNewCalls roept deze apart aan en verwerkt het resultaat
-- via dezelfde hoofdlus (index.ts, VERLOPEN_SWEEP_BATCH_SIZE = 200). Kost
-- vrijwel niets: alleen een telefoon-index-lookup per item, geen Bullhorn/
-- Claude-aanroep tenzij een gesprek alsnog matcht.
create or replace function call_insights_verlopen_recordings(p_voor timestamptz, p_limiet int)
returns table (
  recording_url text,
  start_time timestamptz,
  summary text,
  user_id uuid,
  extern_nummer text
)
language sql
security definer
stable
set search_path = public
as $$
  select sub.recording_url, sub.start_time, sub.summary, sub.user_id, sub.extern_nummer
  from (
    select distinct on (r.recording_url)
      r.recording_url,
      r.start_time,
      r.summary,
      m.user_id,
      extern.caller_number as extern_nummer
    from recordings r
    join recording_participant intern
      on intern.fk_recording_url = r.recording_url
    join cx_extension_mapping m
      on m.extension = intern.dn
    join recording_participant extern
      on extern.fk_recording_url = r.recording_url
      and extern.cdr_participant_id is distinct from intern.cdr_participant_id
    where r.summary is not null
      and length(r.summary) > 20
      and r.start_time < p_voor
      and exists (
        select 1 from profiles p
        where p.id = m.user_id and p.team = 'consultant' and p.actief
      )
      and not exists (
        select 1 from call_insights_processed p where p.recording_url = r.recording_url
      )
    order by r.recording_url, r.start_time
  ) sub
  order by sub.start_time
  limit p_limiet;
$$;

revoke execute on function call_insights_verlopen_recordings(timestamptz, int) from public, anon, authenticated;
grant execute on function call_insights_verlopen_recordings(timestamptz, int) to service_role;

-- Eigen genormaliseerde telefoonnummer-index van Bullhorn-kandidaten, om de
-- telefoon->kandidaat-matching in call-insights te doen. NIET via een live
-- Bullhorn search/Candidate-aanroep per gesprek: bleek tijdens bouwen dat
-- phone/phone2/phone3 in deze Bullhorn-instance exact-match (geen wildcards)
-- geïndexeerd zijn, en de opgeslagen waarden zelf rommelig zijn (bv. spaties
-- tussen elk cijfer) - een live substring/wildcard-zoekopdracht werkt daardoor
-- niet betrouwbaar. In plaats daarvan wordt deze tabel periodiek (dagelijkse
-- cron) volledig ververst vanuit een paginated bulk-fetch van alle
-- kandidaten (id,phone,phone2,phone3,workPhone), zelf genormaliseerd
-- (laatste 9 cijfers) — zie call-insights/phoneIndex.ts.
create table bullhorn_candidate_phone_index (
  normalized_phone text not null,
  bullhorn_candidate_id bigint not null,
  updated_at timestamptz not null default now(),
  primary key (normalized_phone, bullhorn_candidate_id)
);

comment on table bullhorn_candidate_phone_index is 'Genormaliseerde (laatste 9 cijfers) telefoonnummer->kandidaat-index, periodiek volledig herbouwd door call-insights (actie refreshPhoneIndex). Eén normalized_phone kan naar meerdere kandidaten wijzen (gedeeld nummer) - call-insights behandelt dat als ambigu en slaat de match over. Alleen de Edge Function (service-role) mag hier bij.';

create index bullhorn_candidate_phone_index_phone_idx on bullhorn_candidate_phone_index (normalized_phone);

alter table bullhorn_candidate_phone_index enable row level security;

-- ============================================================
-- EXTERN ZOEKEN (admin-only, testfase) — extern_zoeken_opdrachten + extern_zoeken_resultaten
-- ============================================================
-- Externe search via LinkedIn Recruiter. Een opdracht = één vacature + de
-- (door de consultant gecontroleerde) zoekopdracht uit extern-zoeken/claude.ts.
-- De BURG Chrome-extensie voert die uit in Recruiter en schrijft per gevonden
-- profiel een resultaat-rij; de Edge Function extern-zoeken scoort ze.
-- recruiter_id is het versleutelde Recruiter-profiel-ID (/talent/profile/AEMAA…),
-- géén openbare LinkedIn-URL. kaart bevat de uitgelezen gegevens van het
-- resultatenkaartje (naam, kopregel, locatie, ervaring) — nodig voor scoren en
-- het persoonlijke bericht; alleen admins kunnen dit lezen.

create table extern_zoeken_opdrachten (
  id uuid default gen_random_uuid() primary key,
  created_by uuid references profiles(id) on delete set null default auth.uid(),
  vacature_id text,
  vacaturetekst text not null,
  strategie jsonb not null,
  recruiter_project_id text,
  doel_aantal int not null default 200,
  status text not null default 'concept' check (status in ('concept', 'bezig', 'klaar', 'gestopt', 'fout')),
  foutmelding text,
  geschatte_kosten_usd numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table extern_zoeken_opdrachten is 'Eén Extern Zoeken-opdracht = één vacature + zoekopdracht (strategie, bewerkt door de consultant). recruiter_project_id wordt door de extensie ingevuld zodra het project in Recruiter is aangemaakt. doel_aantal = gewenste pipelinegrootte (standaard 200).';

alter table extern_zoeken_opdrachten enable row level security;

create policy "admin toegang extern_zoeken_opdrachten"
  on extern_zoeken_opdrachten for all
  using (my_role() = 'admin')
  with check (my_role() = 'admin');

create table extern_zoeken_resultaten (
  id uuid default gen_random_uuid() primary key,
  opdracht_id uuid not null references extern_zoeken_opdrachten(id) on delete cascade,
  recruiter_id text not null,
  kaart jsonb not null,
  in_bullhorn boolean not null default false,
  aantal_berichten int not null default 0,
  aantal_projecten int not null default 0,
  score int check (score between 0 and 100),
  onderbouwing text,
  twijfel boolean not null default false,
  engels boolean,
  status text not null default 'gevonden' check (status in ('gevonden', 'gescoord', 'toegevoegd', 'overgeslagen', 'bericht_klaar', 'verzonden', 'fout')),
  bericht text,
  foutmelding text,
  model text,
  prompt_versie text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (opdracht_id, recruiter_id)
);

comment on table extern_zoeken_resultaten is 'Eén rij per gevonden Recruiter-profiel binnen een opdracht. in_bullhorn/aantal_berichten/aantal_projecten komen van de activiteitregel op het resultatenkaartje (Recruiter-Bullhorn-koppeling). twijfel = scoreband waarin de consultant zelf beslist.';

create index extern_zoeken_resultaten_opdracht_idx on extern_zoeken_resultaten (opdracht_id, status);

alter table extern_zoeken_resultaten enable row level security;

create policy "admin toegang extern_zoeken_resultaten"
  on extern_zoeken_resultaten for all
  using (my_role() = 'admin')
  with check (my_role() = 'admin');

-- Bewaartermijn Extern Zoeken (AVG, afgesproken 2026-09-23): de resultaten
-- (namen/profielgegevens uit LinkedIn) worden 30 dagen na het afronden van een
-- opdracht verwijderd; de opdracht zelf (vacature + zoekopdracht, geen
-- persoonsgegevens) blijft staan. Vangnet: resultaten van een opdracht die nooit
-- is afgerond, verdwijnen na 60 dagen. afgerond_op wordt gezet door een trigger
-- zodra de status naar klaar/gestopt/fout gaat.
alter table extern_zoeken_opdrachten add column afgerond_op timestamptz;

create or replace function extern_zoeken_zet_afgerond_op()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  if new.status in ('klaar', 'gestopt', 'fout') and new.afgerond_op is null then
    new.afgerond_op := now();
  elsif new.status in ('concept', 'bezig') then
    new.afgerond_op := null;
  end if;
  return new;
end;
$$;

create trigger extern_zoeken_opdrachten_afgerond_op
  before update on extern_zoeken_opdrachten
  for each row execute function extern_zoeken_zet_afgerond_op();

select cron.schedule(
  'extern-zoeken-bewaartermijn',
  '15 3 * * *',
  $$
    delete from extern_zoeken_resultaten r
    using extern_zoeken_opdrachten o
    where r.opdracht_id = o.id
      and (o.afgerond_op < now() - interval '30 days' or r.created_at < now() - interval '60 days');
  $$
);

alter table extern_zoeken_opdrachten add column voortgang text;
alter table extern_zoeken_opdrachten add column aantal_resultaten text;
comment on column extern_zoeken_opdrachten.voortgang is 'Laatste statusregel van de BURG-extensie (bijv. "Filters invullen: locaties"), live getoond in BURG Apps.';
comment on column extern_zoeken_opdrachten.aantal_resultaten is 'Aantal resultaten zoals Recruiter het toont na het invullen van de filters (tekst, bijv. "487" of "2,2K+").';

-- Extern Zoeken via Claude in Chrome (2026-09-24): verbruik van het Claude-
-- abonnement per opdracht. Claude leest claude.ai/settings/usage aan het begin
-- en eind van elke fase (zoeken, later inmails) en meldt die percentages terug.
alter table extern_zoeken_opdrachten add column verbruik jsonb not null default '[]'::jsonb;
comment on column extern_zoeken_opdrachten.verbruik is 'Metingen van het Claude-abonnementsverbruik (claude.ai/settings/usage) door Claude in Chrome: [{fase, moment start|eind, sessie_pct, week_pct, sessie_reset, gemeten_op}]. fase = zoeken, later ook inmails. Verschil eind-start = verbruik van die fase (percentage van de 5-uurs- resp. weeklimiet; ander gelijktijdig gebruik op hetzelfde account telt mee).';

-- Extern Zoeken fase berichten (2026-09-24): Claude in Chrome schrijft en
-- verstuurt InMails aan de pipeline. Eerder bericht < 3 maanden = eerst de
-- keuze van de consultant (bericht_klaar → bericht_goedgekeurd/_afgewezen).
alter table extern_zoeken_opdrachten add column fase text not null default 'zoeken' check (fase in ('zoeken', 'berichten'));
comment on column extern_zoeken_opdrachten.fase is 'zoeken = pipeline vullen; berichten = Claude in Chrome schrijft/verstuurt InMails naar de kandidaten in de pipeline.';

alter table extern_zoeken_resultaten add column onderwerp text;
alter table extern_zoeken_resultaten add column eerder_contact text;
alter table extern_zoeken_resultaten add column verzonden_op timestamptz;
comment on column extern_zoeken_resultaten.eerder_contact is 'Laatste eerdere bericht aan deze kandidaat volgens Recruiter (afzender + datum), zoals Claude het in de fase berichten aantrof. < 3 maanden oud = eerst keuze consultant (status bericht_klaar).';

alter table extern_zoeken_resultaten drop constraint extern_zoeken_resultaten_status_check;
alter table extern_zoeken_resultaten add constraint extern_zoeken_resultaten_status_check
  check (status in ('gevonden', 'gescoord', 'toegevoegd', 'overgeslagen', 'bericht_klaar', 'bericht_goedgekeurd', 'bericht_afgewezen', 'verzonden', 'fout'));

-- Controle pipeline (2026-09-24): Claude leest aan het eind van een zoekrun op de
-- Pipeline-pagina het getal bij "Alle kandidaten" af. (Het getal naast "Pipeline"
-- in het linkermenu is NIET het totaal: dat stond op 12 bij 162 opgeslagen.)
alter table extern_zoeken_opdrachten add column pipeline_teller int;
comment on column extern_zoeken_opdrachten.pipeline_teller is 'Aantal "Alle kandidaten" op de Pipeline-pagina van het Recruiter-project, door Claude in Chrome afgelezen aan het eind van een zoekrun. Controle tegen het aantal resultaten met status toegevoegd. Niet het getal naast "Pipeline" in het linkermenu (dat is geen totaal).';
