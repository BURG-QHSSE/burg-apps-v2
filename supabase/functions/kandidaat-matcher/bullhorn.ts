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

/**
 * Haalt de titel + bedrijfsnaam van een vacature (JobOrder) op, puur voor
 * weergave in de UI (zelfde rol als tearsheetNaam voorheen) — gecombineerd
 * tot één weergavestring, bv. "QHSE Officer — Securitas". Geen harde
 * afhankelijkheid — als de vacature niet gevonden wordt, valt de caller
 * terug op het kale ID.
 */
export async function getVacatureNaam(
  // deno-lint-ignore no-explicit-any
  supabaseAdmin: any,
  session: BullhornSession,
  vacatureId: number,
): Promise<{ naam: string | null; session: BullhornSession }> {
  try {
    const { data, session: newSession } = await bullhornGet(supabaseAdmin, session, `entity/JobOrder/${vacatureId}`, {
      fields: 'id,title,clientCorporation(name)',
    })
    // deno-lint-ignore no-explicit-any
    const entity = (data as any)?.data
    const titel = entity?.title ?? null
    const bedrijf = entity?.clientCorporation?.name ?? null
    if (!titel) return { naam: null, session: newSession }
    return { naam: bedrijf ? `${titel} — ${bedrijf}` : titel, session: newSession }
  } catch {
    return { naam: null, session }
  }
}

/**
 * Workaround voor de Tearsheet-vertraging (nieuwe tearsheets zijn tot ~1
 * week onzichtbaar voor dit service-account, zie de Bullhorn-support-
 * correspondentie): de consultant zet i.p.v. een tearsheet een bulk-Notitie
 * (actie "Matching") op de geselecteerde kandidaten, met het kale vacature-ID
 * als tekst. Note is — anders dan Tearsheet — wél realtime zichtbaar via de
 * REST API.
 *
 * Haalt breed de recentste Notes op (net als get_intake_for_candidate in
 * sync_candidates.py wordt bewust NIET server-side op action gefilterd —
 * dat filter bleek op dit Bullhorn-instance onbetrouwbaar/leeg ondanks
 * aanwezige data), en filtert client-side op action="Matching" + een
 * comments-veld waarin het opgegeven vacature-ID als vrijstaand getal
 * voorkomt (na het strippen van Bullhorn's eigen HTML-opmaak in dat veld) -
 * geen exacte match, want Bullhorn plakt zelf opmaak (bv. een trailing <br>)
 * in de opgeslagen tekst, dus daar wél op matchen is te fragiel.
 *
 * Een pagina-limiet van 5x200=1000 is een veiligheidsgrens: deze notities
 * worden direct na gebruik verwijderd (zie verwijderMatchingNotities), dus
 * de levende populatie hoort altijd klein te zijn — deze grens vangt alleen
 * een eerder mislukte cleanup op, niet de normale situatie.
 */
