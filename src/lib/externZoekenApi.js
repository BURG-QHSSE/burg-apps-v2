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

const OPDRACHT_VELDEN =
  'id, created_at, vacature_id, vacaturetekst, strategie, doel_aantal, status, voortgang, foutmelding, aantal_resultaten, recruiter_project_id, verbruik'

/**
 * Verbruik per fase uit de start/eind-metingen: verschil in procentpunten van
 * de 5-uurs- en weeklimiet. Is de 5-uurssessie tussendoor gereset (eind < start),
 * dan is alleen een ondergrens bekend.
 */
export function berekenVerbruik(metingen = []) {
  const fases = [...new Set(metingen.map((m) => m.fase))]
  return fases.map((fase) => {
    const start = metingen.find((m) => m.fase === fase && m.moment === 'start')
    const eind = [...metingen].reverse().find((m) => m.fase === fase && m.moment === 'eind')
    if (!start || !eind) return { fase, klaar: false, start }
    const sessieGereset = eind.sessie_pct < start.sessie_pct
    return {
      fase,
      klaar: true,
      sessie: sessieGereset ? eind.sessie_pct : eind.sessie_pct - start.sessie_pct,
      sessieGereset,
      week: eind.week_pct - start.week_pct,
      minuten: Math.round((new Date(eind.gemeten_op) - new Date(start.gemeten_op)) / 60000),
    }
  })
}

export async function fetchOpdracht(id) {
  const { data, error } = await supabase.from('extern_zoeken_opdrachten').select(OPDRACHT_VELDEN).eq('id', id).single()
  if (error) throw new Error(error.message)
  return data
}

export async function fetchRecenteOpdrachten(aantal = 10) {
  const { data, error } = await supabase
    .from('extern_zoeken_opdrachten')
    .select('id, created_at, vacature_id, strategie, status, voortgang')
    .order('created_at', { ascending: false })
    .limit(aantal)
  if (error) throw new Error(error.message)
  return data
}

export async function fetchResultaten(opdrachtId) {
  const { data, error } = await supabase
    .from('extern_zoeken_resultaten')
    .select('id, kaart, in_bullhorn, score, onderbouwing, twijfel, status, created_at')
    .eq('opdracht_id', opdrachtId)
    .order('score', { ascending: false, nullsFirst: false })
  if (error) throw new Error(error.message)
  return data
}

/**
 * Verwerkt één terugmelding van Claude in Chrome (zie leesClaudeResultaten):
 * kandidaten upserten (zelfde profiel = zelfde rij) en de opdrachtstatus bijwerken.
 */
export async function slaClaudeResultatenOp(opdrachtId, melding, promptVersie) {
  if (melding.kandidaten.length) {
    const rijen = melding.kandidaten.map((k) => ({
      opdracht_id: opdrachtId,
      // Recruiter-profiel-URL is het stabiele ID; zonder URL naam + kopregel.
      recruiter_id: k.profiel_url || `${k.naam}|${k.kopregel ?? ''}`,
      kaart: { naam: k.naam, kopregel: k.kopregel ?? null, locatie: k.locatie ?? null, profiel_url: k.profiel_url ?? null },
      in_bullhorn: Boolean(k.in_bullhorn),
      score: Number.isInteger(k.score) && k.score >= 0 && k.score <= 100 ? k.score : null,
      onderbouwing: k.onderbouwing ?? null,
      twijfel: Boolean(k.twijfel),
      status: k.in_pipeline ? 'toegevoegd' : 'overgeslagen',
      model: 'claude-in-chrome',
      prompt_versie: promptVersie,
    }))
    const { error } = await supabase
      .from('extern_zoeken_resultaten')
      .upsert(rijen, { onConflict: 'opdracht_id,recruiter_id' })
    if (error) throw new Error(error.message)
  }

  const update = { status: melding.status ?? 'bezig' }
  if (melding.voortgang) update.voortgang = String(melding.voortgang)
  if (melding.aantal_resultaten != null) update.aantal_resultaten = String(melding.aantal_resultaten)
  if (melding.recruiter_project_url) update.recruiter_project_id = String(melding.recruiter_project_url)
  if (melding.status === 'fout') update.foutmelding = String(melding.voortgang ?? 'Gestopt door Claude')
  if (melding.verbruik) {
    // Lezen-en-aanvullen is hier veilig: per opdracht meldt maar één Claude-sessie terug.
    const { data, error } = await supabase.from('extern_zoeken_opdrachten').select('verbruik').eq('id', opdrachtId).single()
    if (error) throw new Error(error.message)
    update.verbruik = [...(data.verbruik ?? []), { ...melding.verbruik, gemeten_op: new Date().toISOString() }]
  }
  const { error } = await supabase.from('extern_zoeken_opdrachten').update(update).eq('id', opdrachtId)
  if (error) throw new Error(error.message)
}
