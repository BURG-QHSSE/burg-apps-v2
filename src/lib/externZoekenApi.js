import { supabase } from './supabaseClient'

/**
 * Dunne wrapper rond de extern-zoeken Edge Function (zie
 * supabase/functions/extern-zoeken), zelfde foutafhandeling als
 * kandidaatMatcherApi.js.
 */
async function invokeExternZoeken(action, payload = {}) {
  const { data, error } = await supabase.functions.invoke('extern-zoeken', {
    body: { action, ...payload },
  })

  if (error) {
    const details = await error.context?.json?.().catch(() => null)
    throw new Error(details?.error || error.message)
  }
  if (data?.error) {
    throw new Error(data.error)
  }
  return data
}

/** Vacaturetekst → Recruiter-zoekopdracht (boolean, filters, ideaalprofiel). */
export async function maakStrategie(vacatureId, vacaturetekst) {
  const data = await invokeExternZoeken('strategie', { vacatureId, vacaturetekst })
  return data.strategie
}
