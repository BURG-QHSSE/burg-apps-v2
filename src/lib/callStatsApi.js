import { supabase } from './supabaseClient'

/**
 * Databron voor het "Bel Overzicht"-blok: 3CX CDR-data die via een aparte
 * cron job (elke nacht 00:20, voor de vorige dag) wordt weggeschreven naar
 * `call_daily_stats`. `call_weekly_stats` en `call_quarterly_stats` zijn
 * views die daar automatisch op optellen — geen aparte opslag, geen aparte
 * schrijf-policy nodig.
 *
 * RLS op deze drie is bewust `authenticated -> true`: iedereen mag elkaars
 * belcijfers zien, geen rol-restrictie. Zie supabase/schema.sql.
 */

const TABLE_BY_PERIOD = {
  dag: { table: 'call_daily_stats', column: 'call_date' },
  week: { table: 'call_weekly_stats', column: 'week_start' },
  kwartaal: { table: 'call_quarterly_stats', column: 'quarter_start' },
}

/**
 * Haalt de belcijfers op voor één periode (dag/week/kwartaal), voor alle
 * medewerkers tegelijk.
 *
 * @param {'dag'|'week'|'kwartaal'} period
 * @param {string} periodValue - ISO-datum (YYYY-MM-DD) die de periode
 *   identificeert: de dag zelf, of de `week_start`/`quarter_start` waar de
 *   view op groepeert.
 * @returns {Promise<Array<{ user_id: string, calls_in: number, calls_out: number, minutes_in: number, minutes_out: number }>>}
 */
export async function fetchCallStatsForPeriod(period, periodValue) {
  const { table, column } = TABLE_BY_PERIOD[period]

  const { data, error } = await supabase
    .from(table)
    .select('user_id, calls_in, calls_out, minutes_in, minutes_out')
    .eq(column, periodValue)

  if (error) {
    throw new Error(error.message)
  }

  return data
}

/**
 * Tijdstip waarop de belcijfers voor het laatst zijn bijgewerkt — de cron
 * ververst `call_daily_stats` elke 15 minuten vanuit 3CX, dit is dus geen
 * live/real-time data. Simpelweg de meest recente `updated_at` over de hele
 * tabel (ongeacht welke periode er bekeken wordt) is voldoende en robuuster
 * dan filteren op de actieve periode: ook als de huidige dag/week/kwartaal
 * toevallig nog geen rijen heeft, geeft dit nog steeds een zinnig antwoord.
 *
 * @returns {Promise<string|null>} ISO-timestamp, of null als de tabel leeg is.
 */
export async function fetchCallStatsLastUpdated() {
  const { data, error } = await supabase
    .from('call_daily_stats')
    .select('updated_at')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return data?.updated_at ?? null
}

/**
 * De medewerkers-roster voor het Bel Overzicht: iedereen met een gekoppeld
 * 3CX-toestel (`cx_extension_mapping`), met naam. RLS op beide bronnen staat
 * dit toe voor elke ingelogde gebruiker:
 * - `cx_extension_mapping`: policy "authenticated read extension mapping".
 * - namen: RLS op `profiles` laat een gewone 'user' alleen de eigen rij
 *   lezen, dus namen komen via de `call_stats_profiel_namen()` RPC-functie
 *   (SECURITY DEFINER, geeft bewust alleen id+naam terug — zie
 *   supabase/schema.sql).
 *
 * @returns {Promise<Array<{ userId: string, naam: string }>>} gesorteerd op naam
 */
export async function fetchCallStatsRoster() {
  const [mappingResult, namenResult] = await Promise.all([
    supabase.from('cx_extension_mapping').select('user_id'),
    supabase.rpc('call_stats_profiel_namen'),
  ])

  if (mappingResult.error) {
    throw new Error(mappingResult.error.message)
  }
  if (namenResult.error) {
    throw new Error(namenResult.error.message)
  }

  const naamPerId = new Map(namenResult.data.map((rij) => [rij.id, rij.naam]))
  const uniekeUserIds = [...new Set(mappingResult.data.map((rij) => rij.user_id))]

  const roster = uniekeUserIds.map((userId) => ({
    userId,
    naam: naamPerId.get(userId) || `Onbekend (${userId.slice(0, 8)})`,
  }))

  roster.sort((a, b) => a.naam.localeCompare(b.naam, 'nl'))

  return roster
}