export async function getMatchingKandidatenViaNotitie(
  // deno-lint-ignore no-explicit-any
  supabaseAdmin: any,
  session: BullhornSession,
  vacatureId: number,
): Promise<{ candidateIds: number[]; noteIds: number[]; session: BullhornSession }> {
  const vacatureIdStr = String(vacatureId)
  const candidateIds = new Set<number>()
  const noteIds: number[] = []
  let huidigeSessie = session
  let start = 0
  const paginaGrootte = 200
  const maxPaginas = 5

  for (let pagina = 0; pagina < maxPaginas; pagina++) {
    const { data, session: newSession } = await bullhornGet(supabaseAdmin, huidigeSessie, 'search/Note', {
      query: 'isDeleted:false',
      fields: 'id,action,comments,candidates(id)',
      sort: '-dateAdded',
      start: String(start),
      count: String(paginaGrootte),
    })
    huidigeSessie = newSession
    // deno-lint-ignore no-explicit-any
    const rows = ((data as any)?.data ?? []) as any[]
    if (rows.length === 0) break

    for (const note of rows) {
      const actie = String(note.action ?? '').trim().toLowerCase()
      if (actie !== 'matching') continue
      // Bullhorn plakt zelf HTML-opmaak in de opgeslagen comments-tekst (bv.
      // een trailing <br> - zelfde mangling als bij de intake-datummatch),
      // dus een exacte string-match is te fragiel en faalde hierdoor eerder
      // op een volledig correct aangemaakte notitie. In plaats daarvan: alle
      // tags/entities eruit strippen en het vacature-ID als vrijstaand getal
      // zoeken (woordgrenzen voorkomen dat "165" toevallig matcht binnen
      // "22165" of omgekeerd).
      const platteComments = String(note.comments ?? '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
      const idGevonden = new RegExp(`\\b${vacatureIdStr}\\b`).test(platteComments)
      if (!idGevonden) continue
      noteIds.push(note.id)
      const kandidatenVeld = note.candidates
      const kandidatenLijst = Array.isArray(kandidatenVeld) ? kandidatenVeld : (kandidatenVeld?.data ?? [])
      for (const kandidaat of kandidatenLijst) {
        const cid = typeof kandidaat === 'object' ? kandidaat?.id : kandidaat
        if (cid != null) candidateIds.add(cid)
      }
    }

    start += rows.length
    if (rows.length < paginaGrootte) break
  }

  return { candidateIds: Array.from(candidateIds), noteIds, session: huidigeSessie }
}

/**
 * Simpele concurrency-limiter, zelfde patroon als mapMetLimiet in index.ts
 * (hier los gehouden i.p.v. gedeeld, want index.ts importeert al vanuit dit
 * bestand - een gedeelde import zou een circulaire afhankelijkheid geven).
 */
async function voorElkMetLimiet<T>(items: T[], limiet: number, fn: (item: T) => Promise<void>): Promise<void> {
  let volgende = 0
  async function werker() {
    while (volgende < items.length) {
      const i = volgende++
      await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limiet, items.length) }, werker))
}

// Hoeveel delete-aanroepen tegelijk lopen. Sequentieel bleek bij een grote
// run (482 notities) ~325s te duren - ruim boven de ~150s-limiet van een
// Edge Function-aanroep (zie project-geheugen, 2026-08-27: een echte run
// bleef daardoor stilletjes met alle notities onverwijderd achter, zonder
// foutmelding, want de aanroep werd door het platform afgebroken vóórdat de
// loop ooit een fout kón loggen).
const VERWIJDER_CONCURRENCY = 10

/**
 * Verwijdert (soft-delete, net als in Bullhorn zelf) precies de Matching-
 * notities die voor deze run zijn gebruikt — nooit een bredere sweep. Wordt
 * pas aangeroepen NADAT de matching_resultaten-rijen succesvol zijn
 * aangemaakt, zodat een mislukte run de marker niet kwijtraakt vóór een
 * eventuele retry. Eén mislukte losse delete is niet fataal voor de run
 * zelf (de notitie is dan gewoon een onschuldig, leeg achtergebleven
 * restant — bevat geen PII, alleen het kale vacature-ID). Parallel i.p.v.
 * sequentieel, en in index.ts bewust via EdgeRuntime.waitUntil() aangeroepen
 * zodat dit nooit meer de response naar de browser kan blokkeren.
 */
export async function verwijderMatchingNotities(
  // deno-lint-ignore no-explicit-any
  supabaseAdmin: any,
  session: BullhornSession,
  noteIds: number[],
): Promise<void> {
  await voorElkMetLimiet(noteIds, VERWIJDER_CONCURRENCY, async (noteId) => {
    try {
      const url = `${session.restUrl}entity/Note/${noteId}?${new URLSearchParams({
        BhRestToken: session.BhRestToken,
      })}`
      let response = await fetchMetTimeout(url, { method: 'DELETE' }, BULLHORN_TIMEOUT_MS)
      if (response.status === 401) {
        const nieuweSessie = await forceerNieuweSessie(supabaseAdmin)
        const retryUrl = `${nieuweSessie.restUrl}entity/Note/${noteId}?${new URLSearchParams({
          BhRestToken: nieuweSessie.BhRestToken,
        })}`
        response = await fetchMetTimeout(retryUrl, { method: 'DELETE' }, BULLHORN_TIMEOUT_MS)
      }
      if (!response.ok) {
        console.error(`[kandidaat-matcher] Verwijderen van Matching-notitie ${noteId} mislukt: ${response.status}`)
      }
    } catch (err) {
      console.error(`[kandidaat-matcher] Verwijderen van Matching-notitie ${noteId} gaf een fout:`, err)
    }
  })
}

