import { useEffect, useState } from 'react'
import { burgJobsSupabase } from '../../../lib/burgJobsClient'
import { GESLOTEN_STATUSSEN, SALES_STATUSES } from './constants'

const NIEUW_BUCKET = 'nieuw'
const OVERIG_BUCKET = 'overig'

// Bepaalt in welke kolom een go-vacature valt: geen sales_status is
// "nieuw" (net als NIEUW_FILTER in MijnVacaturesTab), een herkende
// SALES_STATUSES-waarde krijgt zijn eigen kolom, en al het overige
// (bv. de legacy 'Gemaild') valt in "Overig" i.p.v. stilzwijgend te
// verdwijnen uit de telling.
function bucketVoor(salesStatus) {
  if (!salesStatus) return NIEUW_BUCKET
  return SALES_STATUSES.includes(salesStatus) ? salesStatus : OVERIG_BUCKET
}

/**
 * Admin-only overzicht: per medewerker een uitsplitsing van hun
 * goedgekeurde ("go") vacatures naar status — vooral bedoeld om in één
 * oogopslag te zien wie nog "Nieuwe vacatures" (nog geen actie) heeft
 * openstaan, in plaats van dat één opgeteld totaal die piek verbergt.
 * Los van de swipe-wachtrij (die is gedeeld, zie MijnOmgeving.jsx). Telt
 * GESLOTEN_STATUSSEN (bv. 'Closed loss') nergens mee — dat zijn afgeronde
 * zaken, geen openstaande workload.
 */
export default function AdminOverzichtTab({ visible, employees, employeesLoading, employeesError }) {
  const [perEmail, setPerEmail] = useState(new Map())
  const [heeftOverig, setHeeftOverig] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError('')

      const { data, error: loadError } = await burgJobsSupabase
        .from('jobs')
        .select('assigned_to, sales_status')
        .eq('review_status', 'go')

      if (cancelled) return

      if (loadError) {
        setError(loadError.message)
        setLoading(false)
        return
      }

      const tally = new Map()
      let overigGezien = false
      ;(data || []).forEach((j) => {
        if (!j.assigned_to) return
        if (GESLOTEN_STATUSSEN.includes(j.sales_status)) return

        const bucket = bucketVoor(j.sales_status)
        if (bucket === OVERIG_BUCKET) overigGezien = true

        if (!tally.has(j.assigned_to)) tally.set(j.assigned_to, {})
        const rec = tally.get(j.assigned_to)
        rec[bucket] = (rec[bucket] || 0) + 1
      })
      setPerEmail(tally)
      setHeeftOverig(overigGezien)
      setLoading(false)
    }

    load()

    return () => {
      cancelled = true
    }
  }, [])

  const rijen = employees
    .map((emp) => {
      const rec = perEmail.get(emp.email) || {}
      const nieuw = rec[NIEUW_BUCKET] || 0
      const overig = rec[OVERIG_BUCKET] || 0
      const perStatus = SALES_STATUSES.map((status) => rec[status] || 0)
      const totaal = nieuw + overig + perStatus.reduce((a, b) => a + b, 0)
      return { ...emp, nieuw, overig, perStatus, totaal }
    })
    .sort((a, b) => b.nieuw - a.nieuw || a.name.localeCompare(b.name, 'nl'))

  const bezig = loading || employeesLoading
  const fout = error || employeesError

  return (
    <div className={visible ? 'mo-tab-panel' : 'mo-tab-panel mo-tab-panel-hidden'}>
      <p className="calc-section-label">Go-vacatures per medewerker, per status</p>

      {bezig && <div className="idle-state">Laden…</div>}

      {!bezig && fout && (
        <p className="form-error" role="alert">
          Kon overzicht niet laden: {fout}
        </p>
      )}

      {!bezig && !fout && (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Medewerker</th>
                <th>Nieuwe vacatures</th>
                {SALES_STATUSES.map((status) => (
                  <th key={status}>{status}</th>
                ))}
                {heeftOverig && <th>Overig</th>}
                <th>Totaal</th>
              </tr>
            </thead>
            <tbody>
              {rijen.map((r) => (
                <tr key={r.id}>
                  <td data-label="Medewerker">{r.name}</td>
                  <td data-label="Nieuwe vacatures">{r.nieuw}</td>
                  {SALES_STATUSES.map((status, i) => (
                    <td data-label={status} key={status}>
                      {r.perStatus[i]}
                    </td>
                  ))}
                  {heeftOverig && <td data-label="Overig">{r.overig}</td>}
                  <td data-label="Totaal">{r.totaal}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rijen.length === 0 && <div className="idle-state">Geen medewerkers gevonden.</div>}
        </div>
      )}
    </div>
  )
}
