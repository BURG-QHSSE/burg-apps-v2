/**
 * Extern Zoeken via Claude in Chrome, in twee losse stappen met elk een eigen
 * commando in de Claude-extensie (SNELKOPPELINGEN, één keer per consultant
 * ingesteld): /burg-extern-zoeken leest de zoekopdracht, /burg-berichten de
 * berichtenopdracht uit het BURG Apps-tabblad. Zo beheren we de
 * werkinstructies centraal hier, niet in ieders eigen extensie.
 */

export const OPDRACHT_VERSIE = 'claude-chrome-v7-2026-09-24'

// MVP (2026-09-24): Claude zet berichten alleen klaar in BURG Apps en verstuurt
// niets, zodat ze eerst gecontroleerd en aan het management getoond kunnen
// worden. Op true zetten = Claude verstuurt InMails (behalve bij eerder contact).
export const BERICHTEN_VERSTUREN = false

// Eerder bericht korter dan dit geleden = eerst keuze van de consultant.
const EERDER_CONTACT_MAANDEN = 3

export const ZOEK_BLOK = 'Zoekopdracht voor Claude'
export const BERICHTEN_BLOK = 'Berichtenopdracht voor Claude'

const snelkoppelingTekst = (blok) =>
  `Zoek tussen mijn open tabbladen het BURG Apps-tabblad van Extern Zoeken (adres bevat "/tools/extern-zoeken?opdracht="). Lees daar het blok "${blok}" volledig en voer die opdracht stap voor stap uit. Volg alleen de instructies uit dat blok. Is er geen of meer dan één zo'n tabblad open, of staat het blok er niet, stop dan en vraag welke opdracht ik bedoel.`

export const SNELKOPPELINGEN = {
  zoeken: { naam: 'burg-extern-zoeken', tekst: snelkoppelingTekst(ZOEK_BLOK) },
  berichten: { naam: 'burg-berichten', tekst: snelkoppelingTekst(BERICHTEN_BLOK) },
}

const lijst = (items) => (items?.length ? items.map((i) => `- ${i}`).join('\n') : '- (geen)')

