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

/** Slaat de gecontroleerde zoekopdracht op als nieuwe opdracht (RLS: alleen admin). */
export async function slaOpdrachtOp(vacatureId, vacaturetekst, strategie) {
  const { data, error } = await supabase
    .from('extern_zoeken_opdrachten')
    .insert({ vacature_id: vacatureId || null, vacaturetekst, strategie })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  return data.id
}

export async function fetchOpdracht(id) {
  const { data, error } = await supabase
    .from('extern_zoeken_opdrachten')
    .select('id, status, voortgang, foutmelding, aantal_resultaten, recruiter_project_id')
    .eq('id', id)
    .single()
  if (error) throw new Error(error.message)
  return data
}

/**
 * Koppeling met de BURG Chrome-extensie (content script brug.js) via
 * window.postMessage. De extensie vraagt steeds een vers toegangstoken op
 * zolang dit tabblad open is; supabase-js ververst dat zelf, zodat de extensie
 * nooit een refresh-token nodig heeft.
 */
export function koppelExtensie({ onVersie, onGestart, onFout }) {
  async function luister(event) {
    if (event.source !== window || event.data?.bron !== 'burg-extensie') return
    const bericht = event.data
    if (bericht.type === 'pong') onVersie?.(bericht.versie)
    if (bericht.type === 'gestart') onGestart?.()
    if (bericht.type === 'fout') onFout?.(bericht.fout)
    if (bericht.type === 'haalToken') {
      const { data } = await supabase.auth.getSession()
      window.postMessage({ bron: 'burg-apps', type: 'token', verzoekId: bericht.verzoekId, token: data.session?.access_token }, window.location.origin)
    }
  }
  window.addEventListener('message', luister)
  const ping = () => window.postMessage({ bron: 'burg-apps', type: 'ping' }, window.location.origin)
  ping()
  const timer = setTimeout(ping, 800)
  return () => {
    clearTimeout(timer)
    window.removeEventListener('message', luister)
  }
}

export function startInRecruiter(opdrachtId) {
  window.postMessage(
    {
      bron: 'burg-apps',
      type: 'start',
      opdrachtId,
      supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
      anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
    window.location.origin,
  )
}
