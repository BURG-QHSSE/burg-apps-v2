// Bullhorn REST-koppeling voor de call-insights Edge Function.
//
// Zelfde OAuth2/sessie-cache-aanpak als kandidaat-matcher/bullhorn.ts (zie
// die file voor de volledige uitleg van de login-stappen) — bewust
// gedupliceerd i.p.v. cross-function geïmporteerd, want elke Supabase Edge
// Function is een losstaande deploy-eenheid in dit project (geen gedeelde
// _shared-map). Gebruikt dezelfde BH_CLIENT_ID/BH_CLIENT_SECRET/BH_USERNAME/
// BH_PASSWORD-secrets en dezelfde bullhorn_session_cache-tabel (één rij,
// service-role-only) — één Bullhorn-service-account, gedeeld tussen beide
// functies.

const AUTH_URL = 'https://auth.bullhornstaffing.com/oauth/authorize'
const TOKEN_URL = 'https://auth.bullhornstaffing.com/oauth/token'
const LOGIN_URL = 'https://rest.bullhornstaffing.com/rest-services/login'

const REFRESH_MARGE_SECONDEN = 120
const BULLHORN_TIMEOUT_MS = 30_000

async function fetchMetTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

export interface BullhornSession {
  BhRestToken: string
  restUrl: string
}

interface BullhornCredentials {
  clientId: string
  clientSecret: string
  username: string
  password: string
}

function readCredentialsFromEnv(): BullhornCredentials {
  const clientId = Deno.env.get('BH_CLIENT_ID')
  const clientSecret = Deno.env.get('BH_CLIENT_SECRET')
  const username = Deno.env.get('BH_USERNAME')
  const password = Deno.env.get('BH_PASSWORD')
  if (!clientId || !clientSecret || !username || !password) {
    throw new Error('Bullhorn-secrets ontbreken (BH_CLIENT_ID/BH_CLIENT_SECRET/BH_USERNAME/BH_PASSWORD)')
  }
  return { clientId, clientSecret, username, password }
}

async function bullhornLogin(): Promise<BullhornSession> {
  const creds = readCredentialsFromEnv()

  const authParams = new URLSearchParams({
    client_id: creds.clientId,
    response_type: 'code',
    action: 'Login',
    username: creds.username,
    password: creds.password,
  })
  const authResponse = await fetchMetTimeout(`${AUTH_URL}?${authParams}`, { redirect: 'manual' }, BULLHORN_TIMEOUT_MS)

  let code: string | null = null
  const location = authResponse.headers.get('Location')
  if (authResponse.status >= 300 && authResponse.status < 400 && location) {
    const redirectUrl = new URL(location, AUTH_URL)
    code = redirectUrl.searchParams.get('code')
  } else if (authResponse.status === 200) {
    code = new URL(authResponse.url).searchParams.get('code')
  }

  if (!code) {
    throw new Error(
      `Geen authorization code gevonden bij Bullhorn-login (status ${authResponse.status}, location=${location ?? 'geen'})`,
    )
  }

  const tokenParams = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
  })
  const tokenResponse = await fetchMetTimeout(`${TOKEN_URL}?${tokenParams}`, { method: 'POST' }, BULLHORN_TIMEOUT_MS)
  if (!tokenResponse.ok) {
    throw new Error(`Bullhorn token-aanvraag mislukt: ${tokenResponse.status} ${await tokenResponse.text()}`)
  }
  const tokenData = await tokenResponse.json()
  const accessToken = tokenData.access_token
  if (!accessToken) {
    throw new Error('Bullhorn token-response bevat geen access_token')
  }

  const loginParams = new URLSearchParams({ version: '2.0', access_token: accessToken })
  const loginResponse = await fetchMetTimeout(`${LOGIN_URL}?${loginParams}`, {}, BULLHORN_TIMEOUT_MS)
  if (!loginResponse.ok) {
    throw new Error(`Bullhorn rest-services/login mislukt: ${loginResponse.status} ${await loginResponse.text()}`)
  }
  const loginData = await loginResponse.json()
  if (!loginData.BhRestToken || !loginData.restUrl) {
    throw new Error('Bullhorn login-response mist BhRestToken/restUrl')
  }
  return { BhRestToken: loginData.BhRestToken, restUrl: loginData.restUrl }
}

export async function getBullhornSession(
  // deno-lint-ignore no-explicit-any
  supabaseAdmin: any,
): Promise<BullhornSession> {
  const { data: cached } = await supabaseAdmin
    .from('bullhorn_session_cache')
    .select('bh_rest_token, rest_url, verloopt_op')
    .eq('id', 1)
    .maybeSingle()

  if (cached?.bh_rest_token && cached?.rest_url && cached?.verloopt_op) {
    const resteertSeconden = (new Date(cached.verloopt_op).getTime() - Date.now()) / 1000
    if (resteertSeconden > REFRESH_MARGE_SECONDEN) {
      return { BhRestToken: cached.bh_rest_token, restUrl: cached.rest_url }
    }
  }
  return forceerNieuweSessie(supabaseAdmin)
}

async function forceerNieuweSessie(
  // deno-lint-ignore no-explicit-any
  supabaseAdmin: any,
): Promise<BullhornSession> {
  const session = await bullhornLogin()
  const verloeptOp = new Date(Date.now() + 1140 * 1000).toISOString()
  await supabaseAdmin
    .from('bullhorn_session_cache')
    .upsert(
      { id: 1, bh_rest_token: session.BhRestToken, rest_url: session.restUrl, verloopt_op: verloeptOp, updated_at: new Date().toISOString() },
      { onConflict: 'id' },
    )
  return session
}

