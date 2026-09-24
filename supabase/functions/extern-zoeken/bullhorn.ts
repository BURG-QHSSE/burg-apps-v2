// Bullhorn REST-koppeling voor de extern-zoeken Edge Function: alleen lezen,
// om de werklocatie (postcode) van een vacature op te halen.
//
// Login/sessie-cache gekopieerd uit call-insights/bullhorn.ts (elke Edge
// Function is een losse deploy-eenheid, geen gedeelde _shared-map). Zelfde
// BH_*-secrets en dezelfde bullhorn_session_cache-rij.

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

export interface VacatureLocatie {
  postcode: string | null
  plaats: string | null
  bron: 'vacature' | 'bedrijf' | null
}

/**
 * Postcode van de werklocatie: eerst het adres op de vacature (JobOrder) zelf,
 * anders het adres van het klantbedrijf. Het vacature-adres gaat voor, want
 * dat kan een andere vestiging zijn dan het hoofdkantoor (bijv. 23300:
 * Dordrecht vs. Son).
 */
export async function getVacatureLocatie(
  // deno-lint-ignore no-explicit-any
  supabaseAdmin: any,
  vacatureId: number,
): Promise<VacatureLocatie> {
  const session = await getBullhornSession(supabaseAdmin)
  const { data } = await bullhornGet(supabaseAdmin, session, `entity/JobOrder/${vacatureId}`, {
    fields: 'id,address,clientCorporation(address)',
  })
  // deno-lint-ignore no-explicit-any
  const entity = (data as any)?.data
  const vacature = entity?.address
  const bedrijf = entity?.clientCorporation?.address
  if (vacature?.zip?.trim()) return { postcode: vacature.zip.trim(), plaats: vacature.city?.trim() || null, bron: 'vacature' }
  if (bedrijf?.zip?.trim()) return { postcode: bedrijf.zip.trim(), plaats: bedrijf.city?.trim() || null, bron: 'bedrijf' }
  return { postcode: null, plaats: null, bron: null }
}
