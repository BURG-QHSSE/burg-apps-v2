import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Edge Function: call-insights
//
// Detecteert automatisch Bullhorn-veldwijzigingen (salaris range, uurtarief
// range, woonplaats, voorkeur dienstverband, status) uit 3CX-gesprekssamen-
// vattingen, en laat de consultant per veld accepteren/afwijzen/corrigeren
// vóór er iets naar Bullhorn geschreven wordt.
//
// Twee acties (body.action):
//   - "syncNewCalls": verwerkt nieuwe recordings (matcht op telefoonnummer,
//     laat Claude wijzigingen detecteren, schrijft suggesties weg). Wordt
//     door pg_cron aangeroepen (zie schema.sql), niet door de browser —
//     geauthenticeerd met een gedeeld secret (x-cron-secret-header), geen
//     user-JWT.
//   - "resolveSuggestion": de consultant accepteert/wijst een suggestie af.
//     Bij accepteren wordt direct naar Bullhorn geschreven. Normale user-JWT
//     + rol-check, zelfde patroon als kandidaat-matcher/index.ts.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getBullhornSession, bullhornPost, normaliseerTelefoonnummer, getCandidateInsightsVelden } from './bullhorn.ts'
import { detecteerVeldwijzigingen } from './claude.ts'
import { refreshPhoneIndex, zoekKandidaatViaIndex } from './phoneIndex.ts'
import { bullhornGet, type BullhornSession } from './bullhorn.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const CRON_SECRET = Deno.env.get('CALL_INSIGHTS_CRON_SECRET')

// Aantal recordings per sync-aanroep — begrensd zodat een cron-tick binnen
// de ~150s Edge Function-limiet blijft (elke recording kost een paar
// sequentiële Bullhorn- + Claude-aanroepen).
const SYNC_BATCH_SIZE = 20

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

const VELD_NAAR_CURRENT_VALUE: Record<string, (v: Awaited<ReturnType<typeof getCandidateInsightsVelden>>['velden']) => string | null> = {
  customText22: (v) => v.customText22,
  customText11: (v) => v.customText11,
  address: (v) => v.address?.city ?? null,
  employmentPreference: (v) => v.employmentPreference,
  status: (v) => v.status,
}

/**
 * Verwerkt nieuwe recordings: matcht op telefoonnummer, haalt huidige
 * Bullhorn-velden op, laat Claude wijzigingen detecteren, en schrijft het
 * resultaat weg. Elke recording wordt sequentieel verwerkt (niet parallel) —
 * bewust simpel gehouden: volume is laag (tientallen calls/dag, niet
 * duizenden) en sequentieel voorkomt Bullhorn-sessie-race-condities zonder
 * een concurrency-limiter nodig te hebben.
 */
/**
 * Draait de Claude-extractie voor één (gesprek, kandidaat)-paar en schrijft
 * eventuele suggesties weg. Losgetrokken van syncNewCalls zodat
 * resolveCandidateMatch (de consultant kiest handmatig de juiste kandidaat
 * bij een ambigue telefoonmatch) dezelfde logica kan hergebruiken.
 */
async function verwerkGesprekVoorKandidaat(
  // deno-lint-ignore no-explicit-any
  admin: any,
  session: BullhornSession,
  recordingUrl: string,
  userId: string,
  callStartedAt: string,
  summary: string,
  candidateId: number,
): Promise<{ suggestiesAantal: number; session: BullhornSession }> {
  const { velden, session: newSession } = await getCandidateInsightsVelden(admin, session, candidateId)

  const suggesties = await detecteerVeldwijzigingen(summary, {
    customText22: velden.customText22,
    customText11: velden.customText11,
    city: velden.address?.city ?? null,
    employmentPreference: velden.employmentPreference,
    status: velden.status,
  })

  if (suggesties.length > 0) {
    const rijen = suggesties.map((s) => ({
      recording_url: recordingUrl,
      user_id: userId,
      bullhorn_candidate_id: candidateId,
      call_started_at: callStartedAt,
      field_name: s.field,
      current_value: VELD_NAAR_CURRENT_VALUE[s.field]?.(velden) ?? null,
      suggested_value: s.suggested_value,
      quote: s.quote,
      call_summary: summary,
    }))
    const { error: insertError } = await admin.from('call_field_suggestions').insert(rijen)
    if (insertError) throw new Error(insertError.message)
  }

  return { suggestiesAantal: suggesties.length, session: newSession }
}

