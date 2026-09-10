import { useEffect, useState } from 'react'
import {
  fetchExtensieRoster,
  fetchUitgeslotenExtensies,
  sluitExtensieUit,
  heractiveerExtensie,
  fetchActieveConsultant,
  setActieveConsultant,
} from '../lib/callInsightsApi'

/**
 * AdminPanel-secties voor Call Insights (MVP):
 * 1. Welke ENE consultant momenteel actief is — verwerking + weergave
 *    blijven daartoe beperkt (zie schema.sql-comment bij
 *    call_insights_mvp_actieve_consultant). Tijdelijk, tot bredere uitrol.
 * 2. Welke 3CX-extensies (sales/andere afdeling) uitgesloten zijn van
 *    matching. Uitsluitingslijst, bewust niet een toelatingslijst (zie
 *    schema.sql-comment bij call_insights_uitgesloten_extensies) — een
 *    nieuwe consultant-collega wordt hier dus automatisch meegenomen, tenzij
 *    een admin 'm hier uitvinkt.
 */
export default function CallInsightsUitsluitingen() {
  const [roster, setRoster] = useState([])
  const [uitgesloten, setUitgesloten] = useState(new Map())
  const [actieveConsultant, setActieveConsultantState] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [bezig, setBezig] = useState(new Set())
  const [bezigMetConsultant, setBezigMetConsultant] = useState(false)

  useEffect(() => {
    let isMounted = true
    async function laad() {
      setLoading(true)
      setError(null)
      try {
        const [rosterData, uitgeslotenData, actieveId] = await Promise.all([
          fetchExtensieRoster(),
          fetchUitgeslotenExtensies(),
          fetchActieveConsultant(),
        ])
        if (!isMounted) return
        setRoster(rosterData)
        setUitgesloten(new Map(uitgeslotenData.map((r) => [r.extension, r.reden])))
        setActieveConsultantState(actieveId)
      } catch (err) {
        if (isMounted) setError(err.message)
      } finally {
        if (isMounted) setLoading(false)
      }
    }
    laad()
    return () => {
      isMounted = false
    }
  }, [])

  async function wijzigActieveConsultant(userId) {
    setBezigMetConsultant(true)
    setError(null)
    try {
      await setActieveConsultant(userId || null)
      setActieveConsultantState(userId || null)
    } catch (err) {
      setError(err.message)
    } finally {
      setBezigMetConsultant(false)
    }
  }

  async function toggle(extension, huidigUitgesloten) {
    setBezig((prev) => new Set(prev).add(extension))
    setError(null)
    try {
      if (huidigUitgesloten) {
        await heractiveerExtensie(extension)
        setUitgesloten((prev) => {
          const next = new Map(prev)
          next.delete(extension)
          return next
        })
      } else {
        const reden = window.prompt('Reden voor uitsluiting (optioneel):', '') ?? ''
        await sluitExtensieUit(extension, reden)
        setUitgesloten((prev) => new Map(prev).set(extension, reden || null))
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setBezig((prev) => {
        const next = new Set(prev)
        next.delete(extension)
        return next
      })
    }
  }

  const nietUitgeslotenRoster = roster.filter((r) => !uitgesloten.has(r.extension))

  return (
    <>
      <h2 style={{ marginTop: 'var(--space-8)' }}>Call Insights — actieve consultant (MVP)</h2>
      <p className="page-intro">
        Call Insights verwerkt en toont voorlopig bewust maar één consultant tegelijk. Kies hieronder wie — niemand geselecteerd
        betekent dat er niets verwerkt wordt.
      </p>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {!loading && (
        <div className="field" style={{ maxWidth: 320, marginBottom: 'var(--space-6)' }}>
          <select
            className="field-select"
            value={actieveConsultant ?? ''}
            disabled={bezigMetConsultant}
            onChange={(e) => wijzigActieveConsultant(e.target.value)}
          >
            <option value="">— Niemand —</option>
            {nietUitgeslotenRoster.map((r) => (
              <option key={r.userId} value={r.userId}>
                {r.naam} ({r.extension})
              </option>
            ))}
          </select>
        </div>
      )}

      <h2 style={{ marginTop: 'var(--space-8)' }}>Call Insights — uitgesloten extensies</h2>
      <p className="page-intro">
        Wie hier aangevinkt staat, telt niet mee voor Call Insights (bv. sales/andere afdeling). Niet aangevinkt = automatisch
        meegenomen — ook nieuwe collega's, zonder dat je ze hier hoeft toe te voegen.
      </p>

      {loading && <p>Laden…</p>}

      {!loading && (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Extensie</th>
                <th>Naam</th>
                <th>Uitgesloten</th>
              </tr>
            </thead>
            <tbody>
              {roster.map((r) => {
                const isUitgesloten = uitgesloten.has(r.extension)
                return (
                  <tr key={r.extension}>
                    <td data-label="Extensie">{r.extension}</td>
                    <td data-label="Naam">{r.naam}</td>
                    <td data-label="Uitgesloten">
                      <input
                        type="checkbox"
                        checked={isUitgesloten}
                        disabled={bezig.has(r.extension)}
                        onChange={() => toggle(r.extension, isUitgesloten)}
                        title={isUitgesloten ? uitgesloten.get(r.extension) || '' : ''}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
