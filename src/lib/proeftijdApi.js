import { supabase } from './supabaseClient'

const TABLE = 'proeftijd_kandidaten'

/** Haalt alle kandidaten op, nieuwste eerst — sortering op einddatum gebeurt client-side. */
export async function fetchKandidaten() {
  const { data, error } = await supabase.from(TABLE).select('*').order('created_at', { ascending: false })

  if (error) {
    throw new Error(error.message)
  }

  return data
}

export async function addKandidaat({ naam, startDatum, duurMaanden, userId }) {
  const { error } = await supabase
    .from(TABLE)
    .insert({ naam, start_datum: startDatum, duur_maanden: duurMaanden, created_by: userId })

  if (error) {
    throw new Error(error.message)
  }
}

export async function removeKandidaat(id) {
  const { error } = await supabase.from(TABLE).delete().eq('id', id)

  if (error) {
    throw new Error(error.message)
  }
}

/**
 * Live-sync tussen collega's: als iemand anders een kandidaat toevoegt of
 * verwijdert, ziet iedereen dat zonder handmatig te hoeven verversen —
 * zelfde patroon als de aanwezigheids-sync in Kansen Swiper.
 */
export function subscribeToKandidaten(onChange) {
  const channel = supabase
    .channel('proeftijd-kandidaten-watch')
    .on('postgres_changes', { event: '*', schema: 'public', table: TABLE }, onChange)
    .subscribe()

  return () => {
    supabase.removeChannel(channel)
  }
}
