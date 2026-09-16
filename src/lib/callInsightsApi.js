import { supabase } from './supabaseClient'

/**
 * Dunne wrappers rond de call-insights Edge Function + rechtstreekse
 * Supabase-reads. RLS op call_field_suggestions is per-gebruiker (`auth.uid()
 * = user_id`), dus fetchPendingSuggesties geeft vanzelf alleen de eigen
 * gesprekken van de ingelogde consultant terug — geen client-side filter
 * nodig. Zelfde invoke-foutafhandelingspatroon als kandidaatMatcherApi.js.
 */
async function invokeCallInsights(action, payload = {}) {
  const { data, error } = await supabase.functions.invoke('call-insights', {
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

/**
 * Nog niet beoordeelde suggesties van één consultant, nieuwste gesprek
 * eerst — gebruikt met `user.id` voor de eigen-gesprekken-weergave (zie
 * CallInsights.jsx). Voor het admin-overzicht over alle consultants heen:
 * fetchAllePendingSuggesties hieronder.
 */
export async function fetchPendingSuggesties(userId) {
  const { data, error } = await supabase
    .from('call_field_suggestions')
    .select('*')
    .eq('status', 'pending')
    .eq('user_id', userId)
    .order('call_started_at', { ascending: false })

  if (error) throw new Error(error.message)
  return data
}

/**
 * Is Call Insights al open voor consultants zelf (team=consultant), of nog
 * beperkt tot admin-only? Zie toolRegistry.js canAccessTool — elke
 * ingelogde gebruiker mag dit lezen (RLS), alleen een admin mag het wijzigen.
 */
export async function fetchCallInsightsLive() {
  const { data, error } = await supabase.from('call_insights_instellingen').select('live_voor_consultants').eq('id', 1).single()
  if (error) throw new Error(error.message)
  return !!data.live_voor_consultants
}

/** Zet de live-schakelaar (AdminPanel) — admin-only via RLS. */
export async function setCallInsightsLive(waarde) {
  const { error } = await supabase
    .from('call_insights_instellingen')
    .update({ live_voor_consultants: waarde, updated_at: new Date().toISOString() })
    .eq('id', 1)
  if (error) throw new Error(error.message)
}

/**
 * Alle profielen met team='consultant' (admin-only via RLS op profiles) —
 * voor het admin-overzicht (wie moet nog wat afhandelen) en de team-kolom
 * in AdminPanel.
 */
export async function fetchConsultantProfielen() {
  const { data, error } = await supabase.from('profiles').select('id, naam, email').eq('team', 'consultant').eq('actief', true)
  if (error) throw new Error(error.message)
  return data
}

/**
 * Admin-variant van fetchPendingSuggesties/fetchAmbigueMatches hieronder:
 * GEEN user_id-filter, dus over alle consultants heen (RLS "admin leest alle
 * suggesties"/"...verwerkte recordings" staat dit toe). Voor het
 * cross-consultant-overzicht (wie moet nog wat invullen, wie heeft wat
 * afgehandeld) — zie CallInsights.jsx.
 */
export async function fetchAllePendingSuggesties() {
  const { data, error } = await supabase
    .from('call_field_suggestions')
    .select('*')
    .eq('status', 'pending')
    .order('call_started_at', { ascending: false })
  if (error) throw new Error(error.message)
  return data
}

export async function fetchAlleAmbigueMatches() {
  const { data, error } = await supabase
    .from('call_insights_processed')
    .select('recording_url, user_id, call_started_at, kandidaat_kandidaten')
    .eq('skipped_reason', 'meerdere_kandidaten')
    .order('call_started_at', { ascending: false })
  if (error) throw new Error(error.message)
  return data
}

/**
 * Alle verwerkte recordings + alle suggesties (admin-only via RLS), voor het
 * Tooling Gebruik-overzicht (zie ToolingGebruik.jsx) — wie heeft wat
 * afgehandeld, tegen welke kosten. Losse, platte queries + client-side
 * aggregatie, zelfde stijl als de Kandidaat Matcher-tab in ToolingGebruik.jsx.
 */
export async function fetchCallInsightsGebruikData() {
  const [verwerktResult, suggestiesResult] = await Promise.all([
    supabase.from('call_insights_processed').select('user_id, kosten_usd, skipped_reason, processed_at'),
    supabase.from('call_field_suggestions').select('user_id, status, created_at'),
  ])
  if (verwerktResult.error) throw new Error(verwerktResult.error.message)
  if (suggestiesResult.error) throw new Error(suggestiesResult.error.message)
  return { verwerkt: verwerktResult.data, suggesties: suggestiesResult.data }
}

/**
 * Kandidaatnamen live ophalen voor weergave — wordt nooit opgeslagen (zelfde
 * AVG-voorzichtigheid als fetchKandidaatNamen in Kandidaat Matcher).
 * Retourneert {[candidateId]: naam}.
 */
export async function fetchKandidaatNamen(candidateIds) {
  if (candidateIds.length === 0) return {}
  const data = await invokeCallInsights('kandidaatNamen', { candidateIds })
  return data.namen
}

/** Accepteert een suggestie (optioneel met een handmatig gecorrigeerde waarde) — schrijft direct naar Bullhorn. */
export async function accepteerSuggestie(suggestionId, finalValue = null) {
  return invokeCallInsights('resolveSuggestion', { suggestionId, besluit: 'accepteren', finalValue })
}

/** Wijst een suggestie af — geen Bullhorn-write. */
export async function wijsSuggestieAf(suggestionId) {
  return invokeCallInsights('resolveSuggestion', { suggestionId, besluit: 'afwijzen' })
}

/**
 * Gesprekken van de gekozen consultant waarvan het telefoonnummer meerdere
 * kandidaten opleverde — wacht op een handmatige keuze (zie
 * resolveCandidateMatch hieronder).
 */
export async function fetchAmbigueMatches(userId) {
  const { data, error } = await supabase
    .from('call_insights_processed')
    .select('recording_url, call_started_at, kandidaat_kandidaten')
    .eq('skipped_reason', 'meerdere_kandidaten')
    .eq('user_id', userId)
    .order('call_started_at', { ascending: false })

  if (error) throw new Error(error.message)
  return data
}

/** De consultant kiest de juiste kandidaat bij een ambigue match — draait de Claude-extractie alsnog voor die kandidaat. */
export async function resolveCandidateMatch(recordingUrl, candidateId) {
  return invokeCallInsights('resolveCandidateMatch', { recordingUrl, candidateId })
}

/**
 * Admin-beheer van de uitsluitingslijst (AdminPanel) — welke 3CX-extensies
 * (sales/andere afdeling) nooit meetellen voor Call Insights-matching.
 * Rechtstreekse Supabase-reads/writes (geen Edge Function nodig): RLS op
 * beide tabellen staat dit al toe voor 'admin' (zie supabase/schema.sql).
 * Uitsluitingslijst, bewust niet een toelatingslijst — een nieuwe
 * consultant-collega wordt automatisch meegenomen, tenzij hier toegevoegd.
 */

/**
 * Alle 3CX-extensies met naam, voor de admin-lijst. Twee losse queries +
 * client-side join (zelfde stijl als de rest van dit project, bv.
 * callStatsApi.js) i.p.v. een PostgREST-embed — 'admin leest alle
 * profielen' geeft de aanroeper (AdminPanel is admin-only) toegang tot elke
 * rij in `profiles`.
 */
export async function fetchExtensieRoster() {
  const [mappingResult, profielenResult] = await Promise.all([
    supabase.from('cx_extension_mapping').select('extension, user_id').order('extension'),
    supabase.from('profiles').select('id, naam, email'),
  ])
  if (mappingResult.error) throw new Error(mappingResult.error.message)
  if (profielenResult.error) throw new Error(profielenResult.error.message)

  const profielPerId = new Map(profielenResult.data.map((p) => [p.id, p]))
  return mappingResult.data.map((row) => {
    const profiel = profielPerId.get(row.user_id)
    return {
      extension: row.extension,
      userId: row.user_id,
      naam: profiel?.naam || profiel?.email || `Onbekend (${row.user_id.slice(0, 8)})`,
    }
  })
}

/** Huidige uitsluitingslijst, extension -> reden. */
export async function fetchUitgeslotenExtensies() {
  const { data, error } = await supabase.from('call_insights_uitgesloten_extensies').select('extension, reden')
  if (error) throw new Error(error.message)
  return data
}

/** Sluit een extensie uit (of werkt de reden bij als die al uitgesloten was). */
export async function sluitExtensieUit(extension, reden) {
  const { error } = await supabase
    .from('call_insights_uitgesloten_extensies')
    .upsert({ extension, reden: reden || null }, { onConflict: 'extension' })
  if (error) throw new Error(error.message)
}

/** Haalt een extensie van de uitsluitingslijst af. */
export async function heractiveerExtensie(extension) {
  const { error } = await supabase.from('call_insights_uitgesloten_extensies').delete().eq('extension', extension)
  if (error) throw new Error(error.message)
}

/**
 * MVP-scoping (AdminPanel): welke ENE consultant Call Insights momenteel
 * verwerkt/toont — zie schema.sql-comment bij call_insights_mvp_actieve_
 * consultant. Rechtstreekse Supabase-read/write, admin-only via RLS.
 */
export async function fetchActieveConsultant() {
  const { data, error } = await supabase.from('call_insights_mvp_actieve_consultant').select('user_id').eq('id', 1).single()
  if (error) throw new Error(error.message)
  return data.user_id
}

export async function setActieveConsultant(userId) {
  const { error } = await supabase
    .from('call_insights_mvp_actieve_consultant')
    .update({ user_id: userId, updated_at: new Date().toISOString() })
    .eq('id', 1)
  if (error) throw new Error(error.message)
}
