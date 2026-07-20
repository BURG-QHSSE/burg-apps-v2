# BURG Apps v2 — Projectcontext voor Claude Code

## Wat is dit project?
React/Vite multi-tool portal voor BURG QHSSE met een rollen-systeem (admin/manager/hr/user) op Supabase. Losstaande, nieuwere opvolger van de originele `BURG-Apps`-repo (GitHub Pages/HTML), gebouwd door Nils.

**Live:** https://app.burgqhsse.nl
**Zie ook:** [OVERDRACHT.md](./OVERDRACHT.md) — volledig overzicht van alle externe diensten (GitHub, Vercel, Supabase, EmailJS, Google Sheet), wie er eigenaar van is, en hoe je het beheer overdraagt. Lees dat bestand eerst als je dit project voor het eerst oppakt.

## Stack
- **Frontend**: React + Vite, gehost op Vercel
- **Database/auth**: Supabase (project-ref `kthriaekxqxijhqboxkd`, regio eu-west-1) — zie `supabase/schema.sql` voor de complete, actuele structuur (tabellen, RLS-policies, RPC-functies)
- **Edge Function**: `admin-users` (`supabase/functions/admin-users/index.ts`) — enige plek die de Supabase `service_role`-sleutel gebruikt, voor het aanmaken/verwijderen van gebruikersaccounts. Deployen via `npx supabase functions deploy admin-users`.
- **E-mail**: EmailJS (Sales Overdracht + welkomstmail bij nieuwe gebruiker)
- **Doorgroei Tracker**: leest géén Supabase, maar een extern Google Apps Script-endpoint gekoppeld aan een Google Sheet (zie `src/lib/doorgroeiTrackerApi.js`)
- **Los, ouder Supabase-project** (`ziwqshuabwcthqjspuso`): levert data voor "Mijn Omgeving" (vacatures/employees), zie `VITE_BURG_JOBS_URL` in `.env`

## Structuur
- `src/pages/` — routepagina's (Dashboard, AdminPanel, Login, etc.)
- `src/pages/tools/` — losse tools (Fee Checker, Definitief Honorarium, Verdeling Plaatsing, Sales Overdracht, Doorgroei Tracker, GPB Beoordelingstool, Proeftijd Tracker, Mijn Omgeving)
- `src/lib/` — Supabase-clients en API-helpers per feature (adminApi, yieldApi, doorgroeiTrackerApi, proeftijdApi, gpbApi, burgJobsClient)
- `src/lib/toolRegistry.js` — centrale lijst van tools + minimale rol per tool
- `supabase/schema.sql` — volledige database-schema, RLS-policies, RPC-functies (altijd up-to-date houden bij wijzigingen)

## Werkwijze
- Voor lokale ontwikkeling: `.env.example` kopiëren naar `.env`, invullen met Supabase-projectgegevens.
- `npm run dev`, `npm run build`, `npm run lint` (oxlint) — altijd build+lint checken na wijzigingen.
- Database-wijzigingen: pas `supabase/schema.sql` aan én draai de daadwerkelijke SQL handmatig tegen de live database (SQL-editor of `npx supabase db query --linked`) — er is geen migratie-tooling, dit bestand is puur documentatie/bron van waarheid.
- Edge Function-wijzigingen: na aanpassen van `supabase/functions/admin-users/index.ts` altijd opnieuw deployen met `npx supabase functions deploy admin-users`.

## Instructie voor Claude Code: CLAUDE.md en OVERDRACHT.md bijwerken
Werk aan het einde van een sessie deze bestanden bij als er iets structureels is veranderd:
- Nieuwe Supabase-tabellen/kolommen/RPC's → in `supabase/schema.sql` staan die al als bron van waarheid, hier alleen vermelden als de structuur zelf wijzigt.
- Nieuwe externe dienst toegevoegd (bv. een nieuwe e-mail-provider, nieuwe Google-koppeling) → toevoegen aan `OVERDRACHT.md`.
- Eigenaarschap van een dienst overgedragen → status bijwerken in de tabel bovenaan `OVERDRACHT.md`.
