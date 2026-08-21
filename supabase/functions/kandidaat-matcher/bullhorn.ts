// Bullhorn REST-koppeling voor de kandidaat-matcher Edge Function.
//
// OAuth2-stappenplan is een Deno/fetch-poort van connect_to_bullhorn() in
// bullhorn_sync/sync_candidates.py (kandidaat-ranker-repo):
//   1. GET auth/authorize met username/password -> authorization code uit de
//      redirect-locatie lezen.
//   2. POST auth/token met die code -> access_token.
//   3. GET rest-services/login met access_token -> {BhRestToken, restUrl}.
//
// Verschil met de Python-versie: `requests` volgt redirects automatisch en
// leest de code uit response.url. Hier wordt bewust redirect: 'manual'
// gebruikt en de Location-header gelezen i.p.v. de redirect te volgen — de
// redirect_uri hoeft dan niet een bestaande/bereikbare pagina te zijn.
// (Nog NIET end-to-end getest tegen live Bullhorn-credentials in deze
// sessie — zie de opdracht: Deno's fetch-gedrag rond redirects kan afwijken
// van Python's requests. Eerste live run hierop extra goed controleren.)

const AUTH_URL = 'https://auth.bullhornstaffing.com/oauth/authorize'
const TOKEN_URL = 'https://auth.bullhornstaffing.com/oauth/token'
const LOGIN_URL = 'https://rest.bullhornstaffing.com/rest-services/login'

// Iets ruimer dan de ~20 minuten sessieduur, zelfde marge als
// SESSION_LIFETIME_SECONDS (1140s) in sync_candidates.py.
const SESSIE_LEVENSDUUR_SECONDEN = 1140
// Ververs de cache al als er nog minder dan dit over is, i.p.v. te wachten
// tot een 401 halverwege een batch.
const REFRESH_MARGE_SECONDEN = 120
// Zelfde orde van grootte als de timeout=30 die sync_candidates.py op elke
// Bullhorn-aanroep zet — zonder dit kan één hangende aanroep de hele ~150s
// Edge Function-batch opsouperen.
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
    // Fallback: als Deno de redirect toch volgt (bv. bij een relatieve
    // Location of een afwijkende server-configuratie), staat de code in de
    // uiteindelijke response.url — zelfde als Python's requests-gedrag.
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

/**
 * Haalt een geldige Bullhorn-sessie op — uit de cache-tabel als die nog ruim
 * geldig is, anders een verse login (en de cache bijwerken). Zie
 * bullhorn_session_cache in supabase/schema.sql voor waarom dit gecachet
 * wordt (elke process-batch-aanroep is een losse Edge Function-invocatie
 * zonder gedeeld geheugen, en een Bullhorn-sessie leeft maar ~20 minuten).
 */
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

  const session = await bullhornLogin()
  const verloeptOp = new Date(Date.now() + SESSIE_LEVENSDUUR_SECONDEN * 1000).toISOString()

  await supabaseAdmin
    .from('bullhorn_session_cache')
    .upsert(
      { id: 1, bh_rest_token: session.BhRestToken, rest_url: session.restUrl, verloopt_op: verloeptOp, updated_at: new Date().toISOString() },
      { onConflict: 'id' },
    )

  return session
}

/**
 * Forceert een nieuwe login en werkt de cache bij — gebruikt als een
 * Bullhorn-call alsnog een 401 teruggeeft ondanks een "geldige" cache
 * (bv. de sessie is server-side ingetrokken).
 */
export async function forceerNieuweSessie(
  // deno-lint-ignore no-explicit-any
  supabaseAdmin: any,
): Promise<BullhornSession> {
  const session = await bullhornLogin()
  const verloeptOp = new Date(Date.now() + SESSIE_LEVENSDUUR_SECONDEN * 1000).toISOString()
  await supabaseAdmin
    .from('bullhorn_session_cache')
    .upsert(
      { id: 1, bh_rest_token: session.BhRestToken, rest_url: session.restUrl, verloopt_op: verloeptOp, updated_at: new Date().toISOString() },
      { onConflict: 'id' },
    )
  return session
}

