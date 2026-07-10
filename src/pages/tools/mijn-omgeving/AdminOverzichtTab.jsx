import { useEffect, useState } from 'react'
import { burgJobsSupabase } from '../../../lib/burgJobsClient'

/**
 * Admin-only overzicht: hoeveel goedgekeurde ("go") vacatures staan er per
 * medewerker nog open — puur read-only, bedoeld om de workload-verdeling
 * tussen consultants in de gaten te houden. Los van de swipe-wachtrij (die
 * is sinds kort gedeeld, zie MijnOmgeving.jsx): dit telt alleen vacatures
 * die al zijn goedgekeurd én aan iemand zijn toegewezen (assignGoVacature).
 */
export default function AdminOverzichtTab({ visible, employees, employeesLoading, employeesError }) {
  const [counts, setCounts] = useState(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError('')

      const { data, error: loadError } = await burgJobsSupabase
        .from('jobs')
        .select('assigned_to')
        .eq('review_status', 'go')

      if (cancelled) return

      if (loadError) {
        setError(loadError.message)
        setLoading(false)
        return
      }

      const tally = new Map()
      ;(data || []).forEach((j) => {
        if (!j.assigned_to) return
        tally.set(j.assigned_to, (tally.get(j.assigned_to) || 0) + 1)
      })
      setCounts(tally)
      setLoading(false)
    }

    load()

    return () => {
      cancelled = true
    }
  }, [])

  const rijen = employees
    .map((emp) => ({ ...emp, aantal: counts.get(emp.email) || 0 }))
    .sort((a, b) => b.aantal - a.aantal || a.name.localeCompare(b.name, 'nl'))

  const bezig = loading || employeesLoading
  const fout = error || employeesError

  return (
    <div className={visible ? 'mo-tab-panel' : 'mo-tab-panel mo-tab-panel-hidden'}>
      <p className="calc-section-label">Open Go-vacatures per medewerker</p>

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
                <th>Open Go-vacatures</th>
              </tr>
            </thead>
            <tbody>
              {rijen.map((r) => (
                <tr key={r.id}>
                  <td data-label="Medewerker">{r.name}</td>
                  <td data-label="Open Go-vacatures">{r.aantal}</td>
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