/**
 * Haalt puur de naam van een kandidaat op — losstaand van getCandidateProfiel,
 * en bewust NOOIT ergens opgeslagen (zie matching_resultaten-schema-comment:
 * geen PII in de database, de consultant klikt door naar Bullhorn voor de
 * naam). Wordt alleen live aangeroepen vanuit de UI wanneer een klaar-run
 * getoond wordt (zie index.ts actie "kandidaat-namen") — dus elke keer
 * opnieuw opgehaald, nooit gecachet buiten de levensduur van die ene
 * paginaweergave.
 */
export async function getCandidateNaam(
  // deno-lint-ignore no-explicit-any
  supabaseAdmin: any,
  session: BullhornSession,
  candidateId: number,
): Promise<{ naam: string; session: BullhornSession }> {
  const { data, session: newSession } = await bullhornGet(supabaseAdmin, session, `entity/Candidate/${candidateId}`, {
    fields: 'id,firstName,lastName',
  })
  // deno-lint-ignore no-explicit-any
  const entity = (data as any)?.data
  const naam = `${entity?.firstName ?? ''} ${entity?.lastName ?? ''}`.trim()
  return { naam: naam || `Kandidaat ${candidateId}`, session: newSession }
}

// Zelfde structuur als update_candidate_description() in sync_candidates.py
// schrijft: "=== INTAKE DATA (epoch-ms) ===<br>{intake}<br><br>=== CV DATA
// ===<br>{cv}" - de datum in de header is de dateAdded van de Note die de
// intake-tekst opleverde, vastgelegd bij het schrijven zelf (zie dat script)
// i.p.v. hier achteraf te reconstrueren via een live Bullhorn-query. Dat is
// simpeler en robuuster: geen extra API-call per kandidaat nodig, en geen
// risico dat een live query een nieuwere notitie vindt dan wat er
// daadwerkelijk in description staat (de sync draait maar 1x/dag). De datum
// is optioneel - description-waarden van vóór deze wijziging hebben nog geen
// datum in de header, dan komt haalIntakeDatumUit() gewoon null terug.
const INTAKE_SECTIE_PATROON = /=== INTAKE DATA(?: \((\d+)\))? ===<br>/i

export function haalIntakeDatumUit(description: string): string | null {
  const match = INTAKE_SECTIE_PATROON.exec(description)
  const epochMs = match?.[1]
  return epochMs ? new Date(Number(epochMs)).toISOString() : null
}

export interface CandidateProfiel {
  id: number
  firstName: string
  lastName: string
  description: string | null
  // Puur voor de filterbalk (zie salarisfilter.ts) - gaan NOOIT naar Claude.
  status: string | null
  salarisRange: string | null
  uurtariefRange: string | null
}

/**
 * Haalt het kandidaatprofiel op. `description` (CV + intake samen, zie
 * sync_candidates.py) is het enige veld dat naar Claude gaat.
 * status/salarisRange/uurtariefRange (Bullhorn-velden `status`/
 * `customText22`/`customText11` — geverifieerd via meta/Candidate tegen
 * live Bullhorn-data, zie de Bullhorn-kandidaatschermafbeelding in de
 * opdracht: "Status"/"Salaris range"/"Uurtarief range") zijn uitsluitend
 * voor de filterbalk in de UI. De overige ranking-velden uit de Python-
 * versie (jaren ervaring, opleidingsniveau, specialisme, skills) blijven
 * bewust buiten scope van deze sessie.
 */
export async function getCandidateProfiel(
  // deno-lint-ignore no-explicit-any
  supabaseAdmin: any,
  session: BullhornSession,
  candidateId: number,
): Promise<{ profiel: CandidateProfiel; session: BullhornSession }> {
  const { data, session: newSession } = await bullhornGet(supabaseAdmin, session, `entity/Candidate/${candidateId}`, {
    fields: 'id,firstName,lastName,description,status,customText22,customText11',
  })
  // deno-lint-ignore no-explicit-any
  const entity = (data as any)?.data
  return {
    profiel: {
      id: entity.id,
      firstName: entity.firstName ?? '',
      lastName: entity.lastName ?? '',
      description: entity.description ?? null,
      status: entity.status ?? null,
      salarisRange: entity.customText22 ?? null,
      uurtariefRange: entity.customText11 ?? null,
    },
    session: newSession,
  }
}