/** Opdrachttekst voor /burg-extern-zoeken: pipeline vullen in Recruiter. */
export function maakZoekOpdracht(opdracht, opdrachtUrl) {
  const s = opdracht.strategie
  const jaren = s.jaren_ervaring_max == null
    ? `minimaal ${s.jaren_ervaring_min}`
    : `${s.jaren_ervaring_min} tot ${s.jaren_ervaring_max}`
  const talen = [s.nederlands_vereist && 'Nederlands', s.engels_vereist && 'Engels'].filter(Boolean).join(' en ') || 'geen eis'

  return `OPDRACHT VOOR CLAUDE — Extern Zoeken (${OPDRACHT_VERSIE})

Je vult in LinkedIn Recruiter een pipeline met passende kandidaten voor een vacature van BURG QHSSE (recruitmentbureau). Doel: ${opdracht.doel_aantal} kandidaten in de pipeline.
Deze BURG Apps-opdracht staat op: ${opdrachtUrl}

HARDE REGELS
- Verstuur NOOIT InMails of berichten en maak geen Bullhorn-records aan.
- Wijzig, archiveer of verwijder geen andere projecten dan het project dat jij voor deze opdracht aanmaakt.
- Zet nergens in LinkedIn woorden als "test", "automatisch", "Claude" of "AI" (projectnaam, notities, tags).
- Werk in een normaal, menselijk tempo. Zie je een waarschuwing, captcha, limietmelding of uitlogscherm van LinkedIn: stop direct en meld dat in BURG Apps (zie stap 5, met "status": "fout").

STAP 0 — Verbruik meten (start)
Open https://claude.ai/settings/usage en lees af: "Current session" (% used, en wanneer die reset) en onder "Weekly limits" het % bij "All models". Meld dat direct in BURG Apps zoals in stap 5, met "status": "bezig", "voortgang": "Gestart", "kandidaten": [] en:
"verbruik": { "fase": "zoeken", "moment": "start", "sessie_pct": 28, "week_pct": 32, "sessie_reset": "over 3 uur 10 min" }

STAP 1 — Project aanmaken
- Ga naar https://www.linkedin.com/talent/home en maak een nieuw project met exact de naam: ${s.projectnaam}
- Neemt LinkedIn de naam niet over, pas hem dan aan via de projectinstellingen (potloodje bij de projectnaam → Opslaan).

STAP 2 — Zoekfilters invullen (in het project, onder Zoeken)
- Functietitels (boolean): ${s.functietitels_boolean}
- Locatie: zoek op postcode ${s.postcode} met een straal van ${s.straal_km ?? 40} km (gebruik de postcode/straal-optie van het locatiefilter, geen losse plaatsnamen)
- Trefwoorden (boolean): ${s.trefwoorden_boolean || '(leeg laten)'}
- Vaardigheden:
${lijst(s.vaardigheden)}
- Jaren ervaring: ${jaren}
- Huidige werkgever uitsluiten:
${lijst(s.uitsluiten_huidige_bedrijven)}
Noteer het aantal resultaten dat Recruiter toont.

STAP 3 — Beoordelen
Beoordeel per resultatenkaartje tegen:
Ideaal profiel: ${s.ideaal_profiel}
Harde eisen:
${lijst(s.harde_eisen)}
Pluspunten:
${lijst(s.pluspunten)}
Knock-outs (dan niet toevoegen):
${lijst(s.knock_outs)}
Taal vereist: ${talen}

BELANGRIJK — beoordeel alleen op wat je op het profiel kunt zien:
- Tel alleen mee wat zichtbaar is: functietitels, werkgevers/sector, aantal jaren ervaring, opleidingen en certificaten die vermeld staan.
- Wat je op een profiel niet kunt zien (bijv. reisbereidheid, persoonlijkheid, taalbeheersing, werk- en denkniveau) telt NIET mee, niet positief en niet negatief. Dat checkt de consultant later in het gesprek.
- Een eis of certificaat dat niet vermeld staat (bijv. geen MVK op het profiel) is GEEN minpunt en geen knock-out: veel mensen zetten dat er niet op. Het is alleen een pluspunt als het er wél staat.
- Een knock-out geldt alleen als het profiel die duidelijk laat zien (bijv. overduidelijk minder dan 3 jaar ervaring in het vak, of een totaal ander vakgebied).
- Scoor dus vooral op: past de huidige/recente functie en de ervaring (jaren, sector) bij deze rol?

- Geef een score 0-100. Open het volledige profiel alleen als het kaartje niet genoeg zegt over functie en ervaring.
- Score 70 of hoger en geen knock-out: klik ECHT op "Opslaan in pipeline" bij die kandidaat (fase "Niet benaderd") en controleer dat de knop verandert en de teller naast "Pipeline" in het linkermenu met 1 oploopt. Meld "in_pipeline": true ALLEEN als dat gelukt is; lukt opslaan niet, meld dan "in_pipeline": false en zet de reden in de onderbouwing.
- Score 50-69 (echte twijfel over de zichtbare functie/ervaring, bijv. aanpalende rol of net te weinig jaren): NIET opslaan, wel rapporteren met "twijfel": true en in de onderbouwing wat de twijfel is — de consultant beslist.
- Lager dan 50: overslaan en niet rapporteren.
- Staat er "In Bullhorn" op het kaartje: gewoon beoordelen, en "in_bullhorn": true rapporteren.

STAP 4 — Doorgaan
Werk de resultatenpagina's één voor één af (25 per pagina; scroll naar beneden zodat alle kaartjes laden). Stop zodra ${opdracht.doel_aantal} kandidaten in de pipeline staan, of als de resultaten op zijn.

STAP 5 — Na ELKE resultatenpagina terugmelden in BURG Apps
Lees eerst het getal naast "Pipeline" in het linkermenu van het project af (pipeline_teller). Dat moet gelijk zijn aan het totaal dat je tot nu toe met "in_pipeline": true hebt gemeld; is het lager, ga dan terug en sla de ontbrekende kandidaten alsnog op vóór je verder gaat.
Ga dan naar het BURG Apps-tabblad (${opdrachtUrl}), plak in het veld "Resultaten van Claude" één JSON-object in precies dit formaat en klik op "Resultaten opslaan". Controleer de bevestiging en ga dan terug naar LinkedIn.
{
  "status": "bezig",
  "voortgang": "Pagina 2 van ca. 20 — 31 in pipeline",
  "pipeline_teller": 31,
  "aantal_resultaten": "487",
  "recruiter_project_url": "https://www.linkedin.com/talent/hire/...",
  "kandidaten": [
    {
      "naam": "Voornaam Achternaam",
      "kopregel": "HSE Coördinator bij ...",
      "locatie": "Rotterdam, Zuid-Holland",
      "profiel_url": "https://www.linkedin.com/talent/profile/...",
      "score": 82,
      "onderbouwing": "1-2 zinnen waarom wel/niet passend",
      "in_bullhorn": false,
      "in_pipeline": true,
      "twijfel": false
    }
  ]
}
STAP 6 — Afronden
Open aan het eind (ook als je moest stoppen) opnieuw https://claude.ai/settings/usage en doe de laatste melding met "status": "klaar" (of "fout" met de reden in "voortgang") en:
"verbruik": { "fase": "zoeken", "moment": "eind", "sessie_pct": 61, "week_pct": 35, "sessie_reset": "..." }
Sluit af met een korte samenvatting in de chat.`
}

