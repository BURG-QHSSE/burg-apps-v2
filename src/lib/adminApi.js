import { supabase } from './supabaseClient'

/**
 * Haalt alle profielen op. RLS zorgt er automatisch voor dat dit alleen
 * daadwerkelijk rijen oplevert voor gebruikers met rol 'admin' of 'manager'
 * (zie policies "admin leest alle profielen" / "manager leest alle
 * profielen" in supabase/schema.sql). Voor een gewone 'user' komt hier dus
 * hooguit het eigen profiel uit terug.
 *
 * @returns {Promise<Array<object>>} rijen uit de `profiles` tabel
 */
export async function fetchAllProfiles() {
  const { data, error } = await supabase.from('profiles').select('*')

  if (error) {
    throw new Error(error.message)
  }

  return data
}

/**
 * Wijzigt de rol van een gebruiker. Dit is de ENIGE manier waarop de rol
 * van een profiel gewijzigd mag worden vanuit de client: het gaat via de
 * `change_user_role` Postgres-functie (security definer), die:
 *  - controleert dat de aanroeper zelf admin is,
 *  - voorkomt dat de laatste admin gedegradeerd wordt,
 *  - een audit-log regel wegschrijft in `role_audit_log`.
 *
 * Er is bewust GEEN directe `.update()` op `profiles.role` toegevoegd —
 * dat zou de RLS/audit-beveiliging van dit schema omzeilen.
 *
 * @param {string} targetId - uuid van het profiel dat gewijzigd wordt
 * @param {'admin'|'manager'|'user'} newRole - de nieuwe rol
 * @throws {Error} met de Postgres-foutmelding, bv.
 *   "Kan de laatste admin niet degraderen" of
 *   "Alleen admins mogen rollen wijzigen"
 */
export async function changeUserRole(targetId, newRole) {
  const { error } = await supabase.rpc('change_user_role', {
    target_id: targetId,
    new_role_value: newRole,
  })

  if (error) {
    throw new Error(error.message)
  }
}

/**
 * (De)activeert een gebruiker — de "zachte verwijdering". Gaat via de
 * `set_user_actief` Postgres-functie (security definer), met dezelfde
 * bescherming als changeUserRole: alleen admin, geen zelf-deactivatie,
 * geen deactivatie van de laatste actieve admin.
 *
 * @param {string} targetId
 * @param {boolean} actief
 * @throws {Error} met de Postgres-foutmelding
 */
export async function setUserActief(targetId, actief) {
  const { error } = await supabase.rpc('set_user_actief', {
    target_id: targetId,
    new_actief: actief,
  })

  if (error) {
    throw new Error(error.message)
  }
}

/**
 * Wijzigt het `naam`-veld van een profiel. Gaat via de `set_user_naam`
 * Postgres-functie (security definer, admin-only) — er is bewust geen
 * directe `.update()` op `profiles` toegevoegd, om consistent te blijven
 * met het "geen client-UPDATE-policy op profiles"-principe.
 *
 * @param {string} targetId
 * @param {string} naam
 * @throws {Error} met de Postgres-foutmelding
 */
export async function setUserNaam(targetId, naam) {
  const { error } = await supabase.rpc('set_user_naam', {
    target_id: targetId,
    new_naam: naam,
  })

  if (error) {
    throw new Error(error.message)
  }
}

/**
 * Zet de "Mijn Omgeving uitgebreid"-vlag — los van de rol-hiërarchie,
 * bepaalt of iemand binnen Mijn Omgeving de extra tabbladen (Second
 * Check/Analytics/Monitoring) te zien krijgt. Gaat via de
 * `set_mijn_omgeving_uitgebreid` Postgres-functie (security definer,
 * admin-only).
 *
 * @param {string} targetId
 * @param {boolean} uitgebreid
 * @throws {Error} met de Postgres-foutmelding
 */
export async function setMijnOmgevingUitgebreid(targetId, uitgebreid) {
  const { error } = await supabase.rpc('set_mijn_omgeving_uitgebreid', {
    target_id: targetId,
    new_waarde: uitgebreid,
  })

  if (error) {
    throw new Error(error.message)
  }
}

/**
 * Maakt een nieuw account aan (met wachtwoord) via de `admin-users` Edge
 * Function. Dit kan niet met de anon-key alleen — het vereist de
 * service_role-sleutel, die uitsluitend server-side (in de Edge Function)
 * leeft, nooit in de browser.
 *
 * @param {{ email: string, password: string, naam?: string, role?: 'admin'|'manager'|'user' }} input
 * @returns {Promise<string>} het nieuwe user-id
 * @throws {Error}
 */
export async function createUser({ email, password, naam, role }) {
  const { data, error } = await supabase.functions.invoke('admin-users', {
    body: { action: 'create', email, password, naam, role },
  })

  if (error) {
    throw new Error(error.message)
  }
  if (data?.error) {
    throw new Error(data.error)
  }

  return data.userId
}

/**
 * Verwijdert een account PERMANENT (via de admin-API in de Edge Function).
 * Dit is onomkeerbaar — role_audit_log/tool_usage-regels van deze
 * gebruiker blijven bestaan maar verliezen de verwijzing (on delete set
 * null in het schema). Voor een omkeerbaar alternatief: setUserActief().
 *
 * @param {string} targetId
 * @throws {Error}
 */
export async function deleteUserPermanently(targetId) {
  const { data, error } = await supabase.functions.invoke('admin-users', {
    body: { action: 'delete', targetId },
  })

  if (error) {
    throw new Error(error.message)
  }
  if (data?.error) {
    throw new Error(data.error)
  }
}
