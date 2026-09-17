// 3CX XAPI (Configuration API) koppeling — vult dezelfde `recordings`/
// `recording_participant` staging-tabellen als 3CX's eigen "Data
// Connectors"-feature (Integrations -> Data Connectors, "Recordings Data"),
// die sinds 11/12 september 2026 geen nieuwe data meer doorzet naar deze
// database (3CX-side storing, los ticket bij FM Telecom, oorzaak nog
// onbekend). Deze module haalt dezelfde recordings/transcripties/summaries
// rechtstreeks op via de 3CX XAPI, zodat de rest van call-insights
// (call_insights_nieuwe_recordings, syncNewCalls in index.ts) ongewijzigd
// blijft werken, ongeacht of de Data Connector het ooit weer oppakt.
//
// Vereist een Service Principal in 3CX (Admin -> Integrations -> API) met
// Configuration API (XAPI) rol "System Owner" — rol "Gebruiker" gaf een kale
// 403 op alle entities (ook Users), dus dit is geen Recordings-specifieke
// beperking maar een blanket rol-vereiste.

const TOKEN_TIMEOUT_MS = 15_000
const XAPI_TIMEOUT_MS = 30_000

interface CxCredentials {
  baseUrl: string
  clientId: string
  clientSecret: string
}

function leesCredentialsUitEnv(): CxCredentials {
  const baseUrl = Deno.env.get('CX_API_BASE_URL')
  const clientId = Deno.env.get('CX_API_CLIENT_ID')
  const clientSecret = Deno.env.get('CX_API_CLIENT_SECRET')
  if (!baseUrl || !clientId || !clientSecret) {
    throw new Error('3CX API-secrets ontbreken (CX_API_BASE_URL/CX_API_CLIENT_ID/CX_API_CLIENT_SECRET)')
  }
  return { baseUrl: baseUrl.replace(/\/$/, ''), clientId, clientSecret }
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

/**
 * Geen sessie-cache zoals bij Bullhorn — client-credentials-token-aanvragen
 * zijn een enkele snelle call en dit draait hooguit elke 15 min, dus de
 * overhead van steeds opnieuw inloggen is verwaarloosbaar en scheelt een
 * aparte cache-tabel.
 */
async function haalToken(creds: CxCredentials): Promise<string> {
  const response = await fetchMetTimeout(
    `${creds.baseUrl}/connect/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
      }),
    },
    TOKEN_TIMEOUT_MS,
  )
  if (!response.ok) {
    throw new Error(`3CX token-aanvraag mislukt: ${response.status} ${await response.text()}`)
  }
  const data = await response.json()
  if (!data.access_token) throw new Error('3CX token-response bevat geen access_token')
  return data.access_token as string
}

export interface CxRecording {
  recordingUrl: string
  startTime: string
  endTime: string | null
  summary: string | null
  transcription: string | null
  sentimentScore: number | null
  fromDnType: number
  fromDn: string
  fromCallerNumber: string
  fromDisplayName: string | null
  fromDidNumber: string | null
  toDnType: number
  toDn: string
  toCallerNumber: string
  toDisplayName: string | null
  toDidNumber: string | null
}

const SELECT_VELDEN = [
  'Id', 'RecordingUrl', 'StartTime', 'EndTime', 'Summary', 'Transcription', 'SentimentScore',
  'FromDnType', 'FromDn', 'FromCallerNumber', 'FromDisplayName', 'FromDidNumber',
  'ToDnType', 'ToDn', 'ToCallerNumber', 'ToDisplayName', 'ToDidNumber',
].join(',')

/**
 * Haalt recordings op die na `sinds` gestart zijn, met paginering via
 * @odata.nextLink. `limiet` begrenst het totaal aantal opgehaalde recordings
 * (niet per pagina) zodat een enkele sync-aanroep bij een grote achterstand
 * niet onbegrensd doorloopt binnen de Edge Function-tijdslimiet.
 *
 * NIEUWSTE EERST (desc) i.p.v. chronologisch (asc) — ontdekt op 2026-09-17
 * bij het testen van de vaste 24-uur-terugkijkperiode (zie XAPI_LOOKBACK_MS
 * in index.ts): 3CX's XAPI gaf bij een breed `sinds`-venster met veel
 * matches na de eerste pagina van 100 GEEN `@odata.nextLink` terug, ook al
 * bestonden er duidelijk meer (nieuwere) recordings. Met `asc` bleef zo'n
 * aanroep permanent in het oudste deel van het venster hangen en bereikte
 * "nu" nooit. Met `desc` valt precies datzelfde 100-record-plafond aan de
 * OUDE kant van het venster (die al lang gesynchroniseerd is, dus geen
 * schade), terwijl de nieuwste — en dus meest relevante — recordings altijd
 * als eerste binnenkomen, ongeacht of paginering daarna stopt.
 */
export async function haalRecordingsOp(sinds: Date, limiet: number): Promise<CxRecording[]> {
  const creds = leesCredentialsUitEnv()
  const token = await haalToken(creds)

  const resultaten: CxRecording[] = []
  const filter = `StartTime gt ${sinds.toISOString()}`
  let url: string | null =
    `${creds.baseUrl}/xapi/v1/Recordings?$filter=${encodeURIComponent(filter)}&$orderby=StartTime desc&$top=100&$select=${SELECT_VELDEN}`

  while (url && resultaten.length < limiet) {
    const response = await fetchMetTimeout(url, { headers: { Authorization: `Bearer ${token}` } }, XAPI_TIMEOUT_MS)
    if (!response.ok) {
      throw new Error(`3CX Recordings-aanroep mislukt: ${response.status} ${await response.text()}`)
    }
    // deno-lint-ignore no-explicit-any
    const data: any = await response.json()
    for (const r of data.value ?? []) {
      resultaten.push({
        recordingUrl: r.RecordingUrl,
        startTime: r.StartTime,
        endTime: r.EndTime ?? null,
        summary: r.Summary ?? null,
        transcription: r.Transcription ?? null,
        sentimentScore: r.SentimentScore ?? null,
        fromDnType: r.FromDnType,
        fromDn: r.FromDn,
        fromCallerNumber: r.FromCallerNumber,
        fromDisplayName: r.FromDisplayName ?? null,
        fromDidNumber: r.FromDidNumber ?? null,
        toDnType: r.ToDnType,
        toDn: r.ToDn,
        toCallerNumber: r.ToCallerNumber,
        toDisplayName: r.ToDisplayName ?? null,
        toDidNumber: r.ToDidNumber ?? null,
      })
      if (resultaten.length >= limiet) break
    }
    url = data['@odata.nextLink'] ?? null
  }

  return resultaten
}
