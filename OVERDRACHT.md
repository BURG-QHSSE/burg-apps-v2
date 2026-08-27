# Overdracht — BURG Apps v2

Dit document beschrijft alle externe diensten waar deze app van afhankelijk is, wie er nu eigenaar van is, waarom elke dienst nodig is, en hoe je het beheer overdraagt zodat de app blijft werken zonder dat één specifiek persoon nog beschikbaar hoeft te zijn.

**Uitgangspunt:** geen enkele dienst mag afhangen van één individueel account. Waar het platform het ondersteunt (GitHub, Vercel, Supabase) gebruiken we een **organisatie/team met minimaal twee menselijke Owners** — dat is veiliger en beter ondersteund door die platforms dan één gedeeld wachtwoord (geen 2FA per persoon, geen audit-trail, en vaak in strijd met de gebruiksvoorwaarden). Voor diensten zonder zo'n orgstructuur (EmailJS, Google) dragen we eigenaarschap over naar een concreet account en zorgen we voor minimaal één backup-toegang.

---

## Overzicht diensten

| Dienst | Waarvoor | Eigenaar | Status |
|---|---|---|---|
| GitHub | Broncode `burg-apps-v2` | Organisatie `BURG-QHSSE`, Max (max.vanleeuwen@burgbedrijven.nl) uitgenodigd | ✅ Overgedragen |
| GitHub | Broncode `BURG-Apps` (origineel, GitHub Pages) | Bewust nog bij persoonlijk account `NilsHoS` gelaten | ⬜ Nog te doen (apart, met Max) |
| Vercel | Hosting/deploy van de live app | Gratis Hobby-team `BURG QHSSE`, project opnieuw geïmporteerd vanuit `BURG-QHSSE/burg-apps-v2`, domein `app.burgqhsse.nl` verhuisd | ✅ Overgedragen |
| Supabase | Database, auth, Edge Functions | Organisatie `BURG QHSSE` (was `DadHub`), Max uitgenodigd als Owner | ✅ Overgedragen |
| Supabase (burg-jobs) | Los, ouder project — data voor "Mijn Omgeving" (Kansen Swiper) | Onbekend, niet gecontroleerd in deze sessie | ⬜ Nog te checken |
| EmailJS | Verzenden van mails (Sales Overdracht, welkomstmail) | Account-e-mailadres gewijzigd naar `office@burgbedrijven.nl` | ✅ Overgedragen |
| Google Sheet + Apps Script | Doorgroei Tracker databron | Eigendomsoverdracht naar `office@burgbedrijven.nl` geaccepteerd (Apps Script-bewerktoegang volgt automatisch mee via Sheet-eigenaarschap) | ✅ Overgedragen |
| Domein `burgqhsse.nl` / DNS | Custom domain `app.burgqhsse.nl` → Vercel | DNS-record bijgewerkt naar de nieuwe Vercel-CNAME | ✅ Bevestigd |
| Slack | Notificatie bij nieuwe troubleshoot-melding (Incoming Webhook → #developer-gods) | App "BURG App Meldingen" aangemaakt in workspace `BURG` door Max van Leeuwen, 2026-08-11 | ⬜ Nog te checken wie eigenaar hoort te zijn |
| Bullhorn (ATS) | Kandidaat Matcher-tool haalt tearsheet-kandidaten + CV/intake op via de Bullhorn REST API (OAuth2, `kandidaat-matcher` Edge Function) | API-credentials (`BH_CLIENT_ID`/`BH_CLIENT_SECRET`/`BH_USERNAME`/`BH_PASSWORD`) als Supabase-secret gezet, 2026-08-21 — zelfde service-account (`Burgn8n.api`) als elders al in gebruik bij BURG | ⬜ Eigenaarschap van dit Bullhorn-serviceaccount niet gecontroleerd in deze sessie |
| Anthropic (Claude API) | Claude scoort geanonimiseerde kandidaatprofielen tegen de vacaturetekst in de Kandidaat Matcher-tool | `ANTHROPIC_API_KEY` als Supabase-secret gezet, 2026-08-21 — bewust dezelfde key als de losstaande `kandidaat-ranker`-tool al gebruikte | ⬜ Eigenaarschap/facturatie van deze Anthropic Console-account niet gecontroleerd in deze sessie |

**Nog open:**
- `BURG-Apps` (het originele GitHub Pages-project) overzetten — bewust even blijven staan, apart oppakken met Max.
- Het losse `burg-jobs` Supabase-project (voor Mijn Omgeving) — eigenaarschap nog niet gecontroleerd.
- Apps Script-deployment ("Tracker Push BURG App") opnieuw bevestigen vanuit `office@burgbedrijven.nl` zodra dat account overal is ingelogd, zodat de uitvoering niet meer aan Nils' persoonlijke Google-account hangt (zie sectie 5 hieronder) — niet urgent, de huidige deployment blijft werken totdat dit gebeurt.

---

## 1. GitHub — ✅ overgedragen

**Wat:** de broncode van de app.
- `github.com/BURG-QHSSE/burg-apps-v2` — huidige React/Vite-app (rollen-systeem, alle tools). Was `NilsHoS/burg-apps-v2`, overgezet naar de nieuwe organisatie `BURG-QHSSE`.
- De originele `BURG-Apps`-repo (GitHub Pages, HTML/JS) — het oudere systeem waar Max al aan meewerkt. **Bewust nog niet overgezet**, staat nog bij `NilsHoS`.

**Gedaan:** organisatie `BURG-QHSSE` aangemaakt, `burg-apps-v2` overgezet, Max (max.vanleeuwen@burgbedrijven.nl) uitgenodigd.
**Let op als je lokaal werkt:** de git-remote moet bijgewerkt worden naar `https://github.com/BURG-QHSSE/burg-apps-v2.git` (`git remote set-url origin ...`).
**Nog te doen:** `BURG-Apps` ook overzetten (samen met Max, want die werkt daar al in).

---

## 2. Vercel — ✅ overgedragen

**Wat:** hosting van de live app.

- Live domein: **`app.burgqhsse.nl`** (canoniek, wat gebruikers gebruiken)
- Vercel-standaarddomein: `burg-apps-v2-pink.vercel.app` (redirect naar het custom domain)

**Gedaan:** Vercel's officiële "Transfer Project" ondersteunt geen gratis personal-naar-team overdracht (dat vereist een betaald Pro-team) — in plaats daarvan is een nieuw **gratis Hobby-team "BURG QHSSE"** aangemaakt en is het project **opnieuw geïmporteerd** vanuit de (inmiddels verhuisde) GitHub-repo `BURG-QHSSE/burg-apps-v2`. Environment variables zijn opnieuw ingevuld (via "Import .env", let op: verborgen bestanden zichtbaar maken met Cmd+Shift+. in de bestandskiezer). Het domein `app.burgqhsse.nl` is verhuisd naar het nieuwe project.
**Geleerde les:** bij een domein-verhuizing tussen twee verschillende Vercel-accounts vraagt Vercel om een **TXT-record** (`_vercel.burgqhsse.nl`) als eigendomsbewijs, ook nadat het domein al bij het oude project verwijderd is — gewoon verwijderen en verwachten dat het vanzelf overgaat is niet genoeg. De DNS is ook bijgewerkt van het legacy A-record (`76.76.21.21`) naar de aanbevolen CNAME.
**Oude project:** stond onder het persoonlijke account van Nils — kan na verificatie dat alles werkt verwijderd worden.

---

## 3. Supabase — ✅ overgedragen

**Wat:** de database, authenticatie (login/rollen), en de `admin-users` Edge Function (nodig voor het aanmaken/verwijderen van gebruikers-accounts, want dat vereist de `service_role`-sleutel die nooit in de browser mag komen).

- Project: **BURG APPS V2**, project-ref `kthriaekxqxijhqboxkd`, regio eu-west-1.
- Bevat: `profiles`, `role_audit_log`, `tool_usage`, `plaatsingen`, `proeftijd_kandidaten` tabellen + alle RPC-functies (zie `supabase/schema.sql` in de repo — dat bestand is de complete, actuele schema-documentatie).

**Gedaan:** organisatie **"BURG QHSSE"** aangemaakt (was "DadHub"), project overgezet via Settings → General → "Transfer project" (dit werkt bij Supabase, in tegenstelling tot Vercel, gewoon gratis tussen organisaties). Max uitgenodigd als Owner. CLI-koppeling (`npx supabase db query --linked`) getest en werkt nog, project-ref bleef gelijk.
**Nog te doen indien nodig:** de Edge Function `admin-users` gebruikt een los secret (`BURG_JOBS_URL`/`BURG_JOBS_SERVICE_ROLE_KEY`) — check of dat nog correct staat via `npx supabase secrets list`.

### 3b. Los Supabase-project: burg-jobs

Er is een **tweede, ouder Supabase-project** (`ziwqshuabwcthqjspuso`, zie `VITE_BURG_JOBS_URL`/`VITE_BURG_JOBS_ANON_KEY` in `.env`) dat de data levert voor "Mijn Omgeving" (Kansen Swiper — vacatures, employees, swipe-data). Dit is niet hetzelfde project als hierboven en is **niet gecontroleerd** in deze sessie wie daar eigenaar van is. Dit moet apart nagelopen worden — waarschijnlijk hoort dit bij het oorspronkelijke BURG-Apps-project waar Max al bij betrokken is.

---

## 4. EmailJS — ✅ overgedragen

**Wat:** verstuurt e-mails vanuit de app — Sales Overdracht (`src/pages/tools/SalesOverdracht.jsx`) en de welkomstmail bij het aanmaken van een gebruiker (`src/pages/AdminPanel.jsx`).

- Service ID: `service_tdpa3m9`

**Gedaan:** EmailJS ondersteunt geen teamleden op het gratis plan (alleen op een betaald plan) — daarom is het account-e-mailadres zelf gewijzigd naar **`office@burgbedrijven.nl`**. Wie bij die mailbox kan, kan via "wachtwoord vergeten" bij dit account.

---

## 5. Google Sheet + Apps Script — Doorgroei Tracker — ✅ overgedragen

**Wat:** de Doorgroei Tracker-app (`src/pages/tools/DoorgroeiTracker.jsx`) leest **geen Supabase-data**, maar een publiek, read-only Google Apps Script-endpoint dat gekoppeld is aan een Google Sheet.

- Sheet: "Doorgroei Tracker BURG" — `docs.google.com/spreadsheets/d/14Q0_f7PT5kiBPD9mSidB39UJiAotzPf_CtTN2HkaA6Y`
- Tabbladen: Dashboard (overzicht + eigen berekeningen, deels met een bekende `#REF!`-fout die de app niet raakt), Invoer (Recruitment), Invoer Sales, Weekdata Sales.
- Apps Script-project: "Tracker Push BURG App" (Uitbreidingen → Apps Script vanuit de Sheet) — dit script (`doGet()`) genereert de JSON die de app ophaalt via een publieke exec-URL.

**Gedaan:** eigendom van de Sheet overgedragen naar `office@burgbedrijven.nl` (Delen → rol wijzigen naar "Eigenaar maken" → bevestigingsmail geaccepteerd).
**Correctie op de oorspronkelijke aanname:** bij een **gebonden** Apps Script-project (aangemaakt via Extensies vanuit een Sheet) is er geen aparte "Delen"-knop voor het script — bewerktoegang volgt automatisch uit wie Bewerker/Eigenaar van de Sheet is. Een aparte deelactie voor het script was dus niet nodig.
**Nog te doen (niet urgent):** de bestaande deployment ("Tracker Push BURG App") draait mogelijk nog onder Nils' uitvoeringsidentiteit. Zodra `office@burgbedrijven.nl` overal is ingelogd: open het Apps Script-project, **Implementeren → Implementaties beheren** → potloodje bij de bestaande implementatie → opnieuw implementeren (zelfde versie) — dat zet de uitvoering op naam van het nieuwe account, zonder dat de exec-URL wijzigt.

---

## 6. Domein / DNS — ✅ bevestigd

`app.burgqhsse.nl` hoort bij het bedrijfsdomein `burgqhsse.nl`. De DNS wordt beheerd bij de domeinprovider van `burgqhsse.nl` (niet bij Nils persoonlijk) — de CNAME-record voor `app` is tijdens deze overdracht bijgewerkt naar de nieuwe Vercel-bestemming.

---

## 7. Slack — notificatie bij nieuwe troubleshoot-melding — ⬜ eigenaarschap nog te bepalen

**Wat:** zodra iemand een melding indient via het helpdesk-widgetje (`TroubleshootWidget.jsx`, tabel `troubleshoot_items`), post een database-trigger in Supabase (`notify_slack_troubleshoot()`, zie `supabase/schema.sql`) automatisch een bericht in het Slack-kanaal **#developer-gods**, met wie de melding indiende, vanuit welke pagina, de omschrijving, en een link naar de Meldingen-tab in Ontwikkeling.

- Slack-app: **"BURG App Meldingen"** (workspace `BURG`), alleen een Incoming Webhook, geen verdere permissies.
- De webhook-URL zelf staat **niet** in git, maar versleuteld in Supabase Vault onder de naam `troubleshoot_slack_webhook_url` (zie comment boven `notify_slack_troubleshoot()` in `schema.sql` voor hoe je 'm opnieuw zou zetten, bv. als het kanaal ooit verandert).
- Aangemaakt door Max van Leeuwen op 2026-08-11, als vervanger van een oorspronkelijk geplande e-mailnotificatie (EmailJS had geen vrij template-slot meer op het gratis plan).
- **Nog te doen:** bepalen of de Slack-app op een gedeeld/team-account moet komen i.p.v. Max' persoonlijke aanmaak, zodra daar meer duidelijkheid over is (zelfde soort overweging als bij GitHub/Vercel/Supabase bovenaan dit document).

---

## 8. Bullhorn & Anthropic — Kandidaat Matcher-tool

**Wat:** de Kandidaat Matcher-tool (`src/pages/tools/KandidaatMatcher.jsx`) haalt de kandidaten van een bulk-Notitie (actie "Matching", tekst = het vacature-ID) op die de consultant zelf in Bullhorn zet, anonimiseert per kandidaat het CV/intake-veld (`kandidaat-matcher` Edge Function, `anonimiseren.ts` — namen, e-mail, telefoon, LinkedIn en postcode gaan nooit naar Claude) en laat Claude scoren tegen de vacaturetekst. (Gebruikte tot 2026-08-26 een Bullhorn-tearsheet i.p.v. een Notitie - omgezet omdat een nieuwe tearsheet tot ~1 week onzichtbaar bleek voor het REST-service-account.)

- Bullhorn-credentials: hetzelfde service-account (`Burgn8n.api`) dat ook elders bij BURG in gebruik is, als Supabase-secrets gezet op 2026-08-21.
- Anthropic-key: bewust dezelfde key als de losstaande `kandidaat-ranker`-Python-tool (`maxvl1009/kandidaat-ranker`) al gebruikte — geen aparte Anthropic Console-account aangemaakt voor deze tool.
- **Nog te doen:** de "klik door naar Bullhorn"-link per kandidaat gebruikt het patroon `https://cls22.bullhornstaffing.com/BullhornSTAFFING/OpenWindow.cfm?Entity=Candidate&id={id}` — controleren of dit voor alle gebruikers werkt (Bullhorn-tenants kunnen per cluster verschillen).
- Sinds 2026-08-27 open voor `minimumRole: 'manager'` (zie `src/lib/toolRegistry.js` — manager/hr zitten op hetzelfde niveau, dus allebei toegang; nog niet voor gewone `user`-rol). Het AVG-/Bullhorn-rechten-gesprek met Sam over nog bredere uitrol is niet gevoerd - deze uitbreiding was een expliciete keuze van de gebruiker om daar niet langer op te wachten.
- **Nog te doen:** de postcode-anonimisering (nieuw t.o.v. de oude Python-tool) is NIET gevalideerd tegen echte Bullhorn-CV's (geen live toegang tijdens het bouwen) — de eerste live runs extra goed controleren op gemiste of onterecht weggehaalde postcodes.

## Als iemand anders dit project weer wil oppakken (met of zonder Claude Code)

- De repo bevat een `CLAUDE.md` (root van `burg-apps-v2`) met projectcontext voor Claude Code — lees die eerst.
- `supabase/schema.sql` is de volledige, actuele database-structuur (tabellen, RLS-policies, RPC-functies) — dit bestand wordt bewust up-to-date gehouden bij elke wijziging.
- `supabase/functions/admin-users/index.ts` is de enige Edge Function; bevat uitleg in de comments over waarom hij bestaat en hoe te deployen (`npx supabase functions deploy admin-users`).
- Voor lokale ontwikkeling: `.env.example` kopiëren naar `.env`, invullen met de (nieuwe) Supabase-project-gegevens.
- Dit document (`OVERDRACHT.md`) bijwerken zodra een van bovenstaande overdrachten daadwerkelijk is uitgevoerd (vink het overzicht bovenaan af).