async function syncNewCalls(
  // deno-lint-ignore no-explicit-any
  admin: any,
): Promise<{ verwerkt: number; matches: number; ambigu: number; suggesties: number }> {
  const { data: nieuw, error } = await admin.rpc('call_insights_nieuwe_recordings', { p_limiet: SYNC_BATCH_SIZE })
  if (error) throw new Error(`call_insights_nieuwe_recordings mislukt: ${error.message}`)

  let session = await getBullhornSession(admin)
  let matches = 0
  let ambigu = 0
  let suggestiesTotaal = 0

  for (const recording of nieuw ?? []) {
    const laatste9 = normaliseerTelefoonnummer(recording.extern_nummer ?? '')
    if (!laatste9) {
      await admin.from('call_insights_processed').insert({
        recording_url: recording.recording_url,
        user_id: recording.user_id,
        call_started_at: recording.start_time,
        skipped_reason: 'ongeldig_nummer',
      })
      continue
    }

    let match: { candidateId: number | null; ambigueKandidaatIds: number[] | null } = { candidateId: null, ambigueKandidaatIds: null }
    try {
      match = await zoekKandidaatViaIndex(admin, laatste9)
    } catch (err) {
      console.error(`[call-insights] Telefoon-lookup mislukt voor ${recording.recording_url}:`, err)
    }

    if (match.ambigueKandidaatIds) {
      // Meerdere kandidaten delen dit nummer — i.p.v. gokken of overslaan
      // laat de UI de consultant zelf kiezen (resolveCandidateMatch).
      ambigu++
      await admin.from('call_insights_processed').insert({
        recording_url: recording.recording_url,
        user_id: recording.user_id,
        call_started_at: recording.start_time,
        skipped_reason: 'meerdere_kandidaten',
        kandidaat_kandidaten: match.ambigueKandidaatIds,
      })
      continue
    }

    if (!match.candidateId) {
      await admin.from('call_insights_processed').insert({
        recording_url: recording.recording_url,
        user_id: recording.user_id,
        call_started_at: recording.start_time,
        skipped_reason: 'geen_match',
      })
      continue
    }
    matches++
    const candidateId = match.candidateId

    // BELANGRIJK: eerst de call_insights_processed-rij aanmaken, dan pas
    // verwerkGesprekVoorKandidaat (die bij suggesties naar
    // call_field_suggestions schrijft, met een foreign key naar déze rij op
    // recording_url) — andersom (zoals een eerdere versie deed) faalde de
    // insert met "violates foreign key constraint" zodra er daadwerkelijk
    // een suggestie was, want dan bestond de rij waar het naar verwijst nog
    // niet. Bij een fout hierna: UPDATE i.p.v. nogmaals INSERT (de rij
    // bestaat al, een 2e insert zou de primary key schenden).
    await admin.from('call_insights_processed').insert({
      recording_url: recording.recording_url,
      user_id: recording.user_id,
      call_started_at: recording.start_time,
      bullhorn_candidate_id: candidateId,
    })

    try {
      const resultaat = await verwerkGesprekVoorKandidaat(
        admin,
        session,
        recording.recording_url,
        recording.user_id,
        recording.start_time,
        recording.summary,
        candidateId,
      )
      session = resultaat.session
      suggestiesTotaal += resultaat.suggestiesAantal
    } catch (err) {
      console.error(`[call-insights] Verwerken van ${recording.recording_url} mislukt:`, err)
      await admin
        .from('call_insights_processed')
        .update({ skipped_reason: 'verwerkingsfout' })
        .eq('recording_url', recording.recording_url)
    }
  }

  return { verwerkt: (nieuw ?? []).length, matches, ambigu, suggesties: suggestiesTotaal }
}

