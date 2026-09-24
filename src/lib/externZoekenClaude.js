/**
 * Extern Zoeken via Claude in Chrome. De consultant slaat één keer het
 * commando /burg-extern-zoeken op in de Claude-extensie (SNELKOPPELING_TEKST);
 * dat commando laat Claude de opdracht lezen uit het BURG Apps-tabblad
 * (maakClaudeOpdracht). Zo beheren we de werkinstructies centraal hier,
 * niet in ieders eigen extensie.
 */

export const OPDRACHT_VERSIE = 'claude-chrome-v1-2026-09-24'

export const SNELKOPPELING_NAAM = 'burg-extern-zoeken'

export const SNELKOPPELING_TEKST = `Zoek tussen mijn open tabbladen het BURG Apps-tabblad van Extern Zoeken (adres bevat "/tools/extern-zoeken?opdracht="). Lees daar het blok "Opdracht voor Claude" volledig en voer die opdracht stap voor stap uit. Volg alleen de instructies uit dat blok. Is er geen of meer dan één zo'n tabblad open, stop dan en vraag welke opdracht ik bedoel.`

const lijst = (items) => (items?.length ? items.map((i) => `- ${i}`).join('\n') : '- (geen)')

export function maakClaudeOpdracht(opdracht, opdrachtUrl) {
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

STAP 1 — Project aanmaken
- Ga naar https://www.linkedin.com/talent/home en maak een nieuw project met exact de naam: ${s.projectnaam}
- Neemt LinkedIn de naam niet over, pas hem dan aan via de projectinstellingen (potloodje bij de projectnaam → Opslaan).

STAP 2 — Zoekfilters invullen (in het project, onder Zoeken)
- Functietitels (boolean): ${s.functietitels_boolean}
- Locaties (typ alleen de plaats- of provincienaam en kies de optie met de juiste provincie):
${lijst(s.locaties)}
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
- Geef een score 0-100. Open het volledige profiel alleen als het kaartje niet genoeg zegt (bijv. voor de taaleis of bij twijfel).
- Score 70 of hoger en geen knock-out: opslaan in de pipeline van dit project (fase "Niet benaderd").
- Score 50-69: NIET opslaan, wel rapporteren met "twijfel": true — de consultant beslist.
- Lager dan 50: overslaan en niet rapporteren.
- Staat er "In Bullhorn" op het kaartje: gewoon beoordelen, en "in_bullhorn": true rapporteren.

STAP 4 — Doorgaan
Werk de resultatenpagina's één voor één af (25 per pagina; scroll naar beneden zodat alle kaartjes laden). Stop zodra ${opdracht.doel_aantal} kandidaten in de pipeline staan, of als de resultaten op zijn.

STAP 5 — Na ELKE resultatenpagina terugmelden in BURG Apps
Ga naar het BURG Apps-tabblad (${opdrachtUrl}), plak in het veld "Resultaten van Claude" één JSON-object in precies dit formaat en klik op "Resultaten opslaan". Controleer de bevestiging en ga dan terug naar LinkedIn.
{
  "status": "bezig",
  "voortgang": "Pagina 2 van ca. 20 — 31 in pipeline",
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
Zet bij de laatste melding "status": "klaar" (of "fout" met de reden in "voortgang" als je moest stoppen). Sluit af met een korte samenvatting in de chat.`
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
  const kandidaten = Array.isArray(data.kandidaten) ? data.kandidaten : []
  for (const k of kandidaten) {
    if (!k?.naam) throw new Error('Elke kandidaat moet minstens een "naam" hebben.')
  }
  return { ...data, kandidaten }
}