function schrijfwijze(opdracht) {
  const s = opdracht.strategie
  return `SCHRIJFWIJZE
- Nederlands; Engels alleen als het profiel duidelijk Engelstalig is.
- Onderwerp: kort en concreet (max. ca. 60 tekens), met de functie.
- Bericht: 80-150 woorden, aanspreken met de voornaam, informeel-zakelijk ("je").
- Verwijs concreet naar 1-2 dingen uit het profiel (huidige rol, ervaring, certificaat) en leg uit waarom dat past bij de functie.
- Vertel kort wat de functie is: ${s.functietitel}${s.vestigingsplaats ? ` in de regio ${s.vestigingsplaats}` : ''}, met de kern van de rol.
- Noem de naam van de opdrachtgever niet, en geen salaris of andere details die niet in de vacaturetekst staan.
- Sluit af met een laagdrempelige vraag (kort bellen of meer info) en onderteken met de voornaam van de eigenaar van dit Recruiter-account.
- Nooit overdrijven, geen emoji's, niets verzinnen over de kandidaat.

VACATURE (achtergrond voor de berichten)
Ideaal profiel: ${s.ideaal_profiel}
Harde eisen:
${lijst(s.harde_eisen)}
Vacaturetekst:
${opdracht.vacaturetekst}`
}

/** MVP-variant: alleen berichten schrijven en in BURG Apps klaarzetten, nooit versturen. */
function maakKlaarzetOpdracht(opdracht, opdrachtUrl, nieuw, grensTekst) {
  const s = opdracht.strategie
  const lijstA = nieuw.length
    ? nieuw.map((r) => `- id ${r.id}: ${r.kaart.naam} — ${r.kaart.kopregel ?? ''} — ${r.kaart.profiel_url ?? '(zoek op naam in het project)'}`).join('\n')
    : '- (geen)'

  return `OPDRACHT VOOR CLAUDE — Extern Zoeken, fase BERICHTEN KLAARZETTEN (${OPDRACHT_VERSIE})

Je schrijft persoonlijke InMails voor de kandidaten in de pipeline van het project "${s.projectnaam}", voor een vacature van BURG QHSSE (recruitmentbureau), en zet ze klaar in BURG Apps. De consultant controleert ze daar.
Deze BURG Apps-opdracht staat op: ${opdrachtUrl}

HARDE REGELS
- Verstuur NOOIT een InMail of ander bericht. Open in LinkedIn ook geen berichtvenster of InMail-scherm; je schrijft de berichten alleen in de JSON-melding voor BURG Apps.
- Maak geen Bullhorn-records aan en wijzig geen projecten.
- Werk in een normaal, menselijk tempo. Waarschuwing, captcha, limietmelding of uitlogscherm: stop direct en meld "status": "fout" met de reden in "voortgang".

STAP 0 — Verbruik meten (start)
Open https://claude.ai/settings/usage, lees "Current session" (% used) en "Weekly limits → All models" (%) af en meld direct (zie stap 2) met "status": "bezig", "fase": "berichten", "voortgang": "Gestart", "berichten": [] en:
"verbruik": { "fase": "inmails", "moment": "start", "sessie_pct": 28, "week_pct": 32, "sessie_reset": "over 3 uur 10 min" }

STAP 1 — Per kandidaat een bericht schrijven
${lijstA}
Per kandidaat:
a. Open het profiel en bekijk het tabblad "Berichten" (alleen lezen): wat is het laatste bericht aan deze persoon, van wie, en op welke datum?
b. Is dat laatste bericht (van wie dan ook: een collega of dit account) verstuurd na ${grensTekst}, vul dan "eerder_contact" in, bijv. "Bericht van Jan de Vries op 12 augustus 2026". Anders "eerder_contact": null.
c. Schrijf een persoonlijke InMail (zie SCHRIJFWIJZE) met onderwerp en bericht.

STAP 2 — Terugmelden in BURG Apps (na elke 10 kandidaten en aan het eind)
Ga naar het BURG Apps-tabblad (${opdrachtUrl}), plak in het veld "Resultaten van Claude" één JSON-object in precies dit formaat en klik op "Resultaten opslaan". Controleer de bevestiging.
{
  "status": "bezig",
  "voortgang": "12 van 45 klaargezet",
  "berichten": [
    {
      "id": "<id uit de lijst>",
      "status": "bericht_klaar",
      "onderwerp": "...",
      "bericht": "...",
      "eerder_contact": null
    }
  ]
}
Gebruik altijd "status": "bericht_klaar" per kandidaat (of "fout" met de reden in "eerder_contact" als het profiel niet te openen was).

STAP 3 — Afronden
Open opnieuw https://claude.ai/settings/usage en doe de laatste melding met "status": "klaar" (of "fout") en:
"verbruik": { "fase": "inmails", "moment": "eind", "sessie_pct": 61, "week_pct": 35, "sessie_reset": "..." }
Sluit af met een korte samenvatting in de chat: hoeveel berichten klaargezet, bij hoeveel was er recent eerder contact.

${schrijfwijze(opdracht)}`
}

