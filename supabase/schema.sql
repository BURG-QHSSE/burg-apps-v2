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
$$ language plpgsql security definer;

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
$$ language plpgsql security definer;

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
$$ language plpgsql security definer;

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
  set leidinggevende_antwoorden = p_antwoorden
  where id = p_beoordeling_id;
end;
$$;

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
  if my_role() not in ('hr', 'admin') then
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
  if my_role() not in ('hr', 'admin') then
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
  if my_role() not in ('hr', 'admin') then
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

grant execute on function hr_update_gpb_doelen(uuid, jsonb) to authenticated;

-- ============================================
-- Bel Overzicht: belstatistieken per medewerker uit 3CX CDR-data
--
-- `call_daily_stats` wordt buiten dit bestand om gevuld (een cron job zet
-- elke nacht om 00:20 de vorige dag over vanuit de ruwe 3CX-CDR-staging-
-- tabellen `cdroutput`/`cdrbilling`, die zelf geen onderdeel zijn van het
-- applicatie-schema en daarom hier niet gedocumenteerd worden). Alleen
-- daadwerkelijk gevoerde (beantwoorde) gesprekken tellen mee.
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

grant execute on function maak_gpb_definitief(uuid) to authenticated;
