import { supabase } from './supabaseClient'

const TABLE = 'notificaties'

/**
 * Onbekeken notificaties voor de ingelogde gebruiker. RLS beperkt lezen
 * sowieso al tot auth.uid(), dus geen client-side user_id-filter nodig.
 * Rijen worden uitsluitend door triggers geschreven (zie schema.sql) — dit
 * bestand doet enkel lezen.
 */
export async function fetchOnbekekenNotificaties() {
  const { data, error } = await supabase
    .from(TABLE)
    .select('id, type, titel, omschrijving, link, created_at')
    .eq('gelezen', false)
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(error.message)
  }

  return data
}
