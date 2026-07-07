import { createClient } from '@supabase/supabase-js'

/**
 * Los Supabase-project (burg-jobs, ziwqshuabwcthqjspuso) — bevat de
 * recruitment-data (jobs/employees) van de oorspronkelijke BURG-Apps repo.
 * Dit is NIET hetzelfde project als het v2-rollen-systeem in
 * ./supabaseClient.js. Gebruikt uitsluitend de publishable/anon-key: er is
 * bewust geen aparte login-sessie op dit project (v2-gebruikers zijn al
 * ingelogd via het v2-project; identiteit binnen "Mijn Omgeving" wordt
 * bepaald door `profile.email` te matchen tegen `employees.email` /
 * `jobs.assigned_to`, niet door een tweede auth-sessie).
 */
const burgJobsUrl = import.meta.env.VITE_BURG_JOBS_URL
const burgJobsAnonKey = import.meta.env.VITE_BURG_JOBS_ANON_KEY

if (!burgJobsUrl || !burgJobsAnonKey) {
  console.warn(
    '[burgJobsClient] VITE_BURG_JOBS_URL en/of VITE_BURG_JOBS_ANON_KEY ontbreken. ' +
      'Mijn Omgeving kan dan geen data ophalen.',
  )
}

export const burgJobsSupabase = createClient(burgJobsUrl, burgJobsAnonKey)
