// Edge Function: kandidaat-matcher
//
// Consultant zet in Bullhorn zelf boolean-search-resultaten op een
// tearsheet; deze functie haalt die kandidaten op, anonimiseert per
// kandidaat het CV/intake-veld (zie anonimiseren.ts — persoonsgegevens gaan
// NOOIT naar Claude) en laat Claude scoren tegen de vacaturetekst.
//
// Drie acties (body.action):
//   - "search-tearsheets": tearsheets zoeken op naam (leeg = 20 meest
//     recente), voor de zoekbalk in de UI.
//   - "start-run": kandidaten van een tearsheet ophalen, matching_runs +
//     placeholder matching_resultaten-rijen (status 'wacht') aanmaken.
//   - "process-batch": een klein aantal 'wacht'-rijen van een run pakken,
//     scoren, wegschrijven. Wordt door de browser herhaald tot er niets
//     meer te doen is — nodig omdat een Edge Function-invocatie maar ~150s
//     mag duren (zie supabase/schema.sql voor de volledige uitleg).
//
// Zelfde beveiligingspatroon als admin-users/index.ts: eerst de JWT van de
// aanroeper verifiëren en checken dat profiles.role = 'admin' is (via een
// client die alleen de anon-key + die JWT gebruikt, dus onder normale RLS),
// pas dan verdergaan met de service-role-client. Deze tool is tijdelijk
// admin-only (zie toolRegistry.js) — nog openstaande AVG-/Bullhorn-rechten-
// vragen bij Sam voordat dit breder uitrolt.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getBullhornSession, searchTearsheets, getTearsheetCandidateIds, getCandidateProfiel } from './bullhorn.ts'
import { anonimiseerVrijeTekst, stripHtml, maakKandidaatLabel } from './anonimiseren.ts'
import { rankKandidaat, bereidVacaturetekstVoorCache, prewarmCache } from './claude.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

// Configureerbaar zodat dit makkelijk kleiner te zetten is als een batch
// tegen de 150s-tijdslimiet aanloopt (zie schema.sql-comment bij
// matching_runs) — bv. `supabase secrets set MATCHER_BATCH_SIZE=3`.
const BATCH_SIZE = Number(Deno.env.get('MATCHER_BATCH_SIZE')) || 6
// Hoeveel Claude-aanroepen binnen één batch tegelijk lopen (Bullhorn-calls
// blijven sequentieel, want die delen een mutable sessie-object dat bij een
// 401 vervangen wordt — zie bullhorn.ts).
const CLAUDE_CONCURRENCY = 3
// Zelfde grens als MAX_CV_LENGTE in server.py (kandidaat-ranker) — boven dit
// aantal tekens is het CV-veld vrijwel zeker corrupt (bijlage-/e-mailruis),
// geen scoorbare inhoud.
const MAX_CV_LENGTE = 25000

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

