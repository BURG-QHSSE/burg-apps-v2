import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../lib/AuthProvider'
import {
  fetchYieldConsultantCount,
  fetchPlaatsingenDezeMaand,
  voegPlaatsingToe,
  verwijderPlaatsing,
} from '../lib/yieldApi'

// H2 2026-target: gemiddeld 0,8 consultants per plaatsing (dus meer dan 1
// plaatsing per consultant per maand). Hoog dit op bij een nieuw target.
const YIELD_TARGET = 0.8

function maandLabel() {
  const tekst = new Date().toLocaleDateString('nl-NL', { month: 'long' })
  return tekst.charAt(0).toUpperCase() + tekst.slice(1)
}

function fmtYield(n) {
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/**
 * Dashboard-widget: yield = aantal consultants (profiles.yield_telt_mee,
 * aan te vinken in het Adminpaneel) gedeeld door aantal plaatsingen deze
 * kalendermaand. Gevisualiseerd als thermometer i.p.v. een kaal getal — de
 * vulling volgt hoe dicht (of hoever voorbij) YIELD_TARGET de huidige
 * waarde zit; leger = verder van target, vol = target gehaald of beter.
 * Loggen/verwijderen van plaatsingen is alleen mogelijk voor hr/admin
 * (afgedwongen via RLS, zie supabase/schema.sql) — de thermometer zelf is
 * voor iedereen zichtbaar.
 */
export default function YieldThermometer() {
  const { profile } = useAuth()
  const magBewerken = profile?.role === 'hr' || profile?.role === 'admin'

  const [consultants, setConsultants] = useState(null)
  const [plaatsingen, setPlaatsingen] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [bezig, setBezig] = useState(false)

  const load = useCallback(async () => {
    setError('')
    try {
      const [count, lijst] = await Promise.all([fetchYieldConsultantCount(), fetchPlaatsingenDezeMaand()])
      setConsultants(count)
      setPlaatsingen(lijst)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function handleToevoegen() {
    setBezig(true)
    try {
      await voegPlaatsingToe()
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBezig(false)
    }
  }

  async function handleVerwijderen(id) {
    setBezig(true)
    try {
      await verwijderPlaatsing(id)
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBezig(false)
    }
  }

  if (loading) {
    return (
      <section className="yield-widget section-card">
        <div className="idle-state">Yield laden…</div>
      </section>
    )
  }

  if (!consultants) {
    return (
      <section className="yield-widget section-card">
        <p className="calc-section-label">Yield · {maandLabel()}</p>
        <div className="idle-state">
          Nog geen consultants aangevinkt voor de yield-berekening — zet dit aan in het Adminpaneel bij "Telt mee
          voor yield".
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </section>
    )
  }

  const aantalPlaatsingen = plaatsingen.length
  const yieldWaarde = aantalPlaatsingen === 0 ? Infinity : consultants / aantalPlaatsingen
  const vulPercentage = Math.max(0, Math.min(100, (YIELD_TARGET / yieldWaarde) * 100 || 0))

  let toon = 'brand'
  let boodschap = 'Nog een weg te gaan deze maand.'
  if (vulPercentage >= 100) {
    toon = 'mos'
    boodschap = 'Yield-target voor deze maand gehaald — knap werk!'
  } else if (vulPercentage >= 70) {
    toon = 'amber'
    boodschap = 'Bijna bij het doel — nog even doorpakken.'
  }

  return (
    <section className="yield-widget section-card">
      <div className="yield-widget-header">
        <p className="calc-section-label">Yield · {maandLabel()}</p>
        <span className="tool-card-hint">Target H2 2026: {fmtYield(YIELD_TARGET)}</span>
      </div>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <div className="yield-body">
        <div className="thermo">
          <div className="thermo-tube">
            <div className={`thermo-fill thermo-fill-${toon}`} style={{ height: `${vulPercentage}%` }} />
          </div>
          <div className={`thermo-bulb thermo-bulb-${toon}`} />
        </div>

        <div className="yield-stats">
          <span className="metric-card-value">{fmtYield(yieldWaarde)}</span>
          <span className="metric-card-label">consultants per plaatsing</span>
          <p className="tool-card-hint">
            {consultants} consultants · {aantalPlaatsingen} plaatsing{aantalPlaatsingen === 1 ? '' : 'en'} deze maand
          </p>
          <p className="yield-boodschap">{boodschap}</p>
        </div>
      </div>

      {magBewerken && (
        <div className="yield-actions">
          <button type="button" className="btn btn-primary" onClick={handleToevoegen} disabled={bezig}>
            {bezig ? 'Bezig…' : '+ Plaatsing toevoegen (vandaag)'}
          </button>

          {plaatsingen.length > 0 && (
            <div className="yield-log">
              {plaatsingen.map((p) => (
                <span className="yield-log-item" key={p.id}>
                  {new Date(p.geplaatst_op).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })}
                  <button
                    type="button"
                    className="yield-log-remove"
                    onClick={() => handleVerwijderen(p.id)}
                    disabled={bezig}
                    aria-label="Verwijder plaatsing"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
