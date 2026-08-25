// Claude-scoring van een geanonimiseerd kandidaatprofiel tegen een
// vacaturetekst. Poort van QHSSE_SYSTEEM_PROMPT / rank_kandidaat() /
// bereid_vacaturetekst_voor_cache() uit server.py (kandidaat-ranker-repo) —
// systeemprompt letterlijk overgenomen (Nederlandstalig, QHSSE-context).

const CLAUDE_MODEL = 'claude-sonnet-4-6'
const CLAUDE_MAX_TOKENS = 400

// Sonnet 4.6-tarieven per token (uit $/1M-tokens), voor de kostenlimiet per
// run (zie MAX_KOSTEN_PER_RUN_USD in index.ts). Cache-write/-read zijn de
// standaard Anthropic-verhoudingen (~1.25x resp. ~0.1x het basis-inputtarief).
const PRIJS_PER_TOKEN_USD = {
  input: 3.0 / 1_000_000,
  output: 15.0 / 1_000_000,
  cacheWrite: 3.75 / 1_000_000,
  cacheRead: 0.3 / 1_000_000,
}

interface AnthropicUsage {
  input_tokens?: number
  output_tokens?: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
}

function berekenKostenUsd(usage: AnthropicUsage | undefined): number {
  if (!usage) return 0
  return (
    (usage.input_tokens ?? 0) * PRIJS_PER_TOKEN_USD.input +
    (usage.output_tokens ?? 0) * PRIJS_PER_TOKEN_USD.output +
    (usage.cache_creation_input_tokens ?? 0) * PRIJS_PER_TOKEN_USD.cacheWrite +
    (usage.cache_read_input_tokens ?? 0) * PRIJS_PER_TOKEN_USD.cacheRead
  )
}
// Zelfde read-timeout als CLAUDE_TIMEOUT in server.py (httpx.Timeout(read=90.0)) —
// zonder dit kan één hangende aanroep de hele ~150s Edge Function-batch opsouperen.
const CLAUDE_TIMEOUT_MS = 90_000

async function fetchMetTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

// Anthropic-minimum voor een cache-entry is 1024 tokens; richten op een
// veiligheidsmarge daarboven, zelfde constanten als in server.py.
const CACHE_DOEL_TOKENS = 1100
const CHARS_PER_TOKEN = 3.5

export const QHSSE_SYSTEEM_PROMPT =
  'Je bent een ervaren recruitment-specialist binnen QHSSE (Quality, Health, Safety, Security, Environment). ' +
  'Je beoordeelt in hoeverre een kandidaat past bij een specifieke vacature, op basis van de aangeleverde ' +
  'vacature-informatie en het beschikbare kandidaatprofiel.\n\n' +
  'De vacature-informatie kan in verschillende vormen worden aangeleverd: als zelf geschreven, doorlopende ' +
  'vacaturetekst, of als een ruwe "job pull" rechtstreeks vanuit Bullhorn (een minder geordende export met ' +
  'functietitel, eisen en kenmerken). Interpreteer beide vormen op dezelfde manier: haal er de functie-eisen, ' +
  'het gewenste niveau, benodigde certificeringen en relevante achtergrond uit, ongeacht hoe de tekst is ' +
  'opgesteld of gestructureerd.\n\n' +
  'Het CV-veld van de kandidaat kan een sectie "INTAKE DATA" bevatten naast de CV-inhoud zelf. Als die sectie ' +
  'aanwezig is en inhoud heeft, neem die nadrukkelijk mee in je beoordeling, intake-notities kunnen relevante ' +
  'context geven (zoals beschikbaarheid, voorkeuren, of aandachtspunten van de consultant) die niet in een ' +
  'regulier CV staat.\n\n' +
  'Beoordeel de kandidaat op: relevante werkervaring en functieachtergrond, vakinhoudelijke kennis en ' +
  'certificeringen die aansluiten bij de vacature-eisen, jaren ervaring in relatie tot het gevraagde niveau, ' +
  'het huidige/gewenste specialisme in relatie tot de vacature, en relevante context uit de intake-data ' +
  'indien aanwezig.\n\n' +
  'Belangrijk: als de intake-data een salarisverwachting of uurtarief bevat, neem dat NOOIT mee in je score of ' +
  'onderbouwing. Salaris/uurtarief wordt apart door de consultant beoordeeld via een losse filter, niet door ' +
  'jou. Een voorkeur voor dienstverband (bv. loondienst, interim, ZZP) mag je wel gewoon meewegen als de ' +
  'intake-data dat noemt — alleen salaris/uurtarief zijn uitgesloten van je beoordeling, verder niets.\n\n' +
  'Geef uitsluitend een JSON-object terug in dit exacte formaat, zonder tekst daarbuiten:\n' +
  '{"score": <getal van 0 tot 100>, "onderbouwing": "<2-3 zinnen in het Nederlands: belangrijkste sterke en zwakke punten>"}\n\n' +
  'Richtlijn voor de score: 90-100 = uitstekende match op alle belangrijke punten. ' +
  '70-89 = sterke match, enkele kleine afwijkingen. ' +
  '50-69 = redelijke match, mogelijk geschikt maar met duidelijke gaten. ' +
  'Onder 50 = zwakke match, waarschijnlijk niet geschikt.\n\n' +
  'Als er geen CV-tekst beschikbaar is voor deze kandidaat, baseer je de score uitsluitend op de overige ' +
  'beschikbare velden, en vermeld je dit expliciet in de onderbouwing, zodat duidelijk is dat deze score ' +
  'minder zekerheid heeft dan een score gebaseerd op een volledig CV.'

const RANK_FALLBACK = 'Kon niet beoordeeld worden door een technische fout'