/** Voert een Bullhorn GET uit; bij 401 wordt één keer opnieuw ingelogd en herhaald. */
export async function bullhornGet(
  // deno-lint-ignore no-explicit-any
  supabaseAdmin: any,
  session: BullhornSession,
  path: string,
  params: Record<string, string>,
): Promise<{ data: unknown; session: BullhornSession }> {
  const url = `${session.restUrl}${path}?${new URLSearchParams({ ...params, BhRestToken: session.BhRestToken })}`
  let response = await fetchMetTimeout(url, {}, BULLHORN_TIMEOUT_MS)

  if (response.status === 401) {
    session = await forceerNieuweSessie(supabaseAdmin)
    const retryUrl = `${session.restUrl}${path}?${new URLSearchParams({ ...params, BhRestToken: session.BhRestToken })}`
    response = await fetchMetTimeout(retryUrl, {}, BULLHORN_TIMEOUT_MS)
  }

  if (!response.ok) {
    throw new Error(`Bullhorn-aanroep ${path} mislukt: ${response.status} ${await response.text()}`)
  }
  return { data: await response.json(), session }
}

/**
 * Voert een Bullhorn POST uit (partiële update van een bestaande entity —
 * Bullhorn's REST API gebruikt hiervoor POST, geen PUT/PATCH); bij 401 wordt
 * één keer opnieuw ingelogd en herhaald. Geen precedent hiervoor in
 * kandidaat-matcher (die schrijft alleen via DELETE op Note) — nieuw, maar
 * zelfde retry-stijl als bullhornGet.
 */
export async function bullhornPost(
  // deno-lint-ignore no-explicit-any
  supabaseAdmin: any,
  session: BullhornSession,
  path: string,
  body: Record<string, unknown>,
): Promise<{ data: unknown; session: BullhornSession }> {
  const url = `${session.restUrl}${path}?${new URLSearchParams({ BhRestToken: session.BhRestToken })}`
  let response = await fetchMetTimeout(
    url,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
    BULLHORN_TIMEOUT_MS,
  )

  if (response.status === 401) {
    session = await forceerNieuweSessie(supabaseAdmin)
    const retryUrl = `${session.restUrl}${path}?${new URLSearchParams({ BhRestToken: session.BhRestToken })}`
    response = await fetchMetTimeout(
      retryUrl,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
      BULLHORN_TIMEOUT_MS,
    )
  }

  if (!response.ok) {
    throw new Error(`Bullhorn-schrijfactie ${path} mislukt: ${response.status} ${await response.text()}`)
  }
  return { data: await response.json(), session }
}

/**
 * Normaliseert een NL-telefoonnummer naar de laatste 9 cijfers (zonder
 * landcode/trunk-prefix), zodat we ongeacht of Bullhorn/3CX het nummer als
 * "+31612345678", "0031612345678" of "0612345678" heeft opgeslagen, toch
 * matchen. Retourneert null als er te weinig cijfers overblijven om
 * betrouwbaar op te zoeken (voorkomt brede, onbedoelde matches).
 */
export function normaliseerTelefoonnummer(ruw: string): string | null {
  const cijfers = ruw.replace(/\D/g, '')
  const laatste9 = cijfers.slice(-9)
  return laatste9.length === 9 ? laatste9 : null
}

export interface CandidateInsightsVelden {
  id: number
  customText22: string | null
  customText11: string | null
  address: { address1?: string; address2?: string; city?: string; state?: string; zip?: string; countryID?: number } | null
  employmentPreference: string | null
  status: string | null
}

export async function getCandidateInsightsVelden(
  // deno-lint-ignore no-explicit-any
  supabaseAdmin: any,
  session: BullhornSession,
  candidateId: number,
): Promise<{ velden: CandidateInsightsVelden; session: BullhornSession }> {
  const { data, session: newSession } = await bullhornGet(supabaseAdmin, session, `entity/Candidate/${candidateId}`, {
    fields: 'id,customText22,customText11,address,employmentPreference,status',
  })
  // deno-lint-ignore no-explicit-any
  const entity = (data as any)?.data ?? {}
  // Bullhorn's employmentPreference is een ECHT multi-select veld (een
  // kandidaat kan open staan voor zowel Loondienst als Interim tegelijk) en
  // komt als array terug (bv. ["Loondienst","Interim"]) — genormaliseerd
  // naar een leesbare, komma-gescheiden string ("Loondienst, Interim") i.p.v.
  // alleen het eerste element te pakken (zou een echte dubbele voorkeur
  // stilzwijgend afknippen). Zie resolveSuggestion in index.ts voor de
  // omgekeerde normalisatie (string -> array) bij het terugschrijven.
  const employmentPreferenceRaw = entity.employmentPreference
  const employmentPreference = Array.isArray(employmentPreferenceRaw)
    ? employmentPreferenceRaw.length > 0
      ? employmentPreferenceRaw.join(', ')
      : null
    : (employmentPreferenceRaw ?? null)
  return {
    velden: {
      id: entity.id,
      customText22: entity.customText22 ?? null,
      customText11: entity.customText11 ?? null,
      address: entity.address ?? null,
      employmentPreference,
      status: entity.status ?? null,
    },
    session: newSession,
  }
}
