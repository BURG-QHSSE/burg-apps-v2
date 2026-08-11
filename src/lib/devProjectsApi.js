import { supabase } from './supabaseClient'

const TABLE = 'dev_projects'

// Velden waarvan een wijziging ook _aangepast_door/_aangepast_at moet
// bijwerken — "laatste wijziging wint" op deze twee gedeelde velden
// (uren_per_week, tijd_bespaard_minuten), zie supabase/schema.sql.
const GEDEELDE_VELDEN = ['uren_per_week', 'tijd_bespaard_minuten']

export async function fetchDevProjects() {
  const { data, error } = await supabase
    .from(TABLE)
    .select(`
      id, titel, notities, prioriteit, deadline, status,
      uren_per_week, uren_per_week_aangepast_at,
      uren_per_week_aangepast_door:profiles!dev_projects_uren_per_week_aangepast_door_fkey(naam),
      tijd_bespaard_minuten, tijd_bespaard_aangepast_at,
      tijd_bespaard_aangepast_door:profiles!dev_projects_tijd_bespaard_aangepast_door_fkey(naam),
      created_at
    `)
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(error.message)
  }

  return data
}

export async function createDevProject(titel, userId) {
  const { error } = await supabase.from(TABLE).insert({
    titel,
    prioriteit: 'midden',
    status: 'open',
    created_by: userId,
  })

  if (error) {
    throw new Error(error.message)
  }
}

/** Zet bij een gedeeld veld (zie GEDEELDE_VELDEN) ook wie/wanneer als laatst gewijzigd. */
export async function updateDevProjectVeld(id, veld, waarde, userId) {
  const patch = { [veld]: waarde }

  if (GEDEELDE_VELDEN.includes(veld)) {
    patch[`${veld}_aangepast_door`] = userId
    patch[`${veld}_aangepast_at`] = new Date().toISOString()
  }

  const { error } = await supabase.from(TABLE).update(patch).eq('id', id)

  if (error) {
    throw new Error(error.message)
  }
}

export async function deleteDevProject(id) {
  const { error } = await supabase.from(TABLE).delete().eq('id', id)

  if (error) {
    throw new Error(error.message)
  }
}
