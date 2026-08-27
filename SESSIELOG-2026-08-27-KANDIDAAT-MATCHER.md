# Sessielog 2026-08-27 — Kandidaat Matcher

Overzicht van een lange werksessie over de Kandidaat Matcher-tool. Bedoeld
zodat een nieuwe Claude Code-sessie (of jijzelf, bv. vanaf vakantie) meteen
weet wat er is gebeurd, wat de huidige staat is, en wat eventueel nog open
staat — zonder de hele chatgeschiedenis terug te hoeven lezen.

**Twee repo's zijn deze sessie aangeraakt:**
- `burg-apps-v2` (dit project) — de Kandidaat Matcher-tool zelf (frontend + Edge Function).
- `kandidaat-ranker` (`maxvl1009/kandidaat-ranker`, los, `bullhorn_sync/sync_candidates.py`) — de dagelijkse cron die het Bullhorn `description`-veld vult met CV+intake-tekst. Draait via GitHub Actions, 18:00 UTC dagelijks.

Zie ook `OVERDRACHT.md` (sectie 8) voor de korte samenvatting, en het
persoonlijke Claude-geheugen (`project_kandidaat_ranker_migration.md`) voor
nog meer historische diepgang uit eerdere sessies.

---

## 1. Status op dit moment

- Kandidaat Matcher is **live, open voor iedereen** (`minimumRole: 'user'`),
  onder "Tools" in het dashboard. Admin-only overzicht "Kandidaat Matcher -
  Gebruik" staat onder "Beheer".
- Alle wijzigingen van vandaag zijn **gedeployed en gepusht** — niets staat
  nog lokaal/ongecommit.
- Een testrun kan gewoon gedraaid worden; geen verdere actie nodig om te
  demonstreren aan consultants.
- De Securitas-run (vacature-ID 22778) is op verzoek verwijderd uit de
  database zodat die opnieuw gestart kan worden (de 1-run-per-vacature-
  blokkade gold daarvoor).

## 2. Wat er deze sessie aan de Kandidaat Matcher is gebouwd/gefixt

In ongeveer chronologische volgorde (alle commits op `BURG-QHSSE/burg-apps-v2` main):

1. **UI: resultaten pas tonen als de hele run klaar is** (geen losse "wacht"-rijen meer zichtbaar), namen live opgehaald (nooit opgeslagen) met een echte Bullhorn-logo-knop (wit met oranje Bullhorn-logo, niet donkerblauw — expliciete correctie).
2. **Tab-reload-bug gefixt**: een gebackgroundde tab die door de browser ververst wordt, verloor alle state en liet een 'bezig'-run onbereikbaar achter. Fix: run-ID zit nu in de URL (`?run=...`), bij page-load wordt die run automatisch hervat/herpolld.
3. **Filters**: multi-select gemaakt (checkboxes), maar UI bleef een collapsed dropdown-knop (expliciete gebruikerskeuze). Later ook: **actieve filters krijgen een visuele highlight** (kleur + rand) zodat je in één oogopslag ziet dat er gefilterd is.
4. **Concurrency-fixes** (een 364-kandidaten-run was 2x zo traag als verwacht): Bullhorn-profielophaal geparallelliseerd (was onnodig sequentieel), `CLAUDE_CONCURRENCY` losgekoppeld van een hardcoded waarde, frontend draait nu 3 gelijktijdige `process-batch`-pollingloops i.p.v. 1.
5. **Namen ophalen was traag** — zelfde soort fix: geparallelliseerd + eigen, hogere concurrency-constante (`NAMEN_CONCURRENCY = 20`), losstaand van de match-concurrency.
6. **Echte bug gevonden: Matching-notities werden na een "succesvolle" run soms nooit verwijderd**, stilletjes — een sequentiële delete-loop bleef hangen boven de ~150s Edge Function-limiet. Fix: parallelle deletes + `EdgeRuntime.waitUntil()` zodat de cleanup nooit meer de HTTP-response kan blokkeren of afgebroken worden.
7. **Persistence in `sessionStorage`** (bewust nooit in de database, om PII buiten opslag te houden): concept-formulierinvoer, filterselectie per run, scrollpositie per run, namen-cache per run — allemaal overleven nu een gebackgroundde tab-reload.
8. **Ranglijst-nummer** (`#1`, `#2`, ...) toegevoegd per kandidaat, berekend over de volledige ongefilterde resultatenlijst.
9. **Tool open voor iedereen** (was `manager`/`hr`) — `toolRegistry.js`, de Edge Function's eigen rolcheck, én de RLS-policies op `matching_runs`/`matching_resultaten` moesten alle drie mee (makkelijk te missen, want de frontend leest die tabellen rechtstreeks met de JWT van de gebruiker, niet via de Edge Function). Nieuwe tool **"Kandidaat Matcher - Gebruik"** (admin-only) toont per-gebruiker run-aantallen, kandidaat-aantallen en kosten.
10. **Max 1 succesvolle run per vacature-ID** — `start-run` checkt op een bestaande `matching_runs`-rij met status `bezig`/`klaar` voor dat vacature-ID en blokkeert met een duidelijke foutmelding. Alleen echt gelukte runs tellen mee (niet `fout`/`kostenlimiet`).
11. **"Terug naar dashboard"-knop** toegevoegd, zelfde patroon als andere tools (`VerdelingPlaatsing.jsx`).
12. **Onderbouwing-tekst personalisatie** (display-only): `personaliseerOnderbouwing()` in `KandidaatMatcher.jsx` vervangt "de kandidaat" en het anonimiseringslabel (`KANDIDAAT_XXXXXX`) door de echte naam bij het TONEN van Claude's al-gegenereerde tekst. Gaat nooit naar Claude, wordt nergens opgeslagen — puur cosmetisch voor de consultant, die de naam toch al bovenaan ziet staan.

