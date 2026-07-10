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
  if my_role() not in ('hr', 'admin') then
    raise exception 'Alleen HR of admin mag een beoordeling aanmaken';
  end if;

  insert into gpb_beoordelingen (medewerker_id, medewerker_naam, leidinggevende_id, afdeling, functieniveau, periode)
  values (p_medewerker_id, p_medewerker_naam, p_leidinggevende_id, p_afdeling, p_functieniveau, p_periode)
  returning id into nieuw_id;

  return nieuw_id;
end;
$$;

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
  if auth.uid() <> b.medewerker_id then
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
  if auth.uid() <> b.leidinggevende_id then
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

grant execute on function submit_gpb_leidinggevende(uuid, jsonb) to authenticated;

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
  if my_role() not in ('hr', 'admin') then
    raise exception 'Alleen HR of admin mag goedkeuren';
  end if;

  select * into b from gpb_beoordelingen where id = p_beoordeling_id;

  if b.id is null then
    raise exception 'Beoordeling niet gevonden';
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

create or replace function maak_gpb_definitief(p_beoordeling_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b gpb_beoordelingen;
begin
  if my_role() not in ('hr', 'admin') then
    raise exception 'Alleen HR of admin mag definitief maken';
  end if;

  select * into b from gpb_beoordelingen where id = p_beoordeling_id;

  if b.id is null then
    raise exception 'Beoordeling niet gevonden';
  end if;
  if b.status <> 'goedgekeurd' then
    raise exception 'Alleen een goedgekeurde beoordeling kan definitief gemaakt worden';
  end if;

  update gpb_beoordelingen
  set status = 'definitief', definitief_at = now()
  where id = p_beoordeling_id;
end;
$$;

grant execute on function keur_gpb_goed(uuid) to authenticated;
grant execute on function maak_gpb_definitief(uuid) to authenticated;
