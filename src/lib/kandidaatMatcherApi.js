import { supabase } from './supabaseClient'

/**
 * Dunne wrappers rond de kandidaat-matcher Edge Function (Bullhorn/Claude,
 * vereist service-role/secrets — zie supabase/functions/kandidaat-matcher)
 * en rechtstreekse Supabase-reads voor het live uitlezen van de voortgang
 * (RLS beperkt matching_runs/matching_resultaten al tot admin, zie
 * supabase/schema.sql), zelfde stijl als gpbApi.js.
 */
async function invokeMatcher(action, payload = {}) {
  const { data, error } = await supabase.functions.invoke('kandidaat-matcher', {
    body: { action, ...payload },
  })

  if (error) {
    // supabase-js geeft bij een non-2xx Edge Function-response een generieke
    // FunctionsHttpError met de echte foutmelding in de response-body —
    // die proberen we hier op te vissen zodat de UI iets nuttigers toont
    // dan "Edge Function returned a non-2xx status code".
    const details = await error.context?.json?.().catch(() => null)
    throw new Error(details?.error || error.message)
  }
  if (data?.error) {
    throw new Error(data.error)
  }
  return data
}

/** Start een nieuwe matching-run voor een vacature-ID + vacaturetekst. */
export async function startRun(vacatureId, vacaturetekst) {
  return invokeMatcher('start-run', { vacatureId, vacaturetekst })
}

/** Verwerkt één batch kandidaten van een run — door de UI herhaald tot klaar. */
export async function processBatch(runId) {
  return invokeMatcher('process-batch', { runId })
}

export async function fetchRun(runId) {
  const { data, error } = await supabase.from('matching_runs').select('*').eq('id', runId).single()
  if (error) throw new Error(error.message)
  return data
}

/** Resultaten van een run, hoogste score eerst (nog niet gescoorde rijen onderaan). */
export async function fetchResultaten(runId) {
  const { data, error } = await supabase
    .from('matching_resultaten')
    .select('*')
    .eq('run_id', runId)
    .order('score', { ascending: false, nullsFirst: false })

  if (error) throw new Error(error.message)
  return data
}

/** Eerdere runs van de ingelogde admin, meest recente eerst — voor een "vorige runs"-lijstje. */
export async function fetchMijnRuns() {
  const { data, error } = await supabase
    .from('matching_runs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) throw new Error(error.message)
  return data
}
