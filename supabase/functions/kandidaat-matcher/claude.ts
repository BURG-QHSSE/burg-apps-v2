// Claude-scoring van een geanonimiseerd kandidaatprofiel tegen een
// vacaturetekst. Poort van QHSSE_SYSTEEM_PROMPT / rank_kandidaat() /
// bereid_vacaturetekst_voor_cache() uit server.py (kandidaat-ranker-repo) —
// systeemprompt letterlijk overgenomen (Nederlandstalig, QHSSE-context).

// Exported zodat index.ts dit kan meeschrijven naar matching_resultaten.model,
// voor traceerbaarheid van oude scores naar het model dat ze produceerde.
export const CLAUDE_MODEL = 'claude-sonnet-5'
// Was 400 op Sonnet 4.6. Sonnet 5 gebruikt een nieuwe tokenizer (~30% meer
// tokens voor dezelfde tekst) - een Nederlandse onderbouwing van 2-3 zinnen
// kost dus meer output-tokens dan voorheen bij hetzelfde teken-aantal. Ruim
// opgehoogd zodat de JSON-output niet afgekapt raakt (stop_reason=max_tokens).
const CLAUDE_MAX_TOKENS = 600

// Sonnet 5-tarieven per token (uit $/1M-tokens; goedkoper dan Sonnet 4.6's
// $3/$15), voor de kostenlimiet per run (zie MAX_KOSTEN_PER_RUN_USD in
// index.ts). Cache-write/-read zijn de standaard Anthropic-verhoudingen
// (~1.25x resp. ~0.1x het basis-inputtarief).
const PRIJS_PER_TOKEN_USD = {
  input: 2.0 / 1_000_000,
  output: 10.0 / 1_000_000,
  cacheWrite: 2.5 / 1_000_000,
  cacheRead: 0.2 / 1_000_000,
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

// Ophogen bij elke inhoudelijke wijziging van QHSSE_SYSTEEM_PROMPT (nieuwe
// instructie, andere scoringsrichtlijn, etc.), zodat oude scores in
// matching_resultaten.prompt_versie traceerbaar blijven naar de promptversie
// die ze daadwerkelijk produceerde. Zie ook _evals/run-evals.ts — vóór het
// deployen van zo'n wijziging eerst de evals draaien.
export const PROMPT_VERSIE = 'v5-linkedin-2026-09-16'

export const QHSSE_SYSTEEM_PROMPT =
  'Je bent een ervaren recruitment-specialist binnen QHSSE (Quality, Health, Safety, Security, Environment). ' +
  'Je beoordeelt in hoeverre een kandidaat past bij een specifieke vacature, op basis van de aangeleverde ' +
  'vacature-informatie en het beschikbare kandidaatprofiel.\n\n' +
  'De vacature-informatie kan in verschillende vormen worden aangeleverd: als zelf geschreven, doorlopende ' +
  'vacaturetekst, of als een ruwe "job pull" rechtstreeks vanuit Bullhorn (een minder geordende export met ' +
  'functietitel, eisen en kenmerken). Interpreteer beide vormen op dezelfde manier: haal er de functie-eisen, ' +
  'het gewenste niveau, benodigde certificeringen en relevante achtergrond uit, ongeacht hoe de tekst is ' +
  'opgesteld of gestructureerd.\n\n' +
  'Het kandidaatprofiel is geanonimiseerd: de naam van de kandidaat is overal vervangen door een label in het ' +
  'formaat "KANDIDAAT_XXXXXX". Gebruik dat label NOOIT in je onderbouwing — schrijf altijd "de kandidaat" (of ' +
  '"hij"/"zij"/"deze persoon" als dat prettiger leest), ook als het label als onderwerp van een zin zou passen.\n\n' +
  'Het CV-veld van de kandidaat kan een sectie "INTAKE DATA" bevatten naast de CV-inhoud zelf. Als die sectie ' +
  'aanwezig is en inhoud heeft, neem die nadrukkelijk mee in je beoordeling, intake-notities kunnen relevante ' +
  'context geven (zoals beschikbaarheid, voorkeuren, of aandachtspunten van de consultant) die niet in een ' +
  'regulier CV staat.\n\n' +
  'Het CV-veld kan daarnaast een sectie "LINKEDIN DATA" bevatten: werkervaring, opleiding en vaardigheden zoals ' +
  'de kandidaat die zelf op LinkedIn heeft ingevuld. Behandel dit als een volwaardige, aanvullende bron — het ' +
  'kan informatie bevatten die niet in het CV staat (bijvoorbeeld een recentere functie, extra certificeringen, ' +
  'of vaardigheden) en die moet je gewoon meewegen. Let er wel op dat deze sectie vaak overlapt met CV DATA ' +
  '(dezelfde werkgevers/functies uit hetzelfde arbeidsverleden) — als dezelfde werkervaring in beide secties ' +
  'staat, is dat één periode werkervaring, geen twee: tel die niet dubbel mee in je beoordeling. Deze sectie ' +
  'kan ontbreken of zeer beperkt zijn (niet elke kandidaat heeft een uitgebreid LinkedIn-profiel, en niet elke ' +
  'kandidaat is al verrijkt) — dat zegt niets over de kandidaat zelf en mag geen negatief signaal zijn in je ' +
  'beoordeling.\n\n' +
  'Beoordeel de kandidaat op: relevante werkervaring en functieachtergrond, vakinhoudelijke kennis en ' +
  'certificeringen die aansluiten bij de vacature-eisen, jaren ervaring in relatie tot het gevraagde niveau, ' +
  'het huidige/gewenste specialisme in relatie tot de vacature, relevante context uit de intake-data indien ' +
  'aanwezig, en aanvullende profielinformatie uit de LinkedIn-sectie indien aanwezig.\n\n' +
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
  // Geen 'anthropic-beta: prompt-caching-2024-07-31' meer - prompt caching is
  // al lang GA, die beta-header was hier stale (Sonnet 4.6 had 'm ook niet
  // meer nodig, maar hij deed geen kwaad; opgeruimd tijdens de Sonnet 5-migratie).
  return {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
  }
}

