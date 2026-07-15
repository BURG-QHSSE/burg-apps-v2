import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../lib/AuthProvider'
import {
  fetchYieldConsultantCount,
  fetchPlaatsingenDezeMaand,
  voegPlaatsingToe,
  verwijderPlaatsing,
} from '../lib/yieldApi'

// H2 2026-target: gemiddeld 0,8 plaatsingen per consultant per maand.
// Einddoel op termijn: yield 1,0 (bv. 12 consultants op 12 plaatsingen).
// Hoog YIELD_TARGET op bij een nieuw target.
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
 * Motiverende (cursieve) boodschap onder de thermometer: 1 openingsbericht
 * bij 0 plaatsingen deze maand, daarna 5 oplopende niveaus (25% van target
 * per stap) tot en met het behalen/overtreffen van de target — een
 * bouw-metafoor, passend bij BURG.
 */
function bepaalNiveau(aantalPlaatsingen, vulPercentage) {
  if (aantalPlaatsingen === 0) {
    return { toon: 'brand', boodschap: 'Er staat nog niets — jij kan de eerste zijn richting grootse stappen.' }
  }
  if (vulPercentage <= 25) {
    return { toon: 'brand', boodschap: 'De eerste steen ligt. Zo begint een fundament voor grootse stappen.' }
  }
  if (vulPercentage <= 50) {
    return { toon: 'brand', boodschap: 'De muren komen omhoog — je bouwt gestaag door.' }
  }
  if (vulPercentage <= 75) {
    return { toon: 'amber', boodschap: 'Halverwege en in opmars — de toren krijgt vorm.' }
  }
  if (vulPercentage < 100) {
    return { toon: 'amber', boodschap: 'Bijna bij de top — nog een laatste zet naar het doel.' }
  }
  return { toon: 'mos', boodschap: 'De vlag gaat in top — yield-target gehaald, knap werk!' }
}

/**
 * Dashboard-widget: yield = aantal plaatsingen deze kalendermaand gedeeld
 * door aantal consultants (profiles.yield_telt_mee, aan te vinken in het
 * Adminpaneel) — dus hoger is beter. Gevisualiseerd als thermometer i.p.v.
 * een kaal getal — de vulling volgt hoe dicht (of hoever voorbij)
 * YIELD_TARGET de huidige waarde zit; leger = verder van target, vol =
 * target gehaald of beter. Loggen/verwijderen van plaatsingen is alleen
 * mogelijk voor hr/admin (afgedwongen via RLS, zie supabase/schema.sql) —
 * de thermometer zelf is voor iedereen zichtbaar.
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
  const yieldWaarde = aantalPlaatsingen / consultants
  const vulPercentage = Math.max(0, Math.min(100, (yieldWaarde / YIELD_TARGET) * 100))
  const { toon, boodschap } = bepaalNiveau(aantalPlaatsingen, vulPercentage)

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
          <span className="metric-card-label">plaatsingen per consultant</span>
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
