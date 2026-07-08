import { supabase } from './supabaseClient'

/**
 * Logt één gebruiksmoment van een tool. RLS staat alleen toe dat een
 * gebruiker zijn eigen `user_id` wegschrijft (zie policy "gebruiker logt
 * eigen tool-gebruik" in supabase/schema.sql). Fouten worden alleen
 * gelogd naar de console — een mislukte telling mag de tool zelf nooit
 * blokkeren.
 *
 * @param {string} toolId - het `id` uit toolRegistry.js (bv. 'fee-checker')
 * @param {string} userId - `auth.uid()` van de ingelogde gebruiker
 */
export async function logToolUsage(toolId, userId) {
  if (!toolId || !userId) return

  const { error } = await supabase.from('tool_usage').insert({ tool_id: toolId, user_id: userId })

  if (error) {
    console.error('[toolUsage] Kon gebruik niet loggen:', error.message)
  }
}

/**
 * Haalt alle tool-usage rijen op (RLS beperkt dit tot admins, zie policy
 * "admin leest tool-gebruik") en telt ze per tool_id. Groepering gebeurt
 * client-side — bij dit schaalniveau (intern team) is dat prima; bij veel
 * groei kan dit vervangen worden door een Postgres-view met group by.
 *
 * @returns {Promise<Array<{ toolId: string, count: number, laatstGebruikt: string|null }>>}
 */
export async function fetchToolUsageCounts() {
  const { data, error } = await supabase.from('tool_usage').select('tool_id, used_at')

  if (error) {
    throw new Error(error.message)
  }

  const perTool = new Map()

  for (const row of data) {
    const bestaand = perTool.get(row.tool_id)
    if (!bestaand) {
      perTool.set(row.tool_id, { toolId: row.tool_id, count: 1, laatstGebruikt: row.used_at })
    } else {
      bestaand.count += 1
      if (row.used_at > bestaand.laatstGebruikt) {
        bestaand.laatstGebruikt = row.used_at
      }
    }
  }

  return Array.from(perTool.values()).sort((a, b) => b.count - a.count)
}

/**
 * Zelfde ruwe data als fetchToolUsageCounts(), maar gegroepeerd per
 * user_id i.p.v. per tool_id — gebruikt in het Adminpaneel om te tonen
 * hoe actief elke gebruiker is (los van, en aanvullend op, laatste
 * inlogtijd: iemand kan wél inloggen maar geen enkele tool openen).
 *
 * @returns {Promise<Map<string, { count: number, laatstActief: string }>>} user id -> gebruik
 */
export async function fetchToolUsageByUser() {
  const { data, error } = await supabase.from('tool_usage').select('user_id, used_at')

  if (error) {
    throw new Error(error.message)
  }

  const perUser = new Map()

  for (const row of data) {
    if (!row.user_id) continue // rij van een inmiddels verwijderde gebruiker (on delete set null)

    const bestaand = perUser.get(row.user_id)
    if (!bestaand) {
      perUser.set(row.user_id, { count: 1, laatstActief: row.used_at })
    } else {
      bestaand.count += 1
      if (row.used_at > bestaand.laatstActief) {
        bestaand.laatstActief = row.used_at
      }
    }
  }

  return perUser
}

/**
 * Haalt het eigen tool-gebruik van de ingelogde gebruiker op (RLS-policy
 * "gebruiker leest eigen tool-gebruik"), gegroepeerd per tool_id, gesorteerd
 * op totaal-aantal — gebruikt voor de "Voor jou · meest gebruikt"-sectie op
 * het dashboard.
 *
 * @param {string} userId
 * @returns {Promise<Array<{ toolId: string, count: number, vandaagCount: number, laatstGebruikt: string }>>}
 */
export async function fetchMyToolUsageSummary(userId) {
  if (!userId) return []

  const { data, error } = await supabase.from('tool_usage').select('tool_id, used_at').eq('user_id', userId)

  if (error) {
    console.error('[toolUsage] Kon eigen gebruik niet ophalen:', error.message)
    return []
  }

  const vandaag = new Date().toDateString()
  const perTool = new Map()

  for (const row of data) {
    const isVandaag = new Date(row.used_at).toDateString() === vandaag
    const bestaand = perTool.get(row.tool_id)

    if (!bestaand) {
      perTool.set(row.tool_id, {
        toolId: row.tool_id,
        count: 1,
        vandaagCount: isVandaag ? 1 : 0,
        laatstGebruikt: row.used_at,
      })
    } else {
      bestaand.count += 1
      if (isVandaag) bestaand.vandaagCount += 1
      if (row.used_at > bestaand.laatstGebruikt) bestaand.laatstGebruikt = row.used_at
    }
  }

  return Array.from(perTool.values()).sort((a, b) => b.count - a.count)
}
