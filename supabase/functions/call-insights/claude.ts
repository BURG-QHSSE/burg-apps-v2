// Claude-extractie van Bullhorn-veldwijzigingen uit een 3CX-gesprekssamen-
// vatting. Bewust een goedkoop model (Haiku) i.p.v. het Sonnet-model van
// kandidaat-matcher: dit is classificatie/extractie op een korte, al door
// 3CX/Grok samengevatte tekst, geen inhoudelijke beoordeling — Haiku is hier
// ruim toereikend en een fractie van de kosten. Geen prompt-caching nodig
// (in tegenstelling tot kandidaat-matcher): elke aanroep heeft een uniek,
// kort system+user-bericht, geen herbruikt gedeeld prefix om op te cachen.

const CLAUDE_MODEL = 'claude-haiku-4-5-20251001'
const CLAUDE_MAX_TOKENS = 500
const CLAUDE_TIMEOUT_MS = 30_000

// Haiku 4.5-tarieven per token, voor eventuele kostenlogging/-limieten later.
const PRIJS_PER_TOKEN_USD = {
  input: 1.0 / 1_000_000,
  output: 5.0 / 1_000_000,
}

async function fetchMetTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

function claudeHeaders(): Record<string, string> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY secret ontbreekt')
  return { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }
}

function stripMarkdownCodeblock(tekst: string): string {
  let t = tekst.trim()
  if (t.startsWith('```')) {
    const newline = t.indexOf('\n')
    t = newline >= 0 ? t.slice(newline + 1) : t.slice(3)
  }
  if (t.endsWith('```')) {
    t = t.slice(0, -3).trimEnd()
  }
  return t
}

// Exacte Bullhorn-veldnamen + hun toegestane picklist-opties, live
// geverifieerd via meta/Candidate (zie project-onderzoek in dit gesprek).
// 'address' heeft bewust geen opties (vrije tekst, en we vragen alleen de
// plaatsnaam — zie index.ts voor waarom nooit een postcode gefabriceerd
// wordt: NL-postcodes zijn straat-niveau, een "generieke" postcode per
// plaatsnaam zou voor de meeste straten in die plaats gewoon fout zijn).
export const VELD_DEFINITIES: Record<string, { label: string; opties: string[] | null }> = {
  customText22: {
    label: 'Salaris range (maandsalaris)',
    opties: [
      '< 2000 EUR', '2000 - 2500 EUR', '2500 - 3000 EUR', '3000 - 3500 EUR', '3500 - 4000 EUR',
      '4000 - 4500 EUR', '4500 - 5000 EUR', '5000 - 6000 EUR', '6000 - 7000 EUR', '7000 - 8000 EUR',
      '8000 - 9000 EUR', 'EUR 9000 >', 'Onbekend', 'Geen/betreft ZZP',
    ],
  },
  customText11: {
    label: 'Uurtarief range (ZZP/interim)',
    opties: [
      'Geen/betreft loondienst', '< 70', '70 - 80', '80 - 90', '90 - 100', '100 - 110', '110 - 120', '120 - 140', '140 of meer',
    ],
  },
  address: { label: 'Woonplaats', opties: null },
  employmentPreference: { label: 'Voorkeur dienstverband gewenst', opties: ['Loondienst', 'Interim'] },
  status: {
    label: 'Status',
    opties: ['OTW', 'Placeable', 'Door ons geplaatst', 'Geen specialist', 'DNC', 'New Lead'],
  },
}

