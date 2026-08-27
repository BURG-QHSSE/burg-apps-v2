import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Edge Function: kandidaat-matcher
//
// Consultant zet in Bullhorn zelf een bulk-Notitie (actie "Matching", met
// het kale vacature-ID als tekst) op de kandidaten van een boolean search;
// deze functie haalt die kandidaten op via die notitie, anonimiseert per
// kandidaat het CV/intake-veld (zie anonimiseren.ts — persoonsgegevens gaan
// NOOIT naar Claude) en laat Claude scoren tegen de vacaturetekst.
//
// Waarom via een Notitie i.p.v. een Tearsheet/distributielijst: een nieuwe
// Tearsheet is tot ~1 week onzichtbaar voor het gedeelde REST-service-
// account (bevestigd met Bullhorn support, zie project-geheugen) — Note is,
// anders dan Tearsheet, wél realtime zichtbaar. Zie bullhorn.ts voor de
// volledige uitleg en de note-cleanup na afloop.
//
// Drie acties (body.action):
//   - "start-run": kandidaten via de Matching-notitie ophalen, matching_runs
//     + placeholder matching_resultaten-rijen (status 'wacht') aanmaken, en
//     de gebruikte notities verwijderen.
//   - "process-batch": een klein aantal 'wacht'-rijen van een run pakken,
//     scoren, wegschrijven. Wordt door de browser herhaald tot er niets
//     meer te doen is — nodig omdat een Edge Function-invocatie maar ~150s
//     mag duren (zie supabase/schema.sql voor de volledige uitleg).
//   - "kandidaat-namen": namen live ophalen voor een lijst bullhorn_id's,
//     puur voor weergave zodra een run klaar is — NOOIT opgeslagen (zie
//     matching_resultaten-schema-comment: bewust geen PII in de database).
//
// Zelfde beveiligingspatroon als admin-users/index.ts: eerst de JWT van de
// aanroeper verifiëren en checken dat profiles.role admin/manager/hr is (via
// een client die alleen de anon-key + die JWT gebruikt, dus onder normale
// RLS), pas dan verdergaan met de service-role-client. Zelfde rol-drempel
// als toolRegistry.js's minimumRole: 'manager' voor deze tool.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  getBullhornSession,
  getVacatureNaam,
  getMatchingKandidatenViaNotitie,
  verwijderMatchingNotities,
  getCandidateProfiel,
  getCandidateNaam,
} from './bullhorn.ts'
import { anonimiseerVrijeTekst, stripHtml, maakKandidaatLabel } from './anonimiseren.ts'
import { rankKandidaat, bereidVacaturetekstVoorCache, prewarmCache } from './claude.ts'
import { bepaalSalarisFilterData } from './salarisfilter.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

// Configureerbaar zodat dit makkelijk kleiner te zetten is als een batch
// tegen de 150s-tijdslimiet aanloopt (zie schema.sql-comment bij
// matching_runs) — bv. `supabase secrets set MATCHER_BATCH_SIZE=3`.
const BATCH_SIZE = Number(Deno.env.get('MATCHER_BATCH_SIZE')) || 6
// Hoeveel Claude-aanroepen binnen één batch tegelijk lopen. Gelijk aan
// BATCH_SIZE gezet zodat een hele batch in één golf scoort i.p.v. meerdere
// opeenvolgende golven (was eerder 3, dus 2 golven bij BATCH_SIZE=6).
const CLAUDE_CONCURRENCY = BATCH_SIZE
// Hoeveel Bullhorn-profiel-aanroepen binnen één batch tegelijk lopen. Mag
// parallel: elke aanroep herstelt zelf een verlopen sessie via bullhornGet's
// ingebouwde 401-retry (zie bullhorn.ts) - er hoeft dus geen sequentieel
// bijgewerkte sessie meer doorgegeven te worden tussen aanroepen.
const BULLHORN_CONCURRENCY = BATCH_SIZE
// Concurrency voor de losse "kandidaat-namen"-actie - bewust NIET aan
// BATCH_SIZE gekoppeld, want die maat is afgestemd op de Claude-
// scoringsbatches (moet daar binnen de tijd blijven), terwijl dit een
// eenmalige, lichte naam-only-fetch is die maar één keer per bekeken run
// gebeurt (en daarna client-side gecachet, zie sessionStorage in
// KandidaatMatcher.jsx) - mag dus fors hoger staan zonder extra risico.
const NAMEN_CONCURRENCY = 20
// Zelfde grens als MAX_CV_LENGTE in server.py (kandidaat-ranker) — boven dit
// aantal tekens is het CV-veld vrijwel zeker corrupt (bijlage-/e-mailruis),
// geen scoorbare inhoud.
const MAX_CV_LENGTE = 25000
// Guardrail tegen een te brede boolean search op de distributielijst die
// een onbedoeld dure run oplevert — bv. `supabase secrets set
// MATCHER_MAX_KOSTEN_USD=10`. Bij overschrijding stopt de run (status
// 'kostenlimiet') en worden resterende kandidaten niet meer gescoord.
const MAX_KOSTEN_PER_RUN_USD = Number(Deno.env.get('MATCHER_MAX_KOSTEN_USD')) || 5

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