/**
 * Verwerkt het besluit van een consultant over één suggestie. Bij
 * accepteren: schrijft direct naar Bullhorn. Voor "address" wordt het
 * huidige, volledige address-object opgehaald en alleen `city` gemerged
 * (composite-veld — nooit blind overschrijven, anders lopen we het risico
 * andere adresvelden zoals straatnaam/postcode leeg te schrijven).
 */
async function resolveSuggestion(
  // deno-lint-ignore no-explicit-any
  admin: any,
  callerId: string,
  isAdmin: boolean,
  suggestionId: string,
  besluit: 'accepteren' | 'afwijzen',
  finalValueOverride: string | null,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const { data: suggestie, error } = await admin
    .from('call_field_suggestions')
    .select('*')
    .eq('id', suggestionId)
    .single()

  if (error || !suggestie) {
    return { ok: false, error: 'Suggestie niet gevonden', status: 404 }
  }
  // MVP: Call Insights is admin-only (zie toolRegistry.js) - een admin
  // handelt suggesties af namens de gekozen actieve consultant, vandaar de
  // isAdmin-uitzondering op de eigenaarschap-check.
  if (suggestie.user_id !== callerId && !isAdmin) {
    return { ok: false, error: 'Deze suggestie hoort niet bij jouw gesprekken', status: 403 }
  }
  if (suggestie.status !== 'pending') {
    return { ok: false, error: 'Deze suggestie is al afgehandeld', status: 409 }
  }

  if (besluit === 'afwijzen') {
    await admin
      .from('call_field_suggestions')
      .update({ status: 'afgewezen', resolved_at: new Date().toISOString() })
      .eq('id', suggestionId)
    return { ok: true }
  }

  const finalValue = finalValueOverride ?? suggestie.suggested_value

  try {
    const session = await getBullhornSession(admin)

    if (suggestie.field_name === 'address') {
      const { velden } = await getCandidateInsightsVelden(admin, session, suggestie.bullhorn_candidate_id)
      // Straat/postcode/provincie horen bij de OUDE woonplaats en zijn na
      // een verhuizing niet meer geldig — die blijven laten staan zou een
      // adres opleveren dat compleet oogt maar feitelijk fout is (erger dan
      // een leeg veld). We weten alleen de nieuwe plaatsnaam, dus de rest
      // wordt leeggemaakt i.p.v. verzonnen; land blijft staan (verhuizing
      // naar het buitenland is niet iets wat dit veld detecteert).
      const gemergedAdres = {
        ...(velden.address ?? {}),
        city: finalValue,
        address1: null,
        address2: null,
        zip: null,
        state: null,
      }
      await bullhornPost(admin, session, `entity/Candidate/${suggestie.bullhorn_candidate_id}`, { address: gemergedAdres })
    } else if (suggestie.field_name === 'employmentPreference') {
      // Multi-select in Bullhorn (zie bullhorn.ts) - onze waarde is een
      // komma-gescheiden string ("Loondienst, Interim" of "Interim"), terug
      // te vertalen naar de array die Bullhorn verwacht.
      const waarden = finalValue.split(',').map((v: string) => v.trim()).filter(Boolean)
      await bullhornPost(admin, session, `entity/Candidate/${suggestie.bullhorn_candidate_id}`, { employmentPreference: waarden })
    } else {
      await bullhornPost(admin, session, `entity/Candidate/${suggestie.bullhorn_candidate_id}`, {
        [suggestie.field_name]: finalValue,
      })
    }
  } catch (err) {
    console.error(`[call-insights] Bullhorn-write mislukt voor suggestie ${suggestionId}:`, err)
    return { ok: false, error: 'Schrijven naar Bullhorn is mislukt, probeer het later opnieuw', status: 502 }
  }

  await admin
    .from('call_field_suggestions')
    .update({ status: 'geaccepteerd', final_value: finalValue, resolved_at: new Date().toISOString() })
    .eq('id', suggestionId)

  return { ok: true }
}