/**
 * Zoekt het eerste text-block in de content-array i.p.v. blind content[0] aan
 * te nemen. Sonnet 5 draait adaptive thinking aan zodra `thinking` ontbreekt
 * (anders dan Sonnet 4.6, dat zonder expliciete config thinking-uit draaide)
 * - content[0] zou dan een thinking-block kunnen zijn i.p.v. het text-block,
 * wat rankKandidaat leeg zou laten teruggeven. Wij zetten thinking hieronder
 * expliciet uit (zie CLAUDE_MODEL-aanroepen), maar deze helper is een
 * goedkope garantie tegen exact deze bug - die eerder al eens misging bij de
 * Sonnet-wissel van de call-insights Edge Function.
 */
function pakTextBlock(content: unknown): string {
  if (!Array.isArray(content)) return ''
  const blok = content.find((b): b is { type: string; text?: string } => b?.type === 'text')
  return blok?.text?.trim() ?? ''
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
  // true bij een afgekapte Claude-respons (stop_reason=max_tokens) of een
  // mislukte JSON-parse (RANK_FALLBACK) - in beide gevallen is de score
  // minder betrouwbaar dan een normaal geslaagde beoordeling. Gebruikt door
  // KandidaatMatcher.jsx om een ⚠️-indicator te tonen.
  laagVertrouwen: boolean
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
        // Expliciet uit i.p.v. weggelaten - op Sonnet 5 draait adaptive
        // thinking automatisch aan zodra dit veld ontbreekt (zie
        // pakTextBlock hierboven). Deze aanroep schrijft alleen de cache
        // (max_tokens: 0, geen echte output), dus thinking heeft hier toch
        // geen functie.
        thinking: { type: 'disabled' },
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
    // Volledige detail (incl. de ruwe upstream-responsebody, die het model
    // kan noemen) alleen server-side loggen - niet in de Error die via
    // index.ts in matching_resultaten.foutmelding terechtkomt en dus door de
    // consultant gezien wordt. Zie de opdracht: welke AI hierachter zit mag
    // nergens in de UI zichtbaar zijn.
    console.error(`[kandidaat-matcher] Voorbereiding mislukt: ${response.status} ${await response.text()}`)
    throw new Error(`Voorbereiding mislukt (status ${response.status})`)
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
        // Expliciet uit: dit is een gebonden classificatietaak (één JSON-
        // object, vaste velden) met een krappe max_tokens - adaptive
        // thinking zou daar zinvolle output-ruimte van kunnen opeten
        // (stop_reason=max_tokens) voor weinig kwaliteitswinst op deze taak.
        thinking: { type: 'disabled' },
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
    // Zelfde reden als bij prewarmCache hierboven: ruwe body alleen loggen,
    // niet in de foutmelding die de consultant te zien krijgt.
    console.error(`[kandidaat-matcher] Scoringsaanroep mislukt voor ${label}: ${response.status} ${await response.text()}`)
    throw new Error(`Scoringsaanroep mislukt (status ${response.status})`)
  }

  const data = await response.json()
  const kostenUsd = berekenKostenUsd(data?.usage)
  // Ook gebruikt hieronder om laagVertrouwen te zetten - een afgekapte
  // respons kan een onvolledig/verminkt oordeel betekenen, ook als de JSON
  // toevallig nog wel parseert.
  const afgekapt = data?.stop_reason === 'max_tokens'
  if (afgekapt) {
    console.warn(`[kandidaat-matcher] WAARSCHUWING: response afgekapt (stop_reason=max_tokens) voor ${label}`)
  }
  const raw: string = pakTextBlock(data?.content)
  const tekst = stripMarkdownCodeblock(raw)
  const start = tekst.indexOf('{')

  if (start >= 0) {
    try {
      const parsed = JSON.parse(tekst.slice(start))
      const score = Math.max(0, Math.min(100, Math.trunc(Number(parsed.score) || 0)))
      return { score, onderbouwing: String(parsed.onderbouwing ?? ''), kostenUsd, laagVertrouwen: afgekapt }
    } catch {
      // valt door naar fallback hieronder
    }
  }

  console.error(`[kandidaat-matcher] Geen geldige JSON in Claude-response voor ${label}: ${raw.slice(0, 300)}`)
  return { score: 0, onderbouwing: RANK_FALLBACK, kostenUsd, laagVertrouwen: true }
}
