// Claude-aanroepen voor Extern Zoeken. Zelfde fetch-stijl als
// kandidaat-matcher/claude.ts (geen SDK in deze Edge Functions).

export const CLAUDE_MODEL = 'claude-sonnet-5'
// Ruim, want adaptive thinking (standaard aan op Sonnet 5) telt mee in
// max_tokens; de strategie-JSON zelf is maar ~1-2K tokens.
const CLAUDE_MAX_TOKENS = 8000
const CLAUDE_TIMEOUT_MS = 90_000

// Sonnet 5-tarieven per token, zelfde als kandidaat-matcher/claude.ts.
const PRIJS_PER_TOKEN_USD = { input: 2.0 / 1_000_000, output: 10.0 / 1_000_000 }

export const PROMPT_VERSIE = 'strategie-v3-2026-09-24'

// Werkwijze BURG (2026-09-24): locatie = postcode van de vestiging + vaste straal.
export const STRAAL_KM = 40

// Functietitels en trefwoorden accepteren boolean (AND/OR/NOT, aanhalingstekens).
// Locatie: BURG zoekt op de postcode van de vestiging met een straal van
// STRAAL_KM km, niet op losse plaatsnamen.
const STRATEGIE_SYSTEEM_PROMPT = `Je bent een ervaren sourcer binnen QHSSE (Quality, Health, Safety, Security, Environment) bij BURG QHSSE, een Nederlands recruitmentbureau. Je zet een vacature om in een zoekopdracht voor LinkedIn Recruiter.

Doel: een pool van ongeveer 300-600 resultaten waaruit een pipeline van ~200 passende kandidaten gehaald kan worden. Te smal (<150) is slechter dan iets te breed, want daarna volgt nog een beoordeling per kandidaat.

Richtlijnen:
- functietitels_boolean: alle gangbare Nederlandse én Engelse functietitels voor deze rol en directe varianten (bijv. coördinator/coordinator, adviseur/advisor, specialist, officer, KAM/QHSE/HSE/VGM-varianten). Alleen echte functietitels zoals mensen die op LinkedIn voeren, geen vakgebieden of omschrijvingen. Geen titels die duidelijk een niveau hoger of lager zitten (bijv. manager bij een coördinatorrol). Gebruik OR en aanhalingstekens rond meerwoordige titels. Geen NOT tenzij er een duidelijk storende titel is.
- trefwoorden_boolean: alleen de ÉÉN meest bepalende harde eis die letterlijk in profielen staat (meestal een diploma/certificaat zoals HVK of MVK), met al zijn synoniemen en schrijfwijzen via OR (bijv. HVK OR "Hogere Veiligheidskundige" OR "Hoger Veiligheidskundige"). Combineer NOOIT verschillende eisen met OR (dan wordt elke eis optioneel) en ook niet met AND (dan wordt de pool te klein); overige eisen horen bij harde_eisen en worden later per kandidaat beoordeeld. Laat leeg als er geen harde, zoekbare eis is.
- vestigingsplaats: de plaats waar de functie is (werklocatie van de opdrachtgever).
- postcode: de postcode van die vestiging (formaat "1234 AB") als die in de vacaturetekst staat. Verzin er nooit een; laat leeg als hij er niet in staat, dan vult de consultant hem in. Er wordt gezocht in een straal van ${STRAAL_KM} km rond deze postcode.
- vaardigheden: maximaal 6 bestaande LinkedIn-vaardigheden (één vaardigheid per regel, zoals ze op LinkedIn heten, geen combinaties met "/"), die sterk onderscheidend zijn.
- jaren_ervaring_min / jaren_ervaring_max: realistisch voor het niveau; max mag null zijn.
- uitsluiten_huidige_bedrijven: altijd "BURG QHSSE" plus eventueel de opdrachtgever als die in de tekst genoemd wordt.
- harde_eisen, pluspunten, knock_outs: kort en toetsbaar, voor het latere scoren per kandidaat.
- taal: of Engels en/of Nederlands vereist is volgens de vacature.
- toelichting: 2-4 zinnen waarom je deze keuzes maakt, voor de consultant die het controleert.
Schrijf alles in het Nederlands, behalve de zoektermen zelf waar Engels gangbaar is.`

