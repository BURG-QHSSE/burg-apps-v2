# BURG Apps v2 — Projectcontext voor Claude Code

## Wat is dit project?
React/Vite multi-tool portal voor BURG QHSSE met een rollen-systeem (admin/manager/hr/user) op Supabase. Losstaande, nieuwere opvolger van de originele `BURG-Apps`-repo (GitHub Pages/HTML), gebouwd door Nils.

**Live:** https://app.burgqhsse.nl
**Zie ook:** [OVERDRACHT.md](./OVERDRACHT.md) — volledig overzicht van alle externe diensten (GitHub, Vercel, Supabase, EmailJS, Google Sheet), wie er eigenaar van is, en hoe je het beheer overdraagt. Lees dat bestand eerst als je dit project voor het eerst oppakt.

## Stack
- **Frontend**: React + Vite, gehost op Vercel
- **Database/auth**: Supabase (project-ref `kthriaekxqxijhqboxkd`, regio eu-west-1) — zie `supabase/schema.sql` voor de complete, actuele structuur (tabellen, RLS-policies, RPC-functies)
- **Edge Function**: `admin-users` (`supabase/functions/admin-users/index.ts`) — enige plek die de Supabase `service_role`-sleutel gebruikt, voor het aanmaken/verwijderen van gebruikersaccounts. Deployen via `npx supabase functions deploy admin-users`.
- **Edge Function**: `kandidaat-matcher` (`supabase/functions/kandidaat-matcher/`) — Bullhorn OAuth + Claude-scoring voor de Kandidaat Matcher-tool (admin-only). Bevat de AVG-kritieke anonimisering (`anonimiseren.ts`) die persoonsgegevens uit het CV/intake-veld haalt vóórdat er iets naar Claude gaat. Gebruikt secrets `BH_CLIENT_ID`/`BH_CLIENT_SECRET`/`BH_USERNAME`/`BH_PASSWORD`/`ANTHROPIC_API_KEY` en optioneel `MATCHER_BATCH_SIZE`. Deployen via `npx supabase functions deploy kandidaat-matcher`.
- **Edge Function**: `call-insights` (`supabase/functions/call-insights/`) — detecteert automatisch Bullhorn-veldwijzigingen (salaris range/uurtarief range/woonplaats/voorkeur dienstverband/status) uit 3CX-gesprekssamenvattingen voor de Call Insights-tool. Databron `recordings`/`recording_participant` wordt native door 3CX zelf (Integrations → Data Connectors, "Recordings Data" aan) elke 15 min in deze database gezet — geen eigen 3CX-koppeling nodig. Matcht kandidaten via een eigen genormaliseerde telefoon-index (`bullhorn_candidate_phone_index`, actie `refreshPhoneIndex`, want Bullhorn's search/Candidate ondersteunt geen wildcard-zoekopdrachten op phone-velden), laat Claude Haiku wijzigingen detecteren (actie `syncNewCalls`, bedoeld voor een periodieke pg_cron-aanroep met een `x-cron-secret`-header tegen secret `CALL_INSIGHTS_CRON_SECRET` — **cron nog niet geactiveerd, bewust: eerst handmatig verifiëren**), en schrijft pas naar Bullhorn (`entity/Candidate` POST) als de consultant een suggestie expliciet accepteert (actie `resolveSuggestion`, user-JWT). Hergebruikt de Bullhorn-secrets/`bullhorn_session_cache` van kandidaat-matcher (zelfde service-account). Deployen via `npx supabase functions deploy call-insights`.
- **E-mail**: EmailJS (Sales Overdracht + welkomstmail bij nieuwe gebruiker)
- **Doorgroei Tracker**: leest géén Supabase, maar een extern Google Apps Script-endpoint gekoppeld aan een Google Sheet (zie `src/lib/doorgroeiTrackerApi.js`)
- **Los, ouder Supabase-project** (`ziwqshuabwcthqjspuso`): levert data voor "Mijn Omgeving" (vacatures/employees), zie `VITE_BURG_JOBS_URL` in `.env`

## Claude-modelkeuze (check bij elke AI-tool)

Elke Edge Function die de Anthropic API aanroept, gebruikt zijn eigen hardcoded model-ID (`CLAUDE_MODEL` in het bijbehorende `claude.ts`) — die kunnen dus uit de pas gaan lopen zonder dat iemand het merkt. Huidige stand (bijgewerkt 2026-09-16):

| Tool / Edge Function | Model | Waarom |
|---|---|---|
| Kandidaat Matcher (`kandidaat-matcher/claude.ts`) | `claude-sonnet-5` | Gemigreerd van `claude-sonnet-4-6` op 2026-09-16 — Sonnet 5 is zowel goedkoper (~33%) als de nieuwere generatie, geen reden om op 4.6 te blijven. |
| Call Insights (`call-insights/claude.ts`) | `claude-sonnet-5` | Draaide eerst op Haiku 4.5, bleek categorische uitsluitingsregels te negeren — Sonnet 5 hield die wel consistent aan (zie code-comment in dat bestand). |

**Bij het aanraken van een bestaande AI-tool, of het bouwen van een nieuwe:** check of het gebruikte model nog het huidige/aanbevolen model is (niet zomaar aannemen dat het al goed staat) — vraag de `claude-api`-skill om de actuele modeltabel (prijs + generatie) op te halen, en leg een eventuele wissel altijd eerst voor aan de gebruiker vóór je 'm doorvoert (een modelwissel kan gedrag/output subtiel veranderen, zie de "Sonnet thinking-block parsing bug" in de Call Insights-projectgeschiedenis — altijd even een sanity-check van de output na een wissel).

## Structuur
- `src/pages/` — routepagina's (Dashboard, AdminPanel, Login, etc.)
- `src/pages/tools/` — losse tools (Fee Checker, Definitief Honorarium, Verdeling Plaatsing, Sales Overdracht, Doorgroei Tracker, GPB Beoordelingstool, Proeftijd Tracker, Mijn Omgeving, Kandidaat Matcher)
- `src/lib/` — Supabase-clients en API-helpers per feature (adminApi, yieldApi, doorgroeiTrackerApi, proeftijdApi, gpbApi, burgJobsClient, kandidaatMatcherApi)
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
