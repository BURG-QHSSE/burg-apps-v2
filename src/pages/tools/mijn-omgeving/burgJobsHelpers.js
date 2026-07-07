import { burgJobsSupabase } from '../../../lib/burgJobsClient'
import { GO_WEBHOOK_URL } from './constants'

/**
 * Senioriteitsbepaling — in de bron een expliciete stub die altijd 'medior'
 * teruggeeft (LLM-classificatie is nog niet gekoppeld, zie project-CLAUDE.md
 * "Wat nog moet gebeuren"). Bewust ongewijzigd overgenomen: niet "verbeteren".
 */
export function determineSeniority(_description) {
  return 'medior'
}

async function distributeJobIds(jobIds, present) {
  if (!jobIds || jobIds.length === 0 || present.length === 0) return

  const groups = {}
  present.forEach((e) => {
    groups[e.email] = []
  })
  jobIds.forEach((id, i) => groups[present[i % present.length].email].push(id))

  await Promise.all(
    present.map((emp) =>
      groups[emp.email].length
        ? burgJobsSupabase.from('jobs').update({ assigned_to: emp.email }).in('id', groups[emp.email])
        : Promise.resolve(),
    ),
  )
}

/**
 * Verdeelt bij het laden van het scherm alle NOG NIET toegewezen pending
 * vacatures round-robin over de medewerkers die mogen swipen (`swipers`:
 * medewerkers met `mijn_omgeving_uitgebreid`, zie MijnOmgeving.jsx).
 *
 * Bewust NIET gefilterd op aanwezigheid: die vlag bepaalt sinds de
 * ontkoppeling van swipen/aanwezigheid alleen nog waar GOEDGEKEURDE
 * vacatures heen gaan (zie assignGoVacature hieronder), niet wie de
 * swipe-wachtrij krijgt — anders verdwijnen iemands eigen te-swipen
 * vacatures zodra die persoon zichzelf op afwezig zet.
 */
export async function distributeUnassignedJobs(swipers) {
  if (!swipers || swipers.length === 0) return

  const { data: unassigned } = await burgJobsSupabase
    .from('jobs')
    .select('id')
    .eq('review_status', 'pending')
    .is('assigned_to', null)

  await distributeJobIds((unassigned || []).map((j) => j.id), swipers)
}

/**
 * Go-toewijzing — exact overgenomen uit `assignGoVacature` (bron regel 1042):
 * senioriteit bepalen (stub), dan onder aanwezige medewerkers wiens
 * `seniority_levels` die senioriteit bevat (fallback: alle aanwezigen) diegene
 * kiezen met de laagste load-per-fte (aantal huidige 'go'-vacatures gedeeld
 * door fte_hours). Schrijft alle velden in één update, en vuurt daarna
 * (fire-and-forget, nooit blokkerend) de Apollo-enrichment webhook af.
 */
export async function assignGoVacature(jobId, description, employees, currentUserEmail) {
  const seniority = determineSeniority(description)
  const now = new Date().toISOString()

  const present = employees.filter((e) => e.is_present)
  let chosenEmail = currentUserEmail

  if (present.length > 0) {
    const { data: goJobs } = await burgJobsSupabase
      .from('jobs')
      .select('assigned_to')
      .eq('review_status', 'go')
      .in(
        'assigned_to',
        present.map((e) => e.email),
      )

    const goCounts = {}
    present.forEach((e) => {
      goCounts[e.email] = 0
    })
    ;(goJobs || []).forEach((j) => {
      if (j.assigned_to in goCounts) goCounts[j.assigned_to] += 1
    })

    const weighted = (emp) => goCounts[emp.email] / emp.fte_hours
    let candidates = present.filter((e) => e.seniority_levels && e.seniority_levels.includes(seniority))
    if (candidates.length === 0) candidates = present
    chosenEmail = candidates.reduce((best, emp) => (weighted(emp) < weighted(best) ? emp : best)).email
  }

  const { error } = await burgJobsSupabase
    .from('jobs')
    .update({
      review_status: 'go',
      assigned_to: chosenEmail,
      seniority_level: seniority,
      seniority_reviewed_at: now,
      reviewed_at: now,
    })
    .eq('id', jobId)

  if (error) {
    console.error('[MijnOmgeving] assignGoVacature: opslaan mislukt:', error)
    return { error }
  }

  try {
    await fetch(GO_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_id: jobId }),
    })
  } catch (e) {
    // Exact zoals de bron: een mislukte webhook mag de UI nooit blokkeren.
    console.warn('[MijnOmgeving] Webhook mislukt:', e)
  }

  return { error: null }
}
