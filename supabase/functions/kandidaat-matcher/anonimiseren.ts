// Anonimisering van vrije tekst (CV/intake, uit het Bullhorn 'description'-veld)
// voordat die de Edge Function verlaat richting de Anthropic-API.
//
// Regex-voor-regex portage van `anonimiseer_vrije_tekst()` +
// `_vervang_kandidaat_naam()` / `_vervang_initialen()` / `_strip_accenten()`
// uit `server.py` in de kandidaat-ranker-repo (Python/FastAPI), met één
// toevoeging die in de Python-versie nog ontbrak: Nederlandse postcodes
// (zie POSTCODE_PATROON hieronder).
//
// Straatadres-anonimisering zit BEWUST niet in deze v1 (zie de opdracht:
// AVG-gevoelig genoeg om eerst af te stemmen in plaats van een onbetrouwbaar
// patroon live te zetten).
//
// LET OP over woordgrenzen: Python's \b is Unicode-bewust (re.UNICODE is de
// Python 3-default), JavaScript's \b is dat NIET — \b in JS kent alleen
// [A-Za-z0-9_] als "woordteken", dus een accent (é, ë, …) telt daar niet
// als woordteken. Voor de naam/initialen-vervanging (waar geaccentueerde
// namen een reële zaak zijn) wordt daarom een eigen Unicode-woordgrens
// gebruikt (zie `wb()` hieronder) i.p.v. kaal \b, zodat het gedrag gelijk
// blijft aan de Python-versie. Voor e-mail/telefoon/LinkedIn/postcode is dit
// niet nodig (die grenzen liggen altijd tussen ASCII-tekens).

const NAAM_TUSSENVOEGSELS = new Set([
  'van', 'der', 'den', 'de', 'ten', 'ter', 'in', "'t", 'het',
])

// Leestekens die gestript worden van het begin/einde van een naamdeel,
// inclusief Unicode-streepjesvarianten (en-dash, em-dash, …) — zelfde set
// als _NAAM_STRIP in server.py.
const NAAM_STRIP_CHARS = '.,;:!?\'"`()[]{}<>-‐‑‒–—'

function stripNaamChars(woord: string): string {
  let start = 0
  let end = woord.length
  while (start < end && NAAM_STRIP_CHARS.includes(woord[start])) start++
  while (end > start && NAAM_STRIP_CHARS.includes(woord[end - 1])) end--
  return woord.slice(start, end)
}

