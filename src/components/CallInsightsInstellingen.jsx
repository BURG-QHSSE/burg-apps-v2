import { useEffect, useState } from 'react'
import { fetchCallInsightsLive, setCallInsightsLive } from '../lib/callInsightsApi'

/**
 * AdminPanel-sectie voor Call Insights: de live-schakelaar. Staat de tool al
 * open voor consultants zelf (ieder ziet dan zijn/haar eigen gesprekken,
 * bepaald via profiles.team = 'consultant'), of nog beperkt tot admin-only?
 * Default UIT.
 *
 * Vervangt CallInsightsUitsluitingen.jsx (2026-09-16) — de extensie-
 * uitsluitingslijst en de "actieve consultant (MVP)"-selector zijn
 * verwijderd nu profiles.team de matching bepaalt (zie
 * call_insights_nieuwe_recordings in schema.sql); wie welke consultant wil
 * bekijken kiest een admin nu rechtstreeks in CallInsights.jsx zelf.
 */
export default function CallInsightsInstellingen() {
  const [live, setLive] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [bezigMetLive, setBezigMetLive] = useState(false)

  useEffect(() => {
    let isMounted = true
    fetchCallInsightsLive()
      .then((liveWaarde) => {
        if (isMounted) setLive(liveWaarde)
      })
      .catch((err) => {
        if (isMounted) setError(err.message)
      })
      .finally(() => {
        if (isMounted) setLoading(false)
      })
    return () => {
      isMounted = false
    }
  }, [])

  async function wijzigLive(nieuweWaarde) {
    setBezigMetLive(true)
    setError(null)
    try {
      await setCallInsightsLive(nieuweWaarde)
      setLive(nieuweWaarde)
    } catch (err) {
      setError(err.message)
    } finally {
      setBezigMetLive(false)
    }
  }

  return (
    <>
      <h2 style={{ marginTop: 'var(--space-8)' }}>Call Insights — live voor consultants</h2>
      <p className="page-intro">
        Staat dit uit, dan is Call Insights alleen voor admins zichtbaar/bruikbaar (ongeacht team-indeling bij "Alle
        gebruikers" hierboven). Staat dit aan, dan ziet iedere gebruiker met team "Consultant" daar zijn/haar eigen
        gesprekken.
      </p>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {!loading && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <input type="checkbox" checked={live} disabled={bezigMetLive} onChange={(e) => wijzigLive(e.target.checked)} />
          Live voor consultants (team = Consultant)
        </label>
      )}
    </>
  )
}