/**
 * Verwerkt de handmatige kandidaat-keuze van een consultant bij een ambigue
 * telefoonmatch (meerdere kandidaten deelden hetzelfde nummer, zie
 * syncNewCalls). Draait de Claude-extractie alsnog voor de gekozen
 * kandidaat en markeert de recording als afgehandeld.
 */
async function resolveCandidateMatch(
  // deno-lint-ignore no-explicit-any
  admin: any,
  callerId: string,
  isAdmin: boolean,
  recordingUrl: string,
  gekozenCandidateId: number,
): Promise<{ ok: true; suggestiesAantal: number } | { ok: false; error: string; status: number }> {
  const { data: rij, error } = await admin
    .from('call_insights_processed')
    .select('*')
    .eq('recording_url', recordingUrl)
    .single()

  if (error || !rij) {
    return { ok: false, error: 'Gesprek niet gevonden', status: 404 }
  }
  // MVP: zelfde isAdmin-uitzondering als resolveSuggestion hierboven.
  if (rij.user_id !== callerId && !isAdmin) {
    return { ok: false, error: 'Dit gesprek hoort niet bij jou', status: 403 }
  }
  if (rij.skipped_reason !== 'meerdere_kandidaten' || !rij.kandidaat_kandidaten) {
    return { ok: false, error: 'Dit gesprek staat niet open voor een kandidaat-keuze', status: 409 }
  }
  if (!rij.kandidaat_kandidaten.includes(gekozenCandidateId)) {
    return { ok: false, error: 'Deze kandidaat hoorde niet bij de gevonden opties voor dit gesprek', status: 400 }
  }

  const { data: recording, error: recordingError } = await admin
    .from('recordings')
    .select('summary')
    .eq('recording_url', recordingUrl)
    .single()
  if (recordingError || !recording?.summary) {
    return { ok: false, error: 'Gesprekssamenvatting niet gevonden', status: 404 }
  }

  try {
    const session = await getBullhornSession(admin)
    const { suggestiesAantal } = await verwerkGesprekVoorKandidaat(
      admin,
      session,
      recordingUrl,
      rij.user_id,
      rij.call_started_at,
      recording.summary,
      gekozenCandidateId,
    )
    await admin
      .from('call_insights_processed')
      .update({ bullhorn_candidate_id: gekozenCandidateId, skipped_reason: null, kandidaat_kandidaten: null })
      .eq('recording_url', recordingUrl)
    return { ok: true, suggestiesAantal }
  } catch (err) {
    console.error(`[call-insights] Verwerken na kandidaat-keuze mislukt voor ${recordingUrl}:`, err)
    return { ok: false, error: 'Verwerken is mislukt, probeer het later opnieuw', status: 502 }
  }
}

/**
 * Verifieert de Authorization-header van de aanroeper en checkt dat er een
 * geldig profiel-record bestaat — zelfde patroon als kandidaat-matcher/
 * index.ts. Retourneert de user-id bij succes, of een kant-en-klare
 * foutresponse bij falen.
 */
