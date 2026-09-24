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
  'id, created_at, vacature_id, vacaturetekst, strategie, doel_aantal, status, voortgang, foutmelding, aantal_resultaten, recruiter_project_id, verbruik, fase, pipeline_teller'

/**
 * Verbruik per fase uit de start/eind-metingen: verschil in procentpunten van
 * de 5-uurs- en weeklimiet. Is de 5-uurssessie tussendoor gereset (eind < start),
 * dan is alleen een ondergrens bekend.
 */
export function berekenVerbruik(metingen = []) {
  // Een fase kan meerdere runs hebben (bijv. berichten: eerst nieuwe, later de
  // goedgekeurde); elke start/eind-combinatie telt op.
  const perFase = new Map()
  for (const m of metingen) {
    const f = perFase.get(m.fase) ?? { fase: m.fase, runs: 0, sessie: 0, week: 0, minuten: 0, sessieGereset: false, open: null }
    if (m.moment === 'start') {
      f.open = m
    } else if (m.moment === 'eind' && f.open) {
      const gereset = m.sessie_pct < f.open.sessie_pct
      f.sessie += gereset ? m.sessie_pct : m.sessie_pct - f.open.sessie_pct
      f.sessieGereset ||= gereset
      f.week += m.week_pct - f.open.week_pct
      f.minuten += Math.round((new Date(m.gemeten_op) - new Date(f.open.gemeten_op)) / 60000)
      f.runs += 1
      f.open = null
    }
    perFase.set(m.fase, f)
  }
  return [...perFase.values()]
}

export async function fetchOpdracht(id) {
  const { data, error } = await supabase.from('extern_zoeken_opdrachten').select(OPDRACHT_VELDEN).eq('id', id).single()
  if (error) throw new Error(error.message)
  return data
}

/**
 * Keuze van de consultant bij eerder contact. Na een "ja" (of met een
 * aangepaste tekst) staat het bericht in lijst B van de volgende Claude-run.
 */
export async function neemBerichtBesluit(opdrachtId, resultaatId, versturen, bericht) {
  const { error } = await supabase
    .from('extern_zoeken_resultaten')
    .update(versturen ? { status: 'bericht_goedgekeurd', bericht } : { status: 'bericht_afgewezen' })
    .eq('id', resultaatId)
  if (error) throw new Error(error.message)
  if (versturen) {
    const { error: fout } = await supabase
      .from('extern_zoeken_opdrachten')
      .update({ status: 'concept', voortgang: 'Goedgekeurde berichten wachten op verzending' })
      .eq('id', opdrachtId)
    if (fout) throw new Error(fout.message)
  }
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
    .select('id, kaart, in_bullhorn, score, onderbouwing, twijfel, status, onderwerp, bericht, eerder_contact, verzonden_op, created_at')
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

  // Fase berichten: rijen bijwerken op het id dat Claude uit de opdrachtlijst kreeg.
  await Promise.all(
    melding.berichten.map(async (b) => {
      const { error } = await supabase
        .from('extern_zoeken_resultaten')
        .update({
          status: b.status,
          onderwerp: b.onderwerp ?? null,
          bericht: b.bericht ?? null,
          eerder_contact: b.eerder_contact ?? null,
          verzonden_op: b.status === 'verzonden' ? new Date().toISOString() : null,
        })
        .eq('id', b.id)
        .eq('opdracht_id', opdrachtId)
      if (error) throw new Error(error.message)
    }),
  )

  const update = { status: melding.status ?? 'bezig' }
  if (melding.fase) update.fase = melding.fase
  if (melding.pipeline_teller != null) update.pipeline_teller = melding.pipeline_teller
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