/** Opdrachttekst voor /burg-berichten: InMails schrijven (en, als dat aanstaat, versturen). */
export function maakBerichtenOpdracht(opdracht, opdrachtUrl, resultaten) {
  const s = opdracht.strategie
  const grens = new Date()
  grens.setMonth(grens.getMonth() - EERDER_CONTACT_MAANDEN)
  const grensTekst = grens.toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' })
  const profiel = (r) => r.kaart.profiel_url ?? '(zoek op naam in het project)'
  const nieuw = resultaten.filter((r) => r.status === 'toegevoegd')
  const goedgekeurd = resultaten.filter((r) => r.status === 'bericht_goedgekeurd')
  const lijstA = nieuw.length
    ? nieuw.map((r) => `- id ${r.id}: ${r.kaart.naam} — ${r.kaart.kopregel ?? ''} — ${profiel(r)}`).join('\n')
    : '- (geen)'
  const lijstB = goedgekeurd.length
    ? goedgekeurd
        .map((r) => `- id ${r.id}: ${r.kaart.naam} — ${profiel(r)}\n  Onderwerp: ${r.onderwerp}\n  Bericht:\n${r.bericht}`)
        .join('\n\n')
    : '- (geen)'
  const projectLink = opdracht.recruiter_project_id?.startsWith('https://') ? ` (${opdracht.recruiter_project_id})` : ''

  if (!BERICHTEN_VERSTUREN) return maakKlaarzetOpdracht(opdracht, opdrachtUrl, nieuw, grensTekst)

  return `OPDRACHT VOOR CLAUDE — Extern Zoeken, fase BERICHTEN (${OPDRACHT_VERSIE})

Je schrijft en verstuurt via LinkedIn Recruiter persoonlijke InMails aan kandidaten in de pipeline van het project "${s.projectnaam}"${projectLink}, voor een vacature van BURG QHSSE (recruitmentbureau).
Deze BURG Apps-opdracht staat op: ${opdrachtUrl}

HARDE REGELS
- Stuur alleen InMails aan de kandidaten in lijst A en B hieronder, nooit aan anderen, en ieder hoogstens één keer.
- Maak geen Bullhorn-records aan en wijzig geen andere projecten.
- Zet nergens in LinkedIn (ook niet in de berichten) woorden als "test", "automatisch", "Claude" of "AI".
- Werk in een normaal, menselijk tempo. Waarschuwing, captcha, limietmelding, te weinig InMail-credits of uitlogscherm: stop direct en meld "status": "fout" met de reden in "voortgang".

STAP 0 — Verbruik meten (start)
Open https://claude.ai/settings/usage, lees "Current session" (% used) en "Weekly limits → All models" (%) af en meld direct (zie stap 3) met "status": "bezig", "fase": "berichten", "voortgang": "Gestart", "berichten": [] en:
"verbruik": { "fase": "inmails", "moment": "start", "sessie_pct": 28, "week_pct": 32, "sessie_reset": "over 3 uur 10 min" }

STAP 1 — Lijst A: nieuwe berichten
${lijstA}
Per kandidaat:
a. Open het profiel en bekijk het tabblad "Berichten": wat is het laatste bericht aan deze persoon, van wie, en op welke datum?
b. Is het laatste bericht van dit account, van de afgelopen 7 dagen en over deze vacature, dan heb je hem al eerder verstuurd: niet opnieuw sturen, meld "verzonden".
c. Schrijf een persoonlijke InMail (zie SCHRIJFWIJZE).
d. Is het laatste bericht (van wie dan ook: een collega of dit account) verstuurd na ${grensTekst}: NIET versturen. Meld "bericht_klaar" met "eerder_contact" (bijv. "Bericht van Jan de Vries op 12 augustus 2026"), plus het onderwerp en bericht dat je zou sturen. De consultant beslist in BURG Apps.
e. Anders: verstuur de InMail en meld "verzonden" met onderwerp en bericht.

STAP 2 — Lijst B: door de consultant goedgekeurde berichten
${lijstB}
Verstuur per kandidaat precies het opgegeven onderwerp en bericht (niet herschrijven) en meld "verzonden".

STAP 3 — Terugmelden in BURG Apps (na elke 10 kandidaten en aan het eind)
Ga naar het BURG Apps-tabblad (${opdrachtUrl}), plak in het veld "Resultaten van Claude" één JSON-object in precies dit formaat en klik op "Resultaten opslaan". Controleer de bevestiging.
{
  "status": "bezig",
  "voortgang": "12 van 45 verwerkt",
  "berichten": [
    {
      "id": "<id uit lijst A of B>",
      "status": "verzonden",
      "onderwerp": "...",
      "bericht": "...",
      "eerder_contact": null
    }
  ]
}
Status per kandidaat: "verzonden", "bericht_klaar" (eerder contact, niet verstuurd) of "fout" (met de reden in "eerder_contact").

STAP 4 — Afronden
Open opnieuw https://claude.ai/settings/usage en doe de laatste melding met "status": "klaar" (of "fout") en:
"verbruik": { "fase": "inmails", "moment": "eind", "sessie_pct": 61, "week_pct": 35, "sessie_reset": "..." }
Sluit af met een korte samenvatting in de chat: hoeveel verstuurd, hoeveel wachten op de keuze van de consultant.

${schrijfwijze(opdracht)}`
}