## 3. Anonimiserings-onderzoek: waarom lekten er namen? (belangrijk, lees dit)

De consultant zag bij een paar kandidaten hun **echte naam** letterlijk terug
in Claude's gegenereerde onderbouwing (dus een echt lek, geen displayprobleem
zoals punt 12 hierboven). Onderzocht met 4 concrete voorbeelden:

| Kandidaat | Bullhorn-naam | Wat lekte | Oorzaak |
|---|---|---|---|
| Christiaan Nouwen | Christiaan | **"Chris"** | CV bevat letterlijk `Roepnaam : Chris` — een informele bijnaam die niet overeenkomt met de formele voornaam |
| Jimme Jon Ming | Jimme | **"Jimmy"** | CV gebruikt overal "Jimmy" (15x), geen `Roepnaam:`-label — dus geen enkel mechanisme ving dit |
| Michelle Brugman | Michelle | **"Michelle Brugman"** | Kon niet meer gereproduceerd worden tegen huidige live data — CV-tekst is sindsdien vermoedelijk herzien door een latere sync |
| Simone / Olivier | — | eerdere naam-fragmenten | Zelfde soort verklaring als Michelle, niet met zekerheid te reproduceren |

**Kernprobleem:** `vervangKandidaatNaam()` in `anonimiseren.ts` matcht alleen
exacte varianten van het formele Bullhorn `firstName`/`lastName` — het heeft
geen enkele manier om te weten dat een CV de kandidaat aanspreekt met een
informele bijnaam.

**Gekozen fix** (gebruiker koos expliciet de goedkope regex-optie boven een
zwaardere Claude-based naam-detectie-pre-pass, die extra latency/kosten per
kandidaat zou toevoegen): `anonimiseren.ts` scant nu de ruwe CV-tekst op het
patroon `Roepnaam\s*:?\s*(woord)` en voegt die bijnaam toe als extra
naam-variant vóór het anonimiseren. Gevalideerd: Chris wordt nu correct
gevangen; Jimmy (geen "Roepnaam:"-label in zijn CV) blijft een **bewust
geaccepteerd gat** — dat kan alleen gedicht worden met een zwaardere,
duurdere aanpak, die de gebruiker nu niet wilde.

Bullhorn heeft trouwens wél een `nickName`-veld in het schema, maar dat staat
voor alle geteste kandidaten leeg — geen bruikbare structurele databron.

**Als dit weer gebeurt:** reproduceer het eerst empirisch (fetch de live
Bullhorn-`description`, draai er de actuele `anonimiseren.ts`-logica
overheen, kijk of de naam er nog in staat) vóór je aanneemt dat de logica
kapot is — bij Simone/Olivier bleek de logica namelijk al correct te werken
tegen de huidige data; de oorspronkelijke lekkende tekst was kennelijk al
weer overschreven.

