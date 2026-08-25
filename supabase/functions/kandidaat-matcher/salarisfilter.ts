// Salaris-/uurtarief-band-berekening voor de filterbalk (NIET voor Claude —
// zie de comments in index.ts en schema.sql bij matching_resultaten).
// Port van bereken_salarisbandbredte()/haal_filterdata_op() uit server.py
// (kandidaat-ranker-repo), met één correctie: de originele intake-tekst-
// regex verwachtte het bedrag *direct* gevolgd door de eenheid-marker
// ("per maand"/"per jaar") en miste daardoor vermeldingen als "€129.000
// bruto per jaar" (bevestigd tegen echte productiedata — kandidaat 57257).
// FILLER hieronder staat één los woord tussen bedrag en marker toe.

const FILLER = '(?:\\s*\\w+)?'

const SALARY_BANDS: [number, number, string][] = [
  [0, 2000, '< 2000 EUR'],
  [2000, 2500, '2000 - 2500 EUR'],
  [2500, 3000, '2500 - 3000 EUR'],
  [3000, 3500, '3000 - 3500 EUR'],
  [3500, 4000, '3500 - 4000 EUR'],
  [4000, 4500, '4000 - 4500 EUR'],
  [4500, 5000, '4500 - 5000 EUR'],
  [5000, 6000, '5000 - 6000 EUR'],
  [6000, 7000, '6000 - 7000 EUR'],
  [7000, 8000, '7000 - 8000 EUR'],
  [8000, 9000, '8000 - 9000 EUR'],
  [9000, Infinity, 'EUR 9000 >'],
]

function bedragNaarBand(bedrag: number): string {
  for (const [lo, hi, label] of SALARY_BANDS) {
    if (bedrag >= lo && bedrag < hi) return label
  }
  return 'EUR 9000 >'
}

function bandOrder(label: string): number {
  return SALARY_BANDS.findIndex(([, , l]) => l === label)
}

function parseBedrag(ruw: string): number | null {
  const schoon = ruw.replace(/\./g, '').replace(/,/g, '')
  const bedrag = parseInt(schoon, 10)
  return Number.isFinite(bedrag) ? bedrag : null
}

/** Zet een ruwe waarde (uit een structureel Bullhorn-veld, bv. customText22) om naar een vaste bandbreedte. */
export function berekenSalarisbandbreedte(waarde: string | null | undefined): string {
  if (!waarde || !waarde.trim()) return 'Onbekend'
  const w = waarde.trim().toLowerCase()

  if (/\b(?:zzp|freelance)\b/.test(w) || w.includes('geen/betreft')) return 'Geen/betreft ZZP'
  if (/per uur|\/uur\b|p\/?u\.?\b|uurtarief/.test(w)) return 'Geen/betreft ZZP'
  if (/\bonbekend\b/.test(w)) return 'Onbekend'

  // Meerdere bandbreedtes gescheiden door puntkomma → hoogste.
  if (waarde.includes(';')) {
    let hoogsteIdx = -1
    let hoogsteLabel = 'Onbekend'
    for (const deel of waarde.split(';')) {
      const band = berekenSalarisbandbreedte(deel.trim())
      if (band === 'Onbekend' || band === 'Geen/betreft ZZP') continue
      const idx = bandOrder(band)
      if (idx > hoogsteIdx) {
        hoogsteIdx = idx
        hoogsteLabel = band
      }
    }
    return hoogsteLabel
  }

  let m = waarde.match(/[€]?\s*(\d[\d.,]+)\s*(?:per jaar|p\.?j\.?|jaarlijks|jaar\b)/i)
  if (m) {
    const bedrag = parseBedrag(m[1])
    if (bedrag !== null) return bedragNaarBand(bedrag / (12 * 1.08))
  }

  m = waarde.match(/[€]?\s*(\d[\d.,]+)\s*(?:\/mnd|per maand|\/maand|,-)(?!\d)/i)
  if (m) {
    const bedrag = parseBedrag(m[1])
    if (bedrag !== null) return bedragNaarBand(bedrag)
  }

  m = waarde.match(/[€]?\s*(\d[\d.]+)\s*[-–]\s*[€]?\s*(\d[\d.]+)/)
  if (m) {
    const lo = parseBedrag(m[1])
    const hi = parseBedrag(m[2])
    if (lo !== null && hi !== null) return bedragNaarBand((lo + hi) / 2)
  }

  m = waarde.match(/[€]?\s*(\d[\d.,]+)/)
  if (m) {
    const bedrag = parseBedrag(m[1])
    if (bedrag !== null && bedrag > 0) return bedragNaarBand(bedrag)
  }

  return 'Onbekend'
}

