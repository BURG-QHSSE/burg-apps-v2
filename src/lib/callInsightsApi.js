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
 * Per-consultant gebruiksoverzicht voor Tooling Gebruik (zie
 * ToolingGebruik.jsx) — geaggregeerd in de database (RPC
 * call_insights_gebruik_overzicht), niet client-side over losse rijen: bij
 * >1000 rijen liep de eerdere aanpak (losse .select() op
 * call_insights_processed/call_field_suggestions) tegen PostgREST's
 * standaard max-rows-limiet aan, en telde bovendien de bulk
 * 'historische_backlog_overgeslagen'-rijen (nooit echt door Bullhorn/Claude
 * verwerkt, zie index.ts) ten onrechte mee als "verwerkt". Die uitsluiting
 * gebeurt nu in de SQL-functie zelf.
 */
export async function fetchCallInsightsGebruikData() {
  const { data, error } = await supabase.rpc('call_insights_gebruik_overzicht')
  if (error) throw new Error(error.message)
  return data
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