## 4. De intake-datum-feature (grootste stuk werk van vandaag)

**Aanleiding:** de consultant wil zien wanneer de laatst gebruikte
intake-notitie is aangemaakt, zodat die kan inschatten of Claude's
tijdgevoelige uitspraken ("al een jaar op zoek") nog kloppen.

### 4.1 Eerste aanpak (verworpen)

Eerst gebouwd: een live Bullhorn-Note-query tijdens elke matcher-run,
plus een fuzzy tekstvergelijking om te checken of de gevonden notitie ook
echt de tekst is die al in `description` stond. Werkte, maar bleek fragiel
(Bullhorn normaliseert HTML-opmaak lichtjes bij het opslaan — `&nbsp;`,
`<br />` vs `<br>` — waardoor een letterlijke vergelijking bijna altijd
"anders" liet zien, zelfs voor dezelfde notitie). Kostte ook een extra
Bullhorn-call per kandidaat per run.

### 4.2 Gekozen aanpak: datum vastleggen bij de bron

Op voorstel van de gebruiker: **`sync_candidates.py` (kandidaat-ranker-repo)
legt de datum nu zelf vast** op het moment dat hij de intake-tekst
wegschrijft, in de header:

```
=== INTAKE DATA (1591772417260) ===<br>{intake-tekst}<br><br>=== CV DATA ===<br>{cv-tekst}
```

Het getal is `dateAdded` (epoch-ms) van de Note. Backwards compatible: oudere
`description`-waarden zonder datum parsen nog steeds prima (datum wordt dan
`null`).

**Gewijzigde bestanden:**
- `kandidaat-ranker/bullhorn_sync/sync_candidates.py` (commit `bc39cb3`):
  `get_intake_for_candidate()` retourneert nu `(tekst, datum)`,
  `update_candidate_description()` neemt een `nieuwe_intake_datum`-parameter,
  `_BESTAANDE_SECTIES_RE` heeft een optionele datum-group. **Getest
  end-to-end tegen een echte kandidaat (54363) vóór het pushen.**
- `burg-apps-v2/supabase/functions/kandidaat-matcher/bullhorn.ts` (commit
  `2e29c15`): `haalIntakeDatumUit()` leest de datum nu gewoon rechtstreeks
  uit het al-opgehaalde `description`-veld — geen aparte Bullhorn-call meer,
  geen fuzzy-matching meer nodig. Veel simpeler en robuuster dan 4.1.
- `matching_resultaten.laatste_intake_datum` (nieuwe kolom, `timestamptz`,
  nullable) — toegevoegd aan zowel de live database als `schema.sql`.
- `KandidaatMatcher.jsx`: toont "Laatste intake: DD-MM-YYYY" (amber, bold)
  naast de onderbouwing, puur voor de consultant, nooit naar Claude.

### 4.3 Eenmalige herverwerking om bestaande kandidaten een datum te geven

Zonder herverwerking krijgen alleen NIEUW gesynchte kandidaten een datum. Om
de bestaande populatie (~6986 QHSSE-kandidaten) alsnog te voorzien, zijn er
twee eenmalige acties gedraaid (allebei tegen de live Bullhorn-data, dus echt
uitgevoerd, niet slechts theoretisch):

**Groep 1 — de 2998 kandidaten uit de eerdere "geen bruikbare intake"-opschoning
(26 augustus):** exact dezelfde selectielogica opnieuw gedraaid (nu met datum
erbij). Resultaat: 96 kregen een andere tekst dan voorheen (verwacht — er
kunnen sinds 26 augustus nieuwe notities zijn bijgekomen), 2902 ongewijzigd,
**0 fouten**.

