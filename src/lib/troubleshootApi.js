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

/** Nog niet opgepakte meldingen ('nieuw') — voor het notificatiepaneel en de badge bij Ontwikkeling. RLS staat lezen sowieso alleen aan admin toe. */
export async function fetchNieuweTroubleshootItems() {
  const { data, error } = await supabase
    .from(TABLE)
    .select(`
      id, type, omschrijving, vanuit_tool, created_at,
      ingediend_door:profiles!troubleshoot_items_ingediend_door_fkey(naam)
    `)
    .eq('status', 'nieuw')
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(error.message)
  }

  return data
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