/** Zoekt een maandsalaris-vermelding in vrije tekst (intake), geeft het ruwe bedrag terug. */
function extractMaandsalarisUitTekst(tekst: string): number | null {
  const m = tekst.match(
    new RegExp(`[€]?\\s*(\\d[\\d.,]{2,6})${FILLER}\\s*(?:,-|per maand|/maand|p/?m\\.?)`, 'i'),
  )
  if (!m) return null
  const bedrag = parseBedrag(m[1])
  return bedrag !== null && bedrag > 1000 && bedrag < 30000 ? bedrag : null
}

/** Zoekt een jaarsalaris-vermelding in vrije tekst (intake), geeft het bedrag terug omgerekend naar maandbasis. */
function extractJaarsalarisUitTekstAlsMaandbedrag(tekst: string): number | null {
  const m = tekst.match(
    new RegExp(`[€]?\\s*(\\d[\\d.,]{3,7})${FILLER}\\s*(?:per jaar|p\\.?j\\.?|jaarlijks|jaar\\b)`, 'i'),
  )
  if (!m) return null
  const bedrag = parseBedrag(m[1])
  return bedrag !== null && bedrag > 10000 ? bedrag / (12 * 1.08) : null
}

/** Zoekt een uurtarief-vermelding in vrije tekst (intake), geeft de ruwe "€X/uur"-string terug. */
function extractUurtariefUitTekst(tekst: string): string | null {
  const m = tekst.match(new RegExp(`[€]?\\s*(\\d{2,4})${FILLER}\\s*(?:per uur|/uur|p/?u\\.?|uurtarief)`, 'i'))
  return m ? `€${m[1]}/uur` : null
}

/** Pakt alleen het stuk na de "=== INTAKE DATA ===" (of "=== INTAKE ===")-marker uit description. */
function intakeSectie(description: string): string | null {
  const m = description.match(/={2,}\s*INTAKE(?:\s+DATA)?\s*={2,}([\s\S]*)$/i)
  return m ? m[1] : null
}

export interface SalarisFilterData {
  salarisBand: string
  uurtariefBand: string
}

/**
 * Bepaalt de filterwaarden voor salaris/uurtarief: het structurele
 * Bullhorn-veld (customText22/customText11) én een eventuele vermelding in
 * de intake-tekst worden allebei naar een band omgerekend, en de HOOGSTE van
 * de twee wordt gebruikt (expliciete keuze — kunnen van elkaar verschillen,
 * en voor filtering is de hoogste variant de veiligste aanname). Dit gaat
 * uitsluitend naar de filterbalk in de UI, nooit naar Claude.
 */
export function bepaalSalarisFilterData(
  structureelSalaris: string | null,
  structureelUurtarief: string | null,
  description: string | null,
): SalarisFilterData {
  const intake = description ? intakeSectie(description) : null

  const structBand = structureelSalaris ? berekenSalarisbandbreedte(structureelSalaris) : 'Onbekend'
  let intakeBand = 'Onbekend'
  if (intake) {
    const maandbedrag = extractMaandsalarisUitTekst(intake)
    const jaarAlsMaand = extractJaarsalarisUitTekstAlsMaandbedrag(intake)
    const bedrag = maandbedrag !== null && jaarAlsMaand !== null
      ? Math.max(maandbedrag, jaarAlsMaand)
      : maandbedrag ?? jaarAlsMaand
    if (bedrag !== null) intakeBand = bedragNaarBand(bedrag)
  }
  const salarisBand = bandOrder(intakeBand) > bandOrder(structBand) ? intakeBand : structBand

  const structUurtariefBand = structureelUurtarief ? berekenSalarisbandbreedte(structureelUurtarief) : 'Onbekend'
  let intakeUurtariefBand = 'Onbekend'
  if (intake) {
    const uurtariefTekst = extractUurtariefUitTekst(intake)
    if (uurtariefTekst) intakeUurtariefBand = berekenSalarisbandbreedte(uurtariefTekst)
  }
  const uurtariefBand = bandOrder(intakeUurtariefBand) > bandOrder(structUurtariefBand)
    ? intakeUurtariefBand
    : structUurtariefBand

  return { salarisBand, uurtariefBand }
}