**Groep 2 — de "confirmed good" ~3987 kandidaten** (kandidaten wier
`description` al langer dan het lege sjabloon was én expliciete
vorm-taal bevatte — "conclusie", "waarom ben je op zoek", etc. — en die
daarom bij de 26-augustus-opschoning bewust NIET zijn aangeraakt). Dit was
spannender: deze groep is nog nooit door de bredere `beste_intake_eenmalig`-
logica (Kennismaking-fallback + sjabloon-detector) gelopen. Een gebruikers-
vraag hierover ("gaat dit wel goed met de logica van de confirmed-good
groep?") leidde tot een zorgvuldige, meerstaps aanpak:

1. **Dry-run (read-only)** over alle 3987: 17 zonder enige match, 3947 met
   behoud van het vormkenmerk, 23 met verlies van het vormkenmerk (rode vlag).
2. **Schrijven, met die 40 twijfelgevallen expliciet overgeslagen** (nooit
   aangeraakt — hun bestaande, goede tekst blijft intact). 3947 kregen een
   datum, 443 daarvan met een tekst die afweek van wat er al stond (verwacht:
   deze groep werd voor het eerst door de nieuwe, bredere logica gehaald in
   plaats van het oudere/simpelere proces dat hun tekst oorspronkelijk zette).
3. **Laatste verificatieronde** ná het schrijven: voor alle 3947 verwerkte
   kandidaten opnieuw het geschreven veld gelezen en gecheckt of het
   vormkenmerk er nog in staat. **Resultaat: 3947/3947 gecontroleerd, 0
   zonder datum, 0 zonder vormkenmerk, 0 fouten.** Schoon resultaat.

**Live-scan achteraf (over de hele populatie, 6986 kandidaten):**
- 2104 hebben helemaal geen intake-tekst (dus logischerwijs ook geen datum)
- 38 hebben wél tekst maar geen datum (de bewust overgeslagen twijfelgevallen)
- 4844 hebben tekst mét datum

De scripts en input-bestanden voor deze eenmalige actie staan gearchiveerd in
`Bureaublad/bullhorn-sync/eenmalig-2026-08-27/` (ze stonden oorspronkelijk
alleen in een sessie-scratchpad, die normaal niet overleeft — nu wel
bewaard, voor het geval de logica ooit teruggezocht moet worden).

### 4.4 Bekende, geaccepteerde gaten in deze feature

- De 38 kandidaten zonder datum (17 zonder enige match, 23 met verloren
  vormkenmerk) zijn met opzet nooit geschreven — hun bestaande intake-tekst
  is intact gelaten, maar ze tonen geen datum in de matcher. Zie
  `confirmed_good_geen_match_ids.json` / `confirmed_good_vorm_verloren_ids.json`
  in de gearchiveerde map hierboven als je ze precies wil terugvinden.
- Nieuwe kandidaten (of kandidaten die vanaf nu een nieuwe intake-notitie
  krijgen) krijgen automatisch een datum via de dagelijkse cron — geen
  verdere actie nodig.

## 5. Overige losse acties deze sessie

- **Securitas-run verwijderd** (vacature-ID 22778, run-id
  `83de29ef-15d9-4293-b269-225cc68a097b`) op expliciet verzoek, zodat die
  opnieuw gestart kan worden.
- Salarisomrekening bevestigd: een jaarsalaris in de intake-tekst
  (bv. "€60.000 per jaar") wordt omgerekend naar maandbasis via
  `bedrag / (12 * 1.08)` — de 1.08 verrekent vakantiegeld. Zowel het
  structurele Bullhorn-veld als de vrije intake-tekst worden zo omgerekend;
  de hoogste van de twee wint voor de filterband (`salarisfilter.ts`).

## 6. Voor de volgende sessie — waar te beginnen

- Alles staat live en gedeployed; geen losse eindjes qua code.
- Als er een nieuw naam-lek gemeld wordt: zie sectie 3 hierboven voor de
  aanpak (eerst empirisch reproduceren, niet aannemen dat de code kapot is).
- Als de intake-datum raar oogt bij een kandidaat: check of
  `matching_resultaten.laatste_intake_datum` null is (dan is er geen
  bruikbare Intake-notitie gevonden, wat legitiem kan zijn) vs. of de datum
  gewoon te oud lijkt (dan is dat precies het bedoelde signaal — de intake IS
  oud).
- `kandidaat-ranker`-repo: `sync_candidates.py` draait dagelijks om 18:00 UTC
  via GitHub Actions — check `gh run list --workflow=sync-candidates.yml
  --repo maxvl1009/kandidaat-ranker --limit 5` als er twijfel is of de
  laatste cron goed liep.