async function verifieerGebruiker(req: Request): Promise<{ userId: string; role: string } | { errorResponse: Response }> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return { errorResponse: jsonResponse({ error: 'Ontbrekende Authorization header' }, 401) }
  }
  const callerClient = createClient(SUPABASE_URL!, ANON_KEY!, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: userData, error: userError } = await callerClient.auth.getUser()
  if (userError || !userData?.user) {
    return { errorResponse: jsonResponse({ error: 'Ongeldige sessie' }, 401) }
  }
  const { data: callerProfile, error: profileError } = await callerClient
    .from('profiles')
    .select('role')
    .eq('id', userData.user.id)
    .single()
  if (profileError || !['admin', 'manager', 'hr', 'user'].includes(callerProfile?.role)) {
    return { errorResponse: jsonResponse({ error: 'Onvoldoende rechten om deze actie uit te voeren' }, 403) }
  }
  return { userId: userData.user.id, role: callerProfile.role }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!)

    if (body.action === 'syncNewCalls') {
      if (!CRON_SECRET || req.headers.get('x-cron-secret') !== CRON_SECRET) {
        return jsonResponse({ error: 'Ongeldig of ontbrekend cron-secret' }, 401)
      }
      const resultaat = await syncNewCalls(admin)
      return jsonResponse(resultaat)
    }

    if (body.action === 'refreshPhoneIndex') {
      if (!CRON_SECRET || req.headers.get('x-cron-secret') !== CRON_SECRET) {
        return jsonResponse({ error: 'Ongeldig of ontbrekend cron-secret' }, 401)
      }
      const session = await getBullhornSession(admin)
      const resultaat = await refreshPhoneIndex(admin, session)
      return jsonResponse(resultaat)
    }

    if (body.action === 'resolveSuggestion') {
      const auth = await verifieerGebruiker(req)
      if ('errorResponse' in auth) return auth.errorResponse

      const suggestionId = String(body.suggestionId ?? '')
      const besluit = body.besluit === 'afwijzen' ? 'afwijzen' : body.besluit === 'accepteren' ? 'accepteren' : null
      if (!suggestionId || !besluit) {
        return jsonResponse({ error: 'suggestionId en besluit (accepteren|afwijzen) zijn verplicht' }, 400)
      }
      const finalValueOverride = typeof body.finalValue === 'string' && body.finalValue.trim() ? body.finalValue.trim() : null

      const resultaat = await resolveSuggestion(admin, auth.userId, auth.role === 'admin', suggestionId, besluit, finalValueOverride)
      if (!resultaat.ok) {
        return jsonResponse({ error: resultaat.error }, resultaat.status)
      }
      return jsonResponse({ ok: true })
    }

    if (body.action === 'resolveCandidateMatch') {
      const auth = await verifieerGebruiker(req)
      if ('errorResponse' in auth) return auth.errorResponse

      const recordingUrl = String(body.recordingUrl ?? '')
      const candidateId = Number(body.candidateId)
      if (!recordingUrl || !Number.isFinite(candidateId)) {
        return jsonResponse({ error: 'recordingUrl en candidateId zijn verplicht' }, 400)
      }

      const resultaat = await resolveCandidateMatch(admin, auth.userId, auth.role === 'admin', recordingUrl, candidateId)
      if (!resultaat.ok) {
        return jsonResponse({ error: resultaat.error }, resultaat.status)
      }
      return jsonResponse({ ok: true, suggestiesAantal: resultaat.suggestiesAantal })
    }

    if (body.action === 'kandidaatNamen') {
      const auth = await verifieerGebruiker(req)
      if ('errorResponse' in auth) return auth.errorResponse

      const ids = Array.isArray(body.candidateIds) ? body.candidateIds.map(Number).filter((n: number) => Number.isFinite(n)) : []
      const namen: Record<number, string> = {}
      const session = await getBullhornSession(admin)
      // Sequentieel (niet parallel) — dit is een lichte, eenmalige fetch per
      // scherm-weergave (client-side gecachet, zie callInsightsApi.js), geen
      // reden om Bullhorn-sessie-races te riskeren voor een paar namen.
      for (const id of ids) {
        try {
          const { data } = await bullhornGet(admin, session, `entity/Candidate/${id}`, { fields: 'id,firstName,lastName' })
          const entity = (data as { data?: { firstName?: string; lastName?: string } })?.data
          namen[id] = `${entity?.firstName ?? ''} ${entity?.lastName ?? ''}`.trim() || `Kandidaat ${id}`
        } catch {
          namen[id] = `Kandidaat ${id}`
        }
      }
      return jsonResponse({ namen })
    }

    return jsonResponse({ error: `Onbekende actie: ${body.action}` }, 400)
  } catch (err) {
    console.error('[call-insights] Onverwachte fout:', err)
    return jsonResponse({ error: 'Er ging iets mis' }, 500)
  }
})