/** Voert een Bullhorn GET uit; bij 401 wordt één keer opnieuw ingelogd en herhaald. */
async function bullhornGet(
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

export interface TearsheetSearchResult {
  id: number
  name: string
  dateAdded: number
  owner?: { id: number; firstName: string; lastName: string }
}

/**
 * Zoekt tearsheets — bewust /query, niet /search (Lucene-index kan
 * achterlopen; juist "recentste eerst" is het scenario waar dat misgaat,
 * zie de opdracht).
 */
export async function searchTearsheets(
  // deno-lint-ignore no-explicit-any
  supabaseAdmin: any,
  session: BullhornSession,
  zoekterm: string,
): Promise<{ results: TearsheetSearchResult[]; session: BullhornSession }> {
  // Bullhorn's /query where-parser accepts geen tautologie als "(1=1)" (geeft
  // "Bad Query: ... no viable alternative at input '='") — isDeleted=false is
  // een echt veld en dus een geldige altijd-waar-voorwaarde voor "geen
  // zoekterm", zelfde patroon als _paginate_query() in sync_candidates.py.
  const where = zoekterm
    ? `isDeleted=false AND name LIKE '%${zoekterm.replace(/'/g, "''")}%'`
    : 'isDeleted=false'
  const { data, session: newSession } = await bullhornGet(supabaseAdmin, session, 'query/Tearsheet', {
    fields: 'id,name,dateAdded,owner(id,firstName,lastName)',
    where,
    // /query gebruikt orderBy, niet sort (dat laatste is een /search-only
    // param) — zie _paginate_query() in sync_candidates.py.
    orderBy: '-dateAdded',
    count: '20',
  })
  // deno-lint-ignore no-explicit-any
  const results = ((data as any)?.data ?? []) as TearsheetSearchResult[]
  return { results, session: newSession }
}

/** Haalt de kandidaat-ID's van een tearsheet op. */
export async function getTearsheetCandidateIds(
  // deno-lint-ignore no-explicit-any
  supabaseAdmin: any,
  session: BullhornSession,
  tearsheetId: number,
): Promise<{ candidateIds: number[]; tearsheetNaam: string; session: BullhornSession }> {
  const { data, session: newSession } = await bullhornGet(supabaseAdmin, session, `entity/Tearsheet/${tearsheetId}`, {
    fields: 'id,name,candidates(id)',
  })
  // deno-lint-ignore no-explicit-any
  const entity = (data as any)?.data
  const candidateIds: number[] = (entity?.candidates?.data ?? []).map((c: { id: number }) => c.id)
  return { candidateIds, tearsheetNaam: entity?.name ?? `Tearsheet ${tearsheetId}`, session: newSession }
}

export interface CandidateProfiel {
  id: number
  firstName: string
  lastName: string
  description: string | null
}

/**
 * Haalt het kandidaatprofiel op — voor v1 bewust alleen id/naam/description.
 * De overige ranking-velden uit de Python-versie (status, jaren ervaring,
 * opleidingsniveau, specialisme, skills) zijn NIET meegenomen: hun echte
 * Bullhorn-veldnamen zijn niet geverifieerd via meta/Candidate binnen deze
 * sessie (geen live Bullhorn-toegang beschikbaar) — zie de opdracht: bij
 * twijfel weglaten i.p.v. gokken op basis van UI-labels. `description`
 * (CV + intake samen, zie sync_candidates.py) is toch het belangrijkste veld.
 */
export async function getCandidateProfiel(
  // deno-lint-ignore no-explicit-any
  supabaseAdmin: any,
  session: BullhornSession,
  candidateId: number,
): Promise<{ profiel: CandidateProfiel; session: BullhornSession }> {
  const { data, session: newSession } = await bullhornGet(supabaseAdmin, session, `entity/Candidate/${candidateId}`, {
    fields: 'id,firstName,lastName,description',
  })
  // deno-lint-ignore no-explicit-any
  const entity = (data as any)?.data
  return {
    profiel: {
      id: entity.id,
      firstName: entity.firstName ?? '',
      lastName: entity.lastName ?? '',
      description: entity.description ?? null,
    },
    session: newSession,
  }
}
