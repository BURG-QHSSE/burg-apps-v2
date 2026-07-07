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