/** Unicode-equivalent van Python's unicodedata-based _strip_accenten(): 'Angélique' -> 'Angelique'. */
export function stripAccenten(tekst: string): string {
  return tekst.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

const WORD_CHAR = String.raw`[\p{L}\p{N}_]`

/** Unicode-bewuste woordgrens (zie uitleg bovenaan dit bestand). `inner` is al escaped regex-brontekst. */
function wordBoundaryPattern(inner: string): string {
  return String.raw`(?<!${WORD_CHAR})(?:${inner})(?!${WORD_CHAR})`
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Vervang de kandidaatnaam in tekst — accent-onafhankelijk, woordgrens-bewust,
 * zonder losse tussenvoegsels als zelfstandig zoekwoord. Poort van
 * _vervang_kandidaat_naam() in server.py.
 */
export function vervangKandidaatNaam(tekst: string, naam: string, label: string): string {
  if (!naam) return tekst

  const gezien = new Set<string>()
  const ruw: string[] = []

  const voegToe = (s: string) => {
    const trimmed = s.trim()
    const sleutel = trimmed.toLowerCase()
    if (trimmed.length > 2 && !NAAM_TUSSENVOEGSELS.has(sleutel) && !gezien.has(sleutel)) {
      gezien.add(sleutel)
      ruw.push(trimmed)
    }
  }

  voegToe(naam)
  for (const deel of naam.split(/\s+/).filter(Boolean)) {
    voegToe(deel)
    voegToe(stripNaamChars(deel))
  }

  const varianten = ruw.sort((a, b) => b.length - a.length)

  let resultaat = tekst
  for (const deel of varianten) {
    const stripped = stripAccenten(deel)
    const inner = stripped !== deel
      ? `${escapeRegex(deel)}|${escapeRegex(stripped)}`
      : escapeRegex(deel)
    const patroon = new RegExp(wordBoundaryPattern(inner), 'giu')
    resultaat = resultaat.replace(patroon, label)
  }
  return resultaat
}

/**
 * Vervang initiaalcombinaties (2+ initialen, bv. "A.H." of "A. H.") van de
 * kandidaatnaam. Poort van _vervang_initialen() in server.py.
 */
export function vervangInitialen(tekst: string, naam: string, label: string): string {
  if (!naam) return tekst
  const delen = naam.split(/\s+/).filter((d) => d.length > 1 && !NAAM_TUSSENVOEGSELS.has(d.toLowerCase()))
  const initialen = delen.map((d) => stripAccenten(d)[0].toUpperCase())
  if (initialen.length < 2) return tekst

  let resultaat = tekst
  for (let start = 0; start < initialen.length; start++) {
    for (let eind = start + 2; eind <= initialen.length; eind++) {
      const subset = initialen.slice(start, eind)
      const kern = subset.map(escapeRegex).join(String.raw`\.[ ]?`)
      // (?<!\w) i.p.v. \b vóór het eerste initiaal: initialen zijn altijd
      // ASCII A-Z, dus geen Unicode-woordgrens nodig hier zoals bij namen.
      const patroon = new RegExp(String.raw`\b${kern}\.(?!${WORD_CHAR})`, 'giu')
      resultaat = resultaat.replace(patroon, label)
    }
  }
  return resultaat
}

export function maakKandidaatLabel(bullhornId: number | string | null | undefined, seqNr: number): string {
  if (bullhornId !== null && bullhornId !== undefined) {
    const clean = String(bullhornId).toUpperCase().replace(/^BH-/, '').trim()
    if (/^\d+$/.test(clean)) {
      return `KANDIDAAT_${clean.padStart(6, '0')}`
    }
  }
  return `KANDIDAAT_${String(seqNr).padStart(6, '0')}`
}

const EMAIL_PATROON = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi

const TELEFOON_PATROON = new RegExp(
  [
    // NL-specifiek: +31 / 0031 prefix
    String.raw`(\+31|0031)[\s\-.]?[0-9\s\-.]{8,15}`,
    // NL mobiel: 06-XXXXXXXX — separators mogen meerdere tekens zijn, trailing
    // (?!\d) i.p.v. \b zodat "06-22441302E-mail" ook matcht.
    String.raw`\b06[\s\-.]*[0-9](?:[\s\-.]*[0-9]){6,8}(?!\d)`,
    // NL vast, gegroepeerd: 020-123 4567
    String.raw`\b0[1-9][0-9]{1,2}[\s-][0-9]{3,4}[\s-][0-9]{4}\b`,
    // NL vast, flat: 0316-331316 / 020-1234567
    String.raw`\b0[1-9][0-9]{1,3}[\s\-.][0-9]{5,8}\b`,
    // Belgisch/NL puntformaat: 0487.15.27.82
    String.raw`\b0[1-9][0-9]{2,3}(?:[.\s-][0-9]{2}){3}(?!\d)`,
    // Internationaal 00-prefix: 0044-7554062404
    String.raw`\b00[1-9][0-9]{0,2}(?:[\s\-.]?[0-9]){7,12}`,
    // Internationaal +-prefix: +905346881768 / +31 6 12345678
    String.raw`\+[1-9][0-9]{0,2}(?:[\s\-.]?[0-9]){7,12}`,
  ].join('|'),
  'gi',
)

const LINKEDIN_PATROON = new RegExp(
  // Dekt /in/, /company/, /pub/, vanity-URLs, én PDF-artefacten (newline of
  // ontbrekende slash tussen domein en pad). Negatieve lookbehind voorkomt
  // een match binnen "notlinkedin.com".
  String.raw`(?:https?://)?(?:(?:www|[a-z]{2})\.)?(?<![a-zA-Z\d])linkedin\.com(?:\s*/[\w\-./%~]*|[\w\-/%~]*)`,
  'gi',
)

// NIEUW t.o.v. de Python-versie (zie opdracht §2.6): Nederlandse postcodes,
// viercijferig + twee letters, met of zonder spatie ("1234 AB" / "1234AB").
//
// Bewuste keuze voor de brede variant i.p.v. een striktere "alleen bij
// adres-context"-versie: het echte AVG-risico zit in een postcode die NIET
// wordt weggehaald (false negative), niet in een enkel woord dat onterecht
// wordt overschreven (false positive — kost alleen wat leesbaarheid van de
// CV-tekst voor Claude, geen privacyrisico). Bij twijfel dus liever te veel
// dan te weinig wegfilteren.
//
// NIET gevalideerd tegen echte Bullhorn-CV's (geen live toegang in deze
// sessie) — zie de opdracht: eerst tegen een handvol echte geanonimiseerde
// CV's testen voordat dit blind vertrouwd wordt. Voorlopig alleen synthetische
// testgevallen (zie anonimiseren.test.ts).
const POSTCODE_PATROON = /\b\d{4}\s?[A-Z]{2}\b/gi

/**
 * Normaliseer PDF/cp1252-encoding-artefacten die woordgrenzen breken:
 * U+00C2 (Â) direct voor een cijfer = half UTF-8 non-breaking-space.
 * Zelfde fix als in anonimiseer_vrije_tekst() in server.py.
 */
function normaliseerPdfArtefacten(tekst: string): string {
  return tekst.replace(/Â /g, ' ').replace(/Â(?=\d)/g, ' ')
}

// vervangKandidaatNaam vervangt alleen exacte varianten van het formele
// Bullhorn firstName/lastName. Een CV dat de kandidaat aanspreekt met een
// afwijkende roepnaam (bv. "Chris" voor "Christiaan") wordt daardoor gemist -
// gevonden na een echte lek in productie (zie CLAUDE.md-geschiedenis). Het
// CV-sjabloon vult die roepnaam vaak expliciet in als "Roepnaam : X", dus die
// halen we er hier apart uit en anonimiseren we mee.
const ROEPNAAM_PATROON = /\broepnaam\s*:?\s*([\p{L}][\p{L}'-]*)/iu

function vindRoepnaam(tekst: string): string | null {
  const match = ROEPNAAM_PATROON.exec(tekst)
  return match ? match[1] : null
}

const HTML_ENTITIES: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ',
}

/**
 * Het Bullhorn 'description'-veld wordt door de sync (sync_candidates.py)
 * geschreven met simpele HTML (<br> tussen intake/CV-secties). Strip tags
 * en de handvol entities die daarbij voorkomen, vóór anonimisering — zelfde
 * aanpak als de "Zoektermen uit laatste intake"-behandeling in
 * bouw_kandidaat_voor_ranking() in server.py.
 */
export function stripHtml(tekst: string): string {
  const zonderTags = tekst.replace(/<[^>]+>/g, '\n')
  return zonderTags.replace(/&[a-z#0-9]+;/gi, (m) => HTML_ENTITIES[m.toLowerCase()] ?? m)
}

/**
 * Verwijder alle PII uit vrije tekst: kandidaatnaam, initialen, e-mail,
 * telefoon, LinkedIn en (nieuw) postcode. Geen LLM, geen derdennamen — puur
 * regex, dezelfde aanpak als anonimiseer_vrije_tekst() in server.py.
 */
export function anonimiseerVrijeTekst(tekst: string, kandidaatLabel: string, kandidaatNaam: string): string {
  if (!tekst || !tekst.trim()) return tekst

  let resultaat = normaliseerPdfArtefacten(tekst)
  const roepnaam = vindRoepnaam(resultaat)
  const naamMetRoepnaam = roepnaam ? `${kandidaatNaam} ${roepnaam}`.trim() : kandidaatNaam
  resultaat = vervangKandidaatNaam(resultaat, naamMetRoepnaam, kandidaatLabel)
  resultaat = vervangInitialen(resultaat, kandidaatNaam, kandidaatLabel)
  resultaat = resultaat.replace(EMAIL_PATROON, '[EMAIL]')
  resultaat = resultaat.replace(TELEFOON_PATROON, '[TELEFOONNUMMER]')
  resultaat = resultaat.replace(LINKEDIN_PATROON, '[LINKEDIN]')
  resultaat = resultaat.replace(POSTCODE_PATROON, '[ADRES]')
  return resultaat
}
