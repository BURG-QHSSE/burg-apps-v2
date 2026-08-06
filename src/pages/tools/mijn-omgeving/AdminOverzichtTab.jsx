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

// Meest recente maandag 00:00 lokale tijd — begin van de huidige werkweek.
// getDay(): 0 = zondag ... 6 = zaterdag.
function startVanDezeWeek() {
  const nu = new Date()
  const dag = nu.getDay()
  const dagenTerug = dag === 0 ? 6 : dag - 1
  const maandag = new Date(nu)
  maandag.setDate(nu.getDate() - dagenTerug)
  maandag.setHours(0, 0, 0, 0)
  return maandag
}

/**
 * Admin-only overzicht: per medewerker een uitsplitsing van hun
 * goedgekeurde ("go") vacatures naar status. "Nieuwe vacatures" is een
 * doorlopende achterstand (nog geen actie) en telt altijd mee, ongeacht
 * wanneer. De overige kolommen (Toegevoegd aan Bullhorn/Al bekend/Overig/
 * Totaal) tellen bewust alleen wat DEZE WEEK is afgehandeld — sinds
 * afgelopen maandag 00:00 — zodat ze elke week weer op 0 beginnen i.p.v.
 * een eeuwig oplopende teller te zijn. Dat vereist een tijdstempel van
 * wanneer sales_status gezet is (sales_status_at, zie MijnVacaturesTab.jsx
 * updateStatus()); bestaande rijen van vóór die kolom bestond hebben die
 * niet en tellen dus terecht niet mee in "deze week".
 *
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

      // Supabase/PostgREST geeft standaard maximaal 1000 rijen per query
      // terug, ook zonder expliciete .limit(). Bij >1000 go-vacatures (dit
      // project zit daar inmiddels overheen) werden de laatste rijen dus
      // stilzwijgend niet meegeteld. Hier in pagina's van 1000 ophalen tot
      // een pagina leeg/korter dan de paginagrootte is.
      const PAGE_SIZE = 1000
      const data = []
      let loadError = null

      for (let from = 0; ; from += PAGE_SIZE) {
        const { data: page, error: pageError } = await burgJobsSupabase
          .from('jobs')
          .select('assigned_to, sales_status, sales_status_at')
          .eq('review_status', 'go')
          .range(from, from + PAGE_SIZE - 1)

        if (pageError) {
          loadError = pageError
          break
        }

        data.push(...(page || []))
        if (!page || page.length < PAGE_SIZE) break
      }

      if (cancelled) return

      if (loadError) {
        setError(loadError.message)
        setLoading(false)
        return
      }

      const dezeWeekStart = startVanDezeWeek()

      const tally = new Map()
      let overigGezien = false
      data.forEach((j) => {
        if (!j.assigned_to) return
        if (GESLOTEN_STATUSSEN.includes(j.sales_status)) return

        const bucket = bucketVoor(j.sales_status)

        // "Nieuwe vacatures" is een doorlopende achterstand, geen
        // weekteller — die telt altijd mee. De andere kolommen alleen als
        // de status deze week is gezet.
        if (bucket !== NIEUW_BUCKET) {
          const gezetOp = j.sales_status_at ? new Date(j.sales_status_at) : null
          if (!gezetOp || gezetOp < dezeWeekStart) return
        }

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
      // Totaal = alleen de kolommen die deze week resetten, bewust exclusief
      // "Nieuwe vacatures" (die is en blijft een doorlopende achterstand).
      const totaalDezeWeek = overig + perStatus.reduce((a, b) => a + b, 0)
      return { ...emp, nieuw, overig, perStatus, totaalDezeWeek }
    })
    .sort((a, b) => b.nieuw - a.nieuw || a.name.localeCompare(b.name, 'nl'))

  const bezig = loading || employeesLoading
  const fout = error || employeesError

  return (
    <div className={visible ? 'mo-tab-panel' : 'mo-tab-panel mo-tab-panel-hidden'}>
      <p className="calc-section-label">Go-vacatures per medewerker, per status</p>
      <p className="tool-card-hint">
        "Nieuwe vacatures" is een doorlopende achterstand. De overige kolommen tellen alleen wat deze week is
        afgehandeld en beginnen elke maandag weer op 0.
      </p>

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
                  <th key={status}>{status} (deze week)</th>
                ))}
                {heeftOverig && <th>Overig (deze week)</th>}
                <th>Totaal deze week</th>
              </tr>
            </thead>
            <tbody>
              {rijen.map((r) => (
                <tr key={r.id}>
                  <td data-label="Medewerker">{r.name}</td>
                  <td data-label="Nieuwe vacatures">{r.nieuw}</td>
                  {SALES_STATUSES.map((status, i) => (
                    <td data-label={`${status} (deze week)`} key={status}>
                      {r.perStatus[i]}
                    </td>
                  ))}
                  {heeftOverig && <td data-label="Overig (deze week)">{r.overig}</td>}
                  <td data-label="Totaal deze week">{r.totaalDezeWeek}</td>
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