const STRATEGIE_SCHEMA = {
  type: 'object',
  properties: {
    functietitel: { type: 'string' },
    functietitels_boolean: { type: 'string' },
    trefwoorden_boolean: { type: 'string' },
    vestigingsplaats: { type: 'string' },
    postcode: { type: 'string' },
    vaardigheden: { type: 'array', items: { type: 'string' } },
    jaren_ervaring_min: { type: 'integer' },
    jaren_ervaring_max: { type: ['integer', 'null'] },
    uitsluiten_huidige_bedrijven: { type: 'array', items: { type: 'string' } },
    ideaal_profiel: { type: 'string' },
    harde_eisen: { type: 'array', items: { type: 'string' } },
    pluspunten: { type: 'array', items: { type: 'string' } },
    knock_outs: { type: 'array', items: { type: 'string' } },
    engels_vereist: { type: 'boolean' },
    nederlands_vereist: { type: 'boolean' },
    toelichting: { type: 'string' },
  },
  required: [
    'functietitel', 'functietitels_boolean', 'trefwoorden_boolean', 'vestigingsplaats', 'postcode', 'vaardigheden',
    'jaren_ervaring_min', 'jaren_ervaring_max', 'uitsluiten_huidige_bedrijven', 'ideaal_profiel',
    'harde_eisen', 'pluspunten', 'knock_outs', 'engels_vereist', 'nederlands_vereist', 'toelichting',
  ],
  additionalProperties: false,
}

export interface Strategie {
  functietitel: string
  projectnaam: string
  functietitels_boolean: string
  trefwoorden_boolean: string
  vestigingsplaats: string
  postcode: string
  straal_km: number
  vaardigheden: string[]
  jaren_ervaring_min: number
  jaren_ervaring_max: number | null
  uitsluiten_huidige_bedrijven: string[]
  ideaal_profiel: string
  harde_eisen: string[]
  pluspunten: string[]
  knock_outs: string[]
  engels_vereist: boolean
  nederlands_vereist: boolean
  toelichting: string
}

function claudeHeaders(): Record<string, string> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY secret ontbreekt')
  return {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
  }
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

/** Vacaturetekst → Recruiter-zoekopdracht (zie STRATEGIE_SYSTEEM_PROMPT). */
export async function maakStrategie(
  vacaturetekst: string,
  vacatureId: string,
): Promise<{ strategie: Strategie; kostenUsd: number }> {
  const response = await fetchMetTimeout(
    'https://api.anthropic.com/v1/messages',
    {
      method: 'POST',
      headers: claudeHeaders(),
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: CLAUDE_MAX_TOKENS,
        system: STRATEGIE_SYSTEEM_PROMPT,
        output_config: { format: { type: 'json_schema', schema: STRATEGIE_SCHEMA } },
        messages: [{ role: 'user', content: `VACATURE:\n${vacaturetekst}` }],
      }),
    },
    CLAUDE_TIMEOUT_MS,
  )

  if (!response.ok) {
    // Ruwe body alleen server-side loggen, zelfde reden als in kandidaat-matcher:
    // welke AI hierachter zit hoort niet in de UI.
    console.error(`[extern-zoeken] Strategie-aanroep mislukt: ${response.status} ${await response.text()}`)
    throw new Error(`Zoekopdracht maken mislukt (status ${response.status})`)
  }

  const data = await response.json()
  if (data?.stop_reason === 'max_tokens') {
    throw new Error('Zoekopdracht maken mislukt (antwoord afgekapt)')
  }
  const tekst = (data?.content ?? []).find((b: { type: string }) => b.type === 'text')?.text ?? ''
  const parsed = JSON.parse(tekst)
  const kostenUsd =
    (data?.usage?.input_tokens ?? 0) * PRIJS_PER_TOKEN_USD.input +
    (data?.usage?.output_tokens ?? 0) * PRIJS_PER_TOKEN_USD.output

  // Projectnaam volgt de bestaande conventie in Recruiter: "Functie - vacaturenummer".
  const projectnaam = vacatureId ? `${parsed.functietitel} - ${vacatureId}` : parsed.functietitel
  return { strategie: { ...parsed, projectnaam, straal_km: STRAAL_KM }, kostenUsd }
}
