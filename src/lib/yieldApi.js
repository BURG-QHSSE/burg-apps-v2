import { supabase } from './supabaseClient'

/**
 * Yield-thermometer — zie Dashboard.jsx (YieldThermometer) en
 * AdminPanel.jsx (yield_telt_mee-checkbox). Yield = aantal consultants
 * (profiles.yield_telt_mee = true) gedeeld door aantal plaatsingen deze
 * maand. Target voor H2 2026: 0,8.
 */

/** Aantal profielen dat meetelt als consultant — via RPC, zie schema.sql. */
export async function fetchYieldConsultantCount() {
  const { data, error } = await supabase.rpc('yield_consultant_count')

  if (error) {
    throw new Error(error.message)
  }

  return data ?? 0
}

function startVanDezeMaand() {
  const nu = new Date()
  return new Date(nu.getFullYear(), nu.getMonth(), 1).toISOString().slice(0, 10)
}

function startVanVolgendeMaand() {
  const nu = new Date()
  return new Date(nu.getFullYear(), nu.getMonth() + 1, 1).toISOString().slice(0, 10)
}

/** Alle plaatsingen van de huidige kalendermaand, nieuwste eerst. */
export async function fetchPlaatsingenDezeMaand() {
  const { data, error } = await supabase
    .from('plaatsingen')
    .select('id, geplaatst_op, created_at')
    .gte('geplaatst_op', startVanDezeMaand())
    .lt('geplaatst_op', startVanVolgendeMaand())
    .order('geplaatst_op', { ascending: false })

  if (error) {
    throw new Error(error.message)
  }

  return data ?? []
}

/** Voegt één plaatsing toe met als datum vandaag. Alleen hr/admin (RLS). */
export async function voegPlaatsingToe() {
  const { error } = await supabase.from('plaatsingen').insert({})

  if (error) {
    throw new Error(error.message)
  }
}

/** Verwijdert een per ongeluk toegevoegde plaatsing. Alleen hr/admin (RLS). */
export async function verwijderPlaatsing(id) {
  const { error } = await supabase.from('plaatsingen').delete().eq('id', id)

  if (error) {
    throw new Error(error.message)
  }
}

/** Zet yield_telt_mee voor een profiel — alleen admin (RPC, zie schema.sql). */
export async function setYieldTeltMee(targetId, waarde) {
  const { error } = await supabase.rpc('set_yield_telt_mee', {
    target_id: targetId,
    new_waarde: waarde,
  })

  if (error) {
    throw new Error(error.message)
  }
}
