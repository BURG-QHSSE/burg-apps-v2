import { supabase } from './supabaseClient'

const TABLE = 'troubleshoot_items'

/** Admin-inbox — RLS staat lezen sowieso alleen aan admin toe. */
export async function fetchTroubleshootItems() {
  const { data, error } = await supabase
    .from(TABLE)
    .select(`
      id, type, omschrijving, vanuit_tool, status, created_at,
      ingediend_door:profiles!troubleshoot_items_ingediend_door_fkey(naam)
    `)
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(error.message)
  }

  return data
}

/** Aantal nog niet opgepakte meldingen ('nieuw') — voor de rode stip/badge bij Ontwikkeling. RLS staat lezen sowieso alleen aan admin toe. */
export async function fetchNieuweTroubleshootCount() {
  const { count, error } = await supabase.from(TABLE).select('id', { count: 'exact', head: true }).eq('status', 'nieuw')

  if (error) {
    throw new Error(error.message)
  }

  return count ?? 0
}

export async function updateTroubleshootStatus(id, status) {
  const { error } = await supabase.from(TABLE).update({ status }).eq('id', id)

  if (error) {
    throw new Error(error.message)
  }
}

/** Vanuit het floating helpdesk-widgetje (TroubleshootWidget.jsx) — voor alle ingelogde gebruikers. */
export async function submitTroubleshootItem({ type, omschrijving, userId, vanuitTool }) {
  const { error } = await supabase.from(TABLE).insert({
    type,
    omschrijving,
    ingediend_door: userId,
    vanuit_tool: vanuitTool,
  })

  if (error) {
    throw new Error(error.message)
  }
}