function bouwSysteemPrompt(): string {
  const veldenTekst = Object.entries(VELD_DEFINITIES)
    .map(([naam, def]) => {
      const optiesTekst = def.opties ? ` — toegestane waarden: ${def.opties.map((o) => `"${o}"`).join(', ')}` : ' — vrije tekst (alleen plaatsnaam)'
      return `- ${naam} (${def.label})${optiesTekst}`
    })
    .join('\n')

  return (
    'Je analyseert de samenvatting van een telefoongesprek tussen een recruitment-consultant en een kandidaat. ' +
    'Je taak: detecteer of de kandidaat expliciet een van de volgende 5 Bullhorn-velden heeft genoemd als ' +
    'GEWIJZIGD (niet alleen bevestigd/hetzelfde gebleven) ten opzichte van de huidige waarde die je meekrijgt.\n\n' +
    `Velden:\n${veldenTekst}\n\n` +
    'Regels:\n' +
    '- Alleen een suggestie teruggeven als de samenvatting een DUIDELIJKE, EXPLICIETE, AL DOORGEVOERDE wijziging ' +
    'noemt — nooit raden of afleiden uit vage aanwijzingen.\n' +
    '- Twijfelende/hypothetische taal telt NIET als wijziging: "overweegt", "denkt na over", "staat open voor", ' +
    '"misschien", "zou eventueel willen" zijn GEEN reden voor een suggestie — alleen een reeds gebeurde of ' +
    'stellig aangekondigde wijziging ("ben verhuisd naar", "verdien nu", "werk sinds vorige maand als", ' +
    '"ik ga per 1 januari...") telt wel.\n' +
    '- Voor velden met toegestane waarden: kies altijd exact één van de gegeven opties, nooit een eigen ' +
    'formulering. Kies de best passende range/optie als een concreet bedrag genoemd wordt.\n' +
    '- Voor "address": geef alleen de plaatsnaam terug (nooit een postcode of straatnaam verzinnen).\n' +
    '- Als de nieuwe waarde al gelijk is aan de huidige waarde: geen suggestie voor dat veld.\n' +
    '- Geen enkele wijziging gevonden? Geef een lege array terug: []\n\n' +
    'Geef uitsluitend een JSON-array terug, zonder tekst daarbuiten, in dit exacte formaat:\n' +
    '[{"field": "<veldnaam>", "suggested_value": "<nieuwe waarde>", "quote": "<kort citaat uit de samenvatting als onderbouwing>"}]'
  )
}

const SYSTEEM_PROMPT = bouwSysteemPrompt()

export interface VeldSuggestie {
  field: string
  suggested_value: string
  quote: string
}

interface HuidigeVelden {
  customText22: string | null
  customText11: string | null
  city: string | null
  employmentPreference: string | null
  status: string | null
}

/**
 * Detecteert veldwijzigingen in een gesprekssamenvatting. Bij een parse- of
 * API-fout: lege array (geen suggestie is veiliger dan een gok), nooit
 * crashen — één mislukte extractie mag de rest van een sync-batch niet
 * blokkeren.
 */
export async function detecteerVeldwijzigingen(summary: string, huidigeVelden: HuidigeVelden): Promise<VeldSuggestie[]> {
  const huidigeVeldenTekst = [
    `customText22 (Salaris range): ${huidigeVelden.customText22 ?? 'onbekend'}`,
    `customText11 (Uurtarief range): ${huidigeVelden.customText11 ?? 'onbekend'}`,
    `address (huidige plaatsnaam): ${huidigeVelden.city ?? 'onbekend'}`,
    `employmentPreference: ${huidigeVelden.employmentPreference ?? 'onbekend'}`,
    `status: ${huidigeVelden.status ?? 'onbekend'}`,
  ].join('\n')

  let response: Response
  try {
    response = await fetchMetTimeout(
      'https://api.anthropic.com/v1/messages',
      {
        method: 'POST',
        headers: claudeHeaders(),
        body: JSON.stringify({
          model: CLAUDE_MODEL,
          max_tokens: CLAUDE_MAX_TOKENS,
          system: SYSTEEM_PROMPT,
          messages: [
            {
              role: 'user',
              content: `HUIDIGE WAARDEN IN BULLHORN:\n${huidigeVeldenTekst}\n\nGESPREKSSAMENVATTING:\n${summary}`,
            },
          ],
        }),
      },
      CLAUDE_TIMEOUT_MS,
    )
  } catch (err) {
    console.error('[call-insights] Claude-aanroep gaf een netwerkfout:', err)
    return []
  }

  if (!response.ok) {
    console.error(`[call-insights] Claude-aanroep mislukt: ${response.status} ${await response.text()}`)
    return []
  }

  const data = await response.json()
  const raw: string = data?.content?.[0]?.text?.trim() ?? ''
  const tekst = stripMarkdownCodeblock(raw)
  const start = tekst.indexOf('[')
  if (start < 0) {
    console.error(`[call-insights] Geen JSON-array in Claude-response: ${raw.slice(0, 300)}`)
    return []
  }

  try {
    const parsed = JSON.parse(tekst.slice(start))
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item) => item && typeof item.field === 'string' && Object.keys(VELD_DEFINITIES).includes(item.field) && item.suggested_value)
      .map((item) => ({
        field: String(item.field),
        suggested_value: String(item.suggested_value),
        quote: String(item.quote ?? ''),
      }))
  } catch (err) {
    console.error(`[call-insights] JSON-parsefout in Claude-response: ${raw.slice(0, 300)}`, err)
    return []
  }
}

export function schatKostenUsd(usage: { input_tokens?: number; output_tokens?: number } | undefined): number {
  if (!usage) return 0
  return (usage.input_tokens ?? 0) * PRIJS_PER_TOKEN_USD.input + (usage.output_tokens ?? 0) * PRIJS_PER_TOKEN_USD.output
}