/** Simpele concurrency-limiter voor de Claude-aanroepen binnen een batch. */
async function mapMetLimiet<T, R>(items: T[], limiet: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const resultaten: R[] = new Array(items.length)
  let volgende = 0
  async function werker() {
    while (volgende < items.length) {
      const i = volgende++
      resultaten[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limiet, items.length) }, werker))
  return resultaten
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return jsonResponse({ error: 'Ontbrekende Authorization header' }, 401)
    }

    const callerClient = createClient(SUPABASE_URL!, ANON_KEY!, {
      global: { headers: { Authorization: authHeader } },
    })

    const { data: userData, error: userError } = await callerClient.auth.getUser()
    if (userError || !userData?.user) {
      return jsonResponse({ error: 'Ongeldige sessie' }, 401)
    }

    const { data: callerProfile, error: profileError } = await callerClient
      .from('profiles')
      .select('role, naam')
      .eq('id', userData.user.id)
      .single()

    if (profileError || callerProfile?.role !== 'admin') {
      return jsonResponse({ error: 'Alleen admins mogen deze actie uitvoeren' }, 403)
    }

    const admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!)
    const body = await req.json()

    if (body.action === 'search-tearsheets') {
      const session = await getBullhornSession(admin)
      const { results } = await searchTearsheets(admin, session, String(body.zoekterm ?? '').trim())
      return jsonResponse({
        results: results.map((r) => ({
          id: r.id,
          naam: r.name,
          dateAdded: r.dateAdded,
          ownerNaam: r.owner ? `${r.owner.firstName} ${r.owner.lastName}`.trim() : null,
        })),
      })
    }

    if (body.action === 'start-run') {
      const tearsheetId = Number(body.tearsheetId)
      const vacaturetekst = String(body.vacaturetekst ?? '').trim()
      if (!tearsheetId || !vacaturetekst) {
        return jsonResponse({ error: 'tearsheetId en vacaturetekst zijn verplicht' }, 400)
      }

      const session = await getBullhornSession(admin)
      const { candidateIds, tearsheetNaam } = await getTearsheetCandidateIds(admin, session, tearsheetId)

      const { data: run, error: runError } = await admin
        .from('matching_runs')
        .insert({
          created_by: userData.user.id,
          created_by_naam: callerProfile.naam ?? null,
          tearsheet_id: tearsheetId,
          tearsheet_naam: tearsheetNaam,
          vacaturetekst,
          aantal_kandidaten: candidateIds.length,
          status: candidateIds.length > 0 ? 'bezig' : 'fout',
          foutmelding: candidateIds.length > 0 ? null : 'Distributielijst bevat geen kandidaten',
        })
        .select('id')
        .single()

      if (runError) {
        return jsonResponse({ error: runError.message }, 400)
      }

      if (candidateIds.length > 0) {
        const rows = candidateIds.map((bullhorn_id) => ({ run_id: run.id, bullhorn_id, status: 'wacht' }))
        const { error: insertError } = await admin.from('matching_resultaten').insert(rows)
        if (insertError) {
          await admin.from('matching_runs').update({ status: 'fout', foutmelding: insertError.message }).eq('id', run.id)
          return jsonResponse({ error: insertError.message }, 400)
        }
      }

      return jsonResponse({ runId: run.id, tearsheetNaam, aantalKandidaten: candidateIds.length })
    }

    if (body.action === 'process-batch') {
      const runId = String(body.runId ?? '')
      if (!runId) {
        return jsonResponse({ error: 'runId is verplicht' }, 400)
      }

      const { data: run, error: runError } = await admin
        .from('matching_runs')
        .select('id, vacaturetekst, status')
        .eq('id', runId)
        .single()
      if (runError || !run) {
        return jsonResponse({ error: 'Run niet gevonden' }, 404)
      }

      const { data: batch, error: batchError } = await admin.rpc('matching_pak_batch', {
        p_run_id: runId,
        p_aantal: BATCH_SIZE,
      })
      if (batchError) {
        return jsonResponse({ error: batchError.message }, 400)
      }

      const vacatureTekstVoorCache = bereidVacaturetekstVoorCache(run.vacaturetekst)
      // deno-lint-ignore no-explicit-any
      const batchRows = (batch ?? []) as any[]

      // Schrijf de cache-entry alvast weg terwijl stap 1 (Bullhorn) loopt —
      // zonder dit racen de eerste parallelle rankKandidaat()-aanroepen in
      // stap 2 om dezelfde cache-entry en missen ze 'm allemaal. Net als in
      // server.py is een mislukte pre-warm niet fataal: gewoon verdergaan
      // zonder cache-voordeel.
      const prewarmPromise = prewarmCache(vacatureTekstVoorCache).catch((err) => {
        console.error('[kandidaat-matcher] Prewarm mislukt, verdergaan zonder cache:', err)
      })

      // Stap 1: Bullhorn-profielen ophalen — sequentieel, want de sessie is
      // een mutable object dat bij een 401 vervangen wordt (zie bullhorn.ts).
      let session = await getBullhornSession(admin)
      const voorbereid: {
        rowId: string
        bullhornId: number
        label: string
        payload: Record<string, string> | null
        foutmelding: string | null
        klaarZonderScore: string | null
      }[] = []

      for (let i = 0; i < batchRows.length; i++) {
        const row = batchRows[i]
        const label = maakKandidaatLabel(row.bullhorn_id, i)
        try {
          const result = await getCandidateProfiel(admin, session, row.bullhorn_id)
          session = result.session
          const profiel = result.profiel
          const naamVolledig = `${profiel.firstName} ${profiel.lastName}`.trim()
          const cvRuw = profiel.description ? stripHtml(profiel.description).trim() : ''

          if (!cvRuw) {
            voorbereid.push({
              rowId: row.id,
              bullhornId: row.bullhorn_id,
              label,
              payload: null,
              foutmelding: null,
              klaarZonderScore: 'Geen CV-tekst beschikbaar in Bullhorn voor deze kandidaat.',
            })
            continue
          }

          // Zelfde grens als MAX_CV_LENGTE in server.py: boven dit aantal
          // tekens is het CV-veld vrijwel zeker corrupt (bv. bijlage- of
          // e-mailruis die in description terecht is gekomen via de sync) —
          // overslaan i.p.v. dat als "CV" naar Claude te sturen.
          if (cvRuw.length > MAX_CV_LENGTE) {
            voorbereid.push({
              rowId: row.id,
              bullhornId: row.bullhorn_id,
              label,
              payload: null,
              foutmelding: null,
              klaarZonderScore: `Overgeslagen — CV-veld te lang (${cvRuw.length} tekens, limiet is ${MAX_CV_LENGTE}).`,
            })
            continue
          }

          const geanonimiseerd = anonimiseerVrijeTekst(cvRuw, label, naamVolledig)
          voorbereid.push({
            rowId: row.id,
            bullhornId: row.bullhorn_id,
            label,
            payload: { CV: geanonimiseerd },
            foutmelding: null,
            klaarZonderScore: null,
          })
        } catch (err) {
          voorbereid.push({
            rowId: row.id,
            bullhornId: row.bullhorn_id,
            label,
            payload: null,
            foutmelding: err instanceof Error ? err.message : String(err),
            klaarZonderScore: null,
          })
        }
      }

      // Stap 2: Claude-scoring — parallel binnen de batch, met caching op
      // systeemprompt + vacaturetekst (zie claude.ts). Wacht eerst de
      // pre-warm af zodat deze parallelle aanroepen een cache-treffer
      // krijgen i.p.v. te racen om de cache-entry.
      await prewarmPromise
      await mapMetLimiet(voorbereid, CLAUDE_CONCURRENCY, async (item) => {
        if (item.foutmelding) {
          await admin
            .from('matching_resultaten')
            .update({ status: 'fout', foutmelding: item.foutmelding, updated_at: new Date().toISOString() })
            .eq('id', item.rowId)
          return
        }
        if (item.klaarZonderScore) {
          await admin
            .from('matching_resultaten')
            .update({
              status: 'klaar',
              score: 0,
              onderbouwing: item.klaarZonderScore,
              updated_at: new Date().toISOString(),
            })
            .eq('id', item.rowId)
          return
        }
        if (!item.payload) {
          return
        }
        try {
          const { score, onderbouwing } = await rankKandidaat(vacatureTekstVoorCache, item.label, item.payload)
          await admin
            .from('matching_resultaten')
            .update({ status: 'klaar', score, onderbouwing, updated_at: new Date().toISOString() })
            .eq('id', item.rowId)
        } catch (err) {
          await admin
            .from('matching_resultaten')
            .update({
              status: 'fout',
              foutmelding: err instanceof Error ? err.message : String(err),
              updated_at: new Date().toISOString(),
            })
            .eq('id', item.rowId)
        }
      })

      const { count: resterend } = await admin
        .from('matching_resultaten')
        .select('id', { count: 'exact', head: true })
        .eq('run_id', runId)
        .in('status', ['wacht', 'bezig'])

      const klaar = (resterend ?? 0) === 0
      if (klaar && run.status === 'bezig') {
        await admin.from('matching_runs').update({ status: 'klaar' }).eq('id', runId)
      }

      return jsonResponse({ verwerkt: batchRows.length, resterend: resterend ?? 0, klaar })
    }

    return jsonResponse({ error: 'Onbekende actie' }, 400)
  } catch (err) {
    console.error('[kandidaat-matcher]', err)
    return jsonResponse({ error: err instanceof Error ? err.message : 'Onbekende fout' }, 500)
  }
})