function claudeHeaders(): Record<string, string> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY secret ontbreekt')
  return {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    'anthropic-beta': 'prompt-caching-2024-07-31',
    'content-type': 'application/json',
  }
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

/**
 * Vult de vacaturetekst aan tot de caching-drempel ruim overschreden is —
 * poort van bereid_vacaturetekst_voor_cache(). Zonder dit blijft caching
 * simpelweg uit (geen kostenbesparing, geen functionele impact) bij een
 * korte vacaturetekst.
 */
export function bereidVacaturetekstVoorCache(vacatureTekst: string): string {
  const gecombineerd = QHSSE_SYSTEEM_PROMPT + `VACATURE:\n${vacatureTekst}\n\n`
  const geschat = gecombineerd.length / CHARS_PER_TOKEN
  if (geschat >= CACHE_DOEL_TOKENS) return vacatureTekst

  const benodigdeTotaalChars = Math.floor(CACHE_DOEL_TOKENS * CHARS_PER_TOKEN)
  const tekort = benodigdeTotaalChars - gecombineerd.length

  const HEADER =
    '\n\n<!-- SYSTEEM: onderstaande opvultekst is technisch vereist voor cacheverwerking ' +
    'en bevat geen vacature-inhoud. Negeer alles tussen deze tags volledig. -->\n<!-- PAD: '
  const FOOTER = ' -->\n<!-- EINDE OPVULTEKST -->'
  const PAD_WOORDEN = 'de en of in op bij tot voor van is het een als ook zo '

  const xLengte = Math.max(0, tekort - HEADER.length - FOOTER.length)
  const nHerh = Math.floor(xLengte / PAD_WOORDEN.length) + 1
  const vulling = PAD_WOORDEN.repeat(nHerh).slice(0, xLengte)
  return vacatureTekst + HEADER + vulling + FOOTER
}

export interface RankResultaat {
  score: number
  onderbouwing: string
  kostenUsd: number
}

/**
 * Schrijft systeemprompt + vacaturetekst naar de Anthropic prompt-cache —
 * poort van prewarm_cache(). max_tokens: 0 zodat er geen outputkosten zijn;
 * de cache-entry ontstaat al door het verwerken van de input. Wordt vóór de
 * (parallelle) kandidaat-scoring van een batch aangeroepen, want zonder dit
 * racen de eerste N gelijktijdige rankKandidaat()-aanroepen om dezelfde
 * cache-entry en missen ze 'm allemaal (elk betaalt dan cache_creation
 * i.p.v. cache_read) — zelfde reden als in server.py.
 */
export async function prewarmCache(vacatureTekstVoorCache: string): Promise<{ kostenUsd: number }> {
  const response = await fetchMetTimeout(
    'https://api.anthropic.com/v1/messages',
    {
      method: 'POST',
      headers: claudeHeaders(),
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 0,
        system: [
          { type: 'text', text: QHSSE_SYSTEEM_PROMPT, cache_control: { type: 'ephemeral' } },
        ],
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: `VACATURE:\n${vacatureTekstVoorCache}\n\n`, cache_control: { type: 'ephemeral' } },
              { type: 'text', text: 'warmup' },
            ],
          },
        ],
      }),
    },
    CLAUDE_TIMEOUT_MS,
  )
  if (!response.ok) {
    throw new Error(`Anthropic prewarm mislukt: ${response.status} ${await response.text()}`)
  }
  const data = await response.json()
  return { kostenUsd: berekenKostenUsd(data?.usage) }
}

/** Scoort één geanonimiseerd kandidaatprofiel tegen de vacaturetekst. */
export async function rankKandidaat(
  vacatureTekstVoorCache: string,
  label: string,
  kandidaatPayload: Record<string, string>,
): Promise<RankResultaat> {
  const payloadTekst = Object.entries(kandidaatPayload)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')

  const response = await fetchMetTimeout(
    'https://api.anthropic.com/v1/messages',
    {
      method: 'POST',
      headers: claudeHeaders(),
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: CLAUDE_MAX_TOKENS,
        system: [
          { type: 'text', text: QHSSE_SYSTEEM_PROMPT, cache_control: { type: 'ephemeral' } },
        ],
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: `VACATURE:\n${vacatureTekstVoorCache}\n\n`, cache_control: { type: 'ephemeral' } },
              { type: 'text', text: `KANDIDAAT (${label}):\n${payloadTekst}` },
            ],
          },
        ],
      }),
    },
    CLAUDE_TIMEOUT_MS,
  )

  if (!response.ok) {
    throw new Error(`Anthropic-aanroep mislukt: ${response.status} ${await response.text()}`)
  }

  const data = await response.json()
  const kostenUsd = berekenKostenUsd(data?.usage)
  if (data?.stop_reason === 'max_tokens') {
    console.warn(`[kandidaat-matcher] WAARSCHUWING: response afgekapt (stop_reason=max_tokens) voor ${label}`)
  }
  const raw: string = data?.content?.[0]?.text?.trim() ?? ''
  const tekst = stripMarkdownCodeblock(raw)
  const start = tekst.indexOf('{')

  if (start >= 0) {
    try {
      const parsed = JSON.parse(tekst.slice(start))
      const score = Math.max(0, Math.min(100, Math.trunc(Number(parsed.score) || 0)))
      return { score, onderbouwing: String(parsed.onderbouwing ?? ''), kostenUsd }
    } catch {
      // valt door naar fallback hieronder
    }
  }

  console.error(`[kandidaat-matcher] Geen geldige JSON in Claude-response voor ${label}: ${raw.slice(0, 300)}`)
  return { score: 0, onderbouwing: RANK_FALLBACK, kostenUsd }
}