/**
 * Stopt een run wegens de kostenlimiet: zet de run op status 'kostenlimiet'
 * met een duidelijke foutmelding (mogelijke oorzaak: een te brede boolean
 * search op de distributielijst), en zet alle nog niet verwerkte kandidaten
 * ('wacht'/'bezig') in één keer op 'fout' i.p.v. ze alsnog te scoren.
 */
async function stopRunWegensKostenlimiet(
  // deno-lint-ignore no-explicit-any
  admin: any,
  runId: string,
  kostenUsd: number,
): Promise<void> {
  const melding =
    `Run gestopt: kostenlimiet ($${MAX_KOSTEN_PER_RUN_USD}) bereikt (geschat: $${kostenUsd.toFixed(2)}). ` +
    'Mogelijk een te brede zoekopdracht op de distributielijst — controleer het aantal kandidaten.'
  await admin
    .from('matching_runs')
    .update({ status: 'kostenlimiet', foutmelding: melding })
    .eq('id', runId)
    .eq('status', 'bezig')
  await admin
    .from('matching_resultaten')
    .update({ status: 'fout', foutmelding: melding, updated_at: new Date().toISOString() })
    .eq('run_id', runId)
    .in('status', ['wacht', 'bezig'])
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

    // Zelfde rol-drempel als toolRegistry.js's minimumRole: 'user' voor deze
    // tool (sinds 2026-08-27 voor iedereen open, niet meer alleen
    // admin/manager/hr) - hier alsnog expliciet checken dat er een geldig,
    // bekend profiel is, i.p.v. de check helemaal weg te laten.
    if (profileError || !['admin', 'manager', 'hr', 'user'].includes(callerProfile?.role)) {
      return jsonResponse({ error: 'Onvoldoende rechten om deze actie uit te voeren' }, 403)
    }

    const admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!)
    const body = await req.json()

    if (body.action === 'start-run') {
      const vacatureId = Number(body.vacatureId)
      const vacaturetekst = String(body.vacaturetekst ?? '').trim()
      if (!vacatureId || !vacaturetekst) {
        return jsonResponse({ error: 'vacatureId en vacaturetekst zijn verplicht' }, 400)
      }

      let session = await getBullhornSession(admin)
      const vacatureNaamResult = await getVacatureNaam(admin, session, vacatureId)
      session = vacatureNaamResult.session
      const vacatureNaam = vacatureNaamResult.naam ?? `Vacature ${vacatureId}`

      const { candidateIds, noteIds, session: sessionNaMatching } = await getMatchingKandidatenViaNotitie(
        admin,
        session,
        vacatureId,
      )
      session = sessionNaMatching

      const { data: run, error: runError } = await admin
        .from('matching_runs')
        .insert({
          created_by: userData.user.id,
          created_by_naam: callerProfile.naam ?? null,
          vacature_id: vacatureId,
          vacature_naam: vacatureNaam,
          vacaturetekst,
          aantal_kandidaten: candidateIds.length,
          status: candidateIds.length > 0 ? 'bezig' : 'fout',
          foutmelding:
            candidateIds.length > 0
              ? null
              : 'Geen kandidaten gevonden - controleer of de bulk-Notitie (actie "Matching", tekst = dit vacature-ID) goed is gezet in Bullhorn.',
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

      // Pas NA succesvolle matching_resultaten-rijen opruimen - zie
      // verwijderMatchingNotities in bullhorn.ts voor de reden. Via
      // EdgeRuntime.waitUntil() i.p.v. await: bij een grote run (honderden
      // notities) bleek dit sequentieel ruim boven de ~150s-limiet van een
      // Edge Function-aanroep te duren, waardoor de aanroep werd afgebroken
      // vóórdat er ook maar één notitie verwijderd was (en zonder geloggde
      // fout, want de aanroep werd hard afgebroken, niet netjes gestopt).
      // waitUntil laat dit los van de response op de achtergrond doorlopen -
      // de browser krijgt meteen antwoord, de opruiming (nu ook parallel,
      // zie VERWIJDER_CONCURRENCY) gebeurt onafhankelijk daarvan.
      if (noteIds.length > 0) {
        EdgeRuntime.waitUntil(verwijderMatchingNotities(admin, session, noteIds))
      }

      return jsonResponse({ runId: run.id, vacatureNaam, aantalKandidaten: candidateIds.length })
    }

    if (body.action === 'kandidaat-namen') {
      // deno-lint-ignore no-explicit-any
      const bullhornIds = (Array.isArray(body.bullhornIds) ? body.bullhornIds : []).map((id: any) => Number(id))
      if (bullhornIds.length === 0) {
        return jsonResponse({ namen: {} })
      }

      // Parallel i.p.v. sequentieel - bij een grote run (honderden
      // kandidaten) duurde dit anders minutenlang en liep het risico tegen
      // de ~150s Edge Function-limiet aan te lopen. NAMEN_CONCURRENCY (niet
      // BULLHORN_CONCURRENCY) - zie de constante hierboven voor waarom dit
      // hoger mag staan dan de scoringsbatches.
      const bullhornSessieVoorNamen = await getBullhornSession(admin)
      const namen: Record<number, string> = {}
      await mapMetLimiet(bullhornIds, NAMEN_CONCURRENCY, async (id: number) => {
        try {
          const result = await getCandidateNaam(admin, bullhornSessieVoorNamen, id)
          namen[id] = result.naam
        } catch (err) {
          console.error(`[kandidaat-matcher] Naam ophalen voor kandidaat ${id} mislukt:`, err)
        }
      })
      return jsonResponse({ namen })
    }

    if (body.action === 'process-batch') {
      const runId = String(body.runId ?? '')
      if (!runId) {
        return jsonResponse({ error: 'runId is verplicht' }, 400)
      }

      const { data: run, error: runError } = await admin
        .from('matching_runs')
        .select('id, vacaturetekst, status, geschatte_kosten_usd')
        .eq('id', runId)
        .single()
      if (runError || !run) {
        return jsonResponse({ error: 'Run niet gevonden' }, 404)
      }

      // Kostenlimiet-check VÓÓR het claimen van een nieuwe batch — een
      // vorige batch kan de limiet net bereikt hebben. Geen nieuwe
      // Bullhorn/Claude-aanroepen meer, resterende 'wacht'-rijen worden in
      // één keer op 'fout' gezet met een duidelijke reden.
      if (run.geschatte_kosten_usd >= MAX_KOSTEN_PER_RUN_USD) {
        await stopRunWegensKostenlimiet(admin, runId, run.geschatte_kosten_usd)
        return jsonResponse({ verwerkt: 0, resterend: 0, klaar: true, kostenlimietBereikt: true })
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

      // Lopende kosten van deze batch (prewarm + alle rankKandidaat-
      // aanroepen) - aan het eind bij run.geschatte_kosten_usd opgeteld en
      // tegen MAX_KOSTEN_PER_RUN_USD gecheckt.
      let batchKostenUsd = 0

      // Schrijf de cache-entry alvast weg terwijl stap 1 (Bullhorn) loopt —
      // zonder dit racen de eerste parallelle rankKandidaat()-aanroepen in
      // stap 2 om dezelfde cache-entry en missen ze 'm allemaal. Net als in
      // server.py is een mislukte pre-warm niet fataal: gewoon verdergaan
      // zonder cache-voordeel.
      const prewarmPromise = prewarmCache(vacatureTekstVoorCache)
        .then(({ kostenUsd }) => {
          batchKostenUsd += kostenUsd
        })
        .catch((err) => {
          console.error('[kandidaat-matcher] Prewarm mislukt, verdergaan zonder cache:', err)
        })

      // Stap 1: Bullhorn-profielen ophalen — parallel (BULLHORN_CONCURRENCY).
      // Eén keer een geldige sessie ophalen (cache-backed, zie bullhorn.ts) en
      // die aan alle parallelle aanroepen meegeven; een individuele aanroep
      // die alsnog een 401 tegenkomt (bv. sessie verlopen middenin de batch)
      // herstelt zichzelf via bullhornGet's ingebouwde retry, onafhankelijk
      // van de andere aanroepen.
      const bullhornSessie = await getBullhornSession(admin)

      type VoorbereidItem = {
        rowId: string
        bullhornId: number
        label: string
        payload: Record<string, string> | null
        foutmelding: string | null
        klaarZonderScore: string | null
        // Puur voor de filterbalk (zie salarisfilter.ts) - gaan NOOIT naar
        // Claude's payload hierboven. Onbekend zolang het profiel nog niet
        // is opgehaald (bv. bij een technische fout).
        bullhornStatus: string | null
        salarisBand: string | null
        uurtariefBand: string | null
      }

      // deno-lint-ignore no-explicit-any
      const voorbereid = await mapMetLimiet(batchRows, BULLHORN_CONCURRENCY, async (row: any, i): Promise<VoorbereidItem> => {
        const label = maakKandidaatLabel(row.bullhorn_id, i)
        try {
          const { profiel } = await getCandidateProfiel(admin, bullhornSessie, row.bullhorn_id)
          const naamVolledig = `${profiel.firstName} ${profiel.lastName}`.trim()
          const cvRuw = profiel.description ? stripHtml(profiel.description).trim() : ''
          const { salarisBand, uurtariefBand } = bepaalSalarisFilterData(
            profiel.salarisRange,
            profiel.uurtariefRange,
            profiel.description,
          )
          const bullhornStatus = profiel.status

          if (!cvRuw) {
            return {
              rowId: row.id,
              bullhornId: row.bullhorn_id,
              label,
              payload: null,
              foutmelding: null,
              klaarZonderScore: 'Geen CV-tekst beschikbaar in Bullhorn voor deze kandidaat.',
              bullhornStatus,
              salarisBand,
              uurtariefBand,
            }
          }

          // Zelfde grens als MAX_CV_LENGTE in server.py: boven dit aantal
          // tekens is het CV-veld vrijwel zeker corrupt (bv. bijlage- of
          // e-mailruis die in description terecht is gekomen via de sync) —
          // overslaan i.p.v. dat als "CV" naar Claude te sturen.
          if (cvRuw.length > MAX_CV_LENGTE) {
            return {
              rowId: row.id,
              bullhornId: row.bullhorn_id,
              label,
              payload: null,
              foutmelding: null,
              klaarZonderScore: `Overgeslagen — CV-veld te lang (${cvRuw.length} tekens, limiet is ${MAX_CV_LENGTE}).`,
              bullhornStatus,
              salarisBand,
              uurtariefBand,
            }
          }

          const geanonimiseerd = anonimiseerVrijeTekst(cvRuw, label, naamVolledig)
          return {
            rowId: row.id,
            bullhornId: row.bullhorn_id,
            label,
            payload: { CV: geanonimiseerd },
            foutmelding: null,
            klaarZonderScore: null,
            bullhornStatus,
            salarisBand,
            uurtariefBand,
          }
        } catch (err) {
          return {
            rowId: row.id,
            bullhornId: row.bullhorn_id,
            label,
            payload: null,
            foutmelding: err instanceof Error ? err.message : String(err),
            klaarZonderScore: null,
            bullhornStatus: null,
            salarisBand: null,
            uurtariefBand: null,
          }
        }
      })

      // Stap 2: Claude-scoring — parallel binnen de batch, met caching op
      // systeemprompt + vacaturetekst (zie claude.ts). Wacht eerst de
      // pre-warm af zodat deze parallelle aanroepen een cache-treffer
      // krijgen i.p.v. te racen om de cache-entry.
      await prewarmPromise
      await mapMetLimiet(voorbereid, CLAUDE_CONCURRENCY, async (item) => {
        const filterVelden = {
          bullhorn_status: item.bullhornStatus,
          salaris_band: item.salarisBand,
          uurtarief_band: item.uurtariefBand,
        }
        if (item.foutmelding) {
          await admin
            .from('matching_resultaten')
            .update({ status: 'fout', foutmelding: item.foutmelding, ...filterVelden, updated_at: new Date().toISOString() })
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
              ...filterVelden,
              updated_at: new Date().toISOString(),
            })
            .eq('id', item.rowId)
          return
        }
        if (!item.payload) {
          return
        }
        try {
          const { score, onderbouwing, kostenUsd } = await rankKandidaat(vacatureTekstVoorCache, item.label, item.payload)
          batchKostenUsd += kostenUsd
          await admin
            .from('matching_resultaten')
            .update({ status: 'klaar', score, onderbouwing, ...filterVelden, updated_at: new Date().toISOString() })
            .eq('id', item.rowId)
        } catch (err) {
          await admin
            .from('matching_resultaten')
            .update({
              status: 'fout',
              foutmelding: err instanceof Error ? err.message : String(err),
              ...filterVelden,
              updated_at: new Date().toISOString(),
            })
            .eq('id', item.rowId)
        }
      })

      // matching_pak_batch() gebruikt SKIP LOCKED, dus dit is de enige plek
      // die zowel de oude als de net-in-deze-batch bijgewerkte kosten kent —
      // atomisch optellen i.p.v. lezen-optellen-schrijven (voorkomt een race
      // met een gelijktijdige process-batch-aanroep van dezelfde run).
      const { data: bijgewerkteRun } = await admin.rpc('matching_verhoog_kosten', {
        p_run_id: runId,
        p_delta_usd: batchKostenUsd,
      })
      const totaalKostenUsd = bijgewerkteRun?.[0]?.geschatte_kosten_usd ?? run.geschatte_kosten_usd + batchKostenUsd

      if (totaalKostenUsd >= MAX_KOSTEN_PER_RUN_USD) {
        await stopRunWegensKostenlimiet(admin, runId, totaalKostenUsd)
        return jsonResponse({ verwerkt: batchRows.length, resterend: 0, klaar: true, kostenlimietBereikt: true })
      }

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