/** Leest de JSON die Claude in het resultatenveld plakt (codeblok-omhulsel mag). */
export function leesClaudeResultaten(tekst) {
  const schoon = tekst.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  let data
  try {
    data = JSON.parse(schoon)
  } catch {
    throw new Error('Geen geldige JSON — plak precies het object uit stap 5 van de opdracht.')
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Verwacht één JSON-object met o.a. "status" en "kandidaten".')
  }
  if (data.status && !['bezig', 'klaar', 'fout'].includes(data.status)) {
    throw new Error(`Onbekende status "${data.status}" (bezig, klaar of fout).`)
  }
  if (data.pipeline_teller != null && !Number.isInteger(data.pipeline_teller)) {
    throw new Error('"pipeline_teller" moet een geheel getal zijn (het getal naast Pipeline in Recruiter).')
  }
  if (data.fase && !['zoeken', 'berichten'].includes(data.fase)) {
    throw new Error(`Onbekende fase "${data.fase}" (zoeken of berichten).`)
  }
  if (data.verbruik) {
    const v = data.verbruik
    if (!v.fase || !['start', 'eind'].includes(v.moment) || !Number.isFinite(v.sessie_pct) || !Number.isFinite(v.week_pct)) {
      throw new Error('"verbruik" moet fase, moment (start/eind), sessie_pct en week_pct (getallen) bevatten.')
    }
  }
  const kandidaten = Array.isArray(data.kandidaten) ? data.kandidaten : []
  for (const k of kandidaten) {
    if (!k?.naam) throw new Error('Elke kandidaat moet minstens een "naam" hebben.')
  }
  const berichten = Array.isArray(data.berichten) ? data.berichten : []
  for (const b of berichten) {
    if (!b?.id) throw new Error('Elk bericht moet het "id" uit de lijst hebben.')
    if (!BERICHTEN_VERSTUREN && b.status === 'verzonden') {
      throw new Error('Berichten versturen staat uit (MVP) — meld "bericht_klaar", niet "verzonden".')
    }
    if (!['verzonden', 'bericht_klaar', 'fout'].includes(b.status)) {
      throw new Error(`Onbekende berichtstatus "${b.status}" (verzonden, bericht_klaar of fout).`)
    }
  }
  return { ...data, kandidaten, berichten }
}
