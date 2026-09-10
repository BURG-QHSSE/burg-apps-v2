import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  fetchPendingSuggesties,
  fetchAmbigueMatches,
  fetchKandidaatNamen,
  fetchActieveConsultant,
  fetchExtensieRoster,
  accepteerSuggestie,
  wijsSuggestieAf,
  resolveCandidateMatch,
} from '../../lib/callInsightsApi'

/**
 * Call Insights — automatisch door Claude gedetecteerde Bullhorn-
 * veldwijzigingen (salaris range, uurtarief range, woonplaats, voorkeur
 * dienstverband, status) uit 3CX-gesprekssamenvattingen.
 *
 * MVP: admin-only (zie toolRegistry.js) en bewust beperkt tot één actieve
 * consultant tegelijk, ingesteld in het AdminPanel (call_insights_mvp_
 * actieve_consultant) — dus niet per se de ingelogde admin zelf. Matching +
 * extractie gebeurt buiten deze UI om (call-insights Edge Function, actie
 * syncNewCalls, op een cron) — dit scherm toont alleen wat al klaarstaat en
 * verwerkt het besluit (accepteren schrijft direct naar Bullhorn, zie
 * supabase/functions/call-insights).
 *
 * Kandidaatnamen worden live opgehaald, nooit opgeslagen — zelfde AVG-
 * voorzichtigheid als Kandidaat Matcher.
 */

const VELD_LABELS = {
  customText22: 'Salaris range',
  customText11: 'Uurtarief range',
  address: 'Woonplaats',
  employmentPreference: 'Voorkeur dienstverband',
  status: 'Status',
}

const VELD_OPTIES = {
  customText22: [
    '< 2000 EUR', '2000 - 2500 EUR', '2500 - 3000 EUR', '3000 - 3500 EUR', '3500 - 4000 EUR',
    '4000 - 4500 EUR', '4500 - 5000 EUR', '5000 - 6000 EUR', '6000 - 7000 EUR', '7000 - 8000 EUR',
    '8000 - 9000 EUR', 'EUR 9000 >', 'Onbekend', 'Geen/betreft ZZP',
  ],
  customText11: ['Geen/betreft loondienst', '< 70', '70 - 80', '80 - 90', '90 - 100', '100 - 110', '110 - 120', '120 - 140', '140 of meer'],
  employmentPreference: ['Loondienst', 'Interim'],
  status: ['OTW', 'Placeable', 'Door ons geplaatst', 'Geen specialist', 'DNC', 'New Lead'],
}

function formatDatum(iso) {
  const d = new Date(iso)
  return d.toLocaleString('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export default function CallInsights() {
  const [actieveConsultant, setActieveConsultant] = useState(null)
  const [actieveConsultantNaam, setActieveConsultantNaam] = useState(null)
  const [suggesties, setSuggesties] = useState([])
  const [ambigueMatches, setAmbigueMatches] = useState([])
  const [namen, setNamen] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  // Per-call bewerkstatus: { [recording_url]: { [suggestionId]: { checked, waarde } } }
  const [bewerking, setBewerking] = useState({})
  const [bezigMetOpslaan, setBezigMetOpslaan] = useState(new Set())
  const [gekozenKandidaat, setGekozenKandidaat] = useState({})
  const [bezigMetKiezen, setBezigMetKiezen] = useState(new Set())

  async function laadGegevens() {
    setLoading(true)
    setError(null)
    try {
      const userId = await fetchActieveConsultant()
      setActieveConsultant(userId)
      if (!userId) {
        setSuggesties([])
        setAmbigueMatches([])
        return
      }

      const roster = await fetchExtensieRoster()
      setActieveConsultantNaam(roster.find((r) => r.userId === userId)?.naam ?? null)

      const [suggestiesData, ambigueData] = await Promise.all([fetchPendingSuggesties(userId), fetchAmbigueMatches(userId)])
      setSuggesties(suggestiesData)
      setAmbigueMatches(ambigueData)

      const kandidaatIds = [
        ...new Set([
          ...suggestiesData.map((s) => s.bullhorn_candidate_id),
          ...ambigueData.flatMap((m) => m.kandidaat_kandidaten ?? []),
        ]),
      ]
      const namenData = await fetchKandidaatNamen(kandidaatIds)
      setNamen(namenData)

      const initieleBewerking = {}
      for (const s of suggestiesData) {
        initieleBewerking[s.recording_url] ??= {}
        initieleBewerking[s.recording_url][s.id] = { checked: true, waarde: s.suggested_value }
      }
      setBewerking(initieleBewerking)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    laadGegevens()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function bevestigKandidaatKeuze(match) {
    const candidateId = gekozenKandidaat[match.recording_url]
    if (!candidateId) return
    setBezigMetKiezen((prev) => new Set(prev).add(match.recording_url))
    setError(null)
    try {
      await resolveCandidateMatch(match.recording_url, candidateId)
      // Er kunnen nieuwe suggesties bijgekomen zijn voor dit gesprek — herlaad alles.
      await laadGegevens()
    } catch (err) {
      setError(err.message)
    } finally {
      setBezigMetKiezen((prev) => {
        const next = new Set(prev)
        next.delete(match.recording_url)
        return next
      })
    }
  }

  const gesprekken = useMemo(() => {
    const perGesprek = new Map()
    for (const s of suggesties) {
      if (!perGesprek.has(s.recording_url)) {
        perGesprek.set(s.recording_url, {
          recordingUrl: s.recording_url,
          candidateId: s.bullhorn_candidate_id,
          callStartedAt: s.call_started_at,
          velden: [],
        })
      }
      perGesprek.get(s.recording_url).velden.push(s)
    }
    return [...perGesprek.values()].sort((a, b) => new Date(b.callStartedAt) - new Date(a.callStartedAt))
  }, [suggesties])

  function updateVeldState(recordingUrl, suggestionId, wijziging) {
    setBewerking((prev) => ({
      ...prev,
      [recordingUrl]: {
        ...prev[recordingUrl],
        [suggestionId]: { ...prev[recordingUrl][suggestionId], ...wijziging },
      },
    }))
  }

  async function bevestigGesprek(gesprek) {
    setBezigMetOpslaan((prev) => new Set(prev).add(gesprek.recordingUrl))
    try {
      await Promise.all(
        gesprek.velden.map((veld) => {
          const staat = bewerking[gesprek.recordingUrl]?.[veld.id]
          return staat?.checked ? accepteerSuggestie(veld.id, staat.waarde) : wijsSuggestieAf(veld.id)
        }),
      )
      setSuggesties((prev) => prev.filter((s) => s.recording_url !== gesprek.recordingUrl))
    } catch (err) {
      setError(err.message)
    } finally {
      setBezigMetOpslaan((prev) => {
        const next = new Set(prev)
        next.delete(gesprek.recordingUrl)
        return next
      })
    }
  }

  return (
    <div className="page">
      <header className="topbar">
        <div>
          <h1>Call Insights</h1>
        </div>
        <div className="topbar-actions">
          <Link to="/" className="btn btn-secondary">
            Terug naar dashboard
          </Link>
        </div>
      </header>

      <main className="page-content">
        <p className="page-intro">
          Automatisch gedetecteerde wijzigingen uit gesprekken — Claude leest de 3CX-gesprekssamenvatting en vergelijkt die met wat er nu
          in Bullhorn staat. Vink aan welke velden bijgewerkt moeten worden, corrigeer de waarde indien nodig, en klik op Bevestigen.
          {actieveConsultantNaam && (
            <>
              {' '}
              Toont nu: <strong>{actieveConsultantNaam}</strong> (in te stellen via AdminPanel).
            </>
          )}
        </p>

        {error && <p className="form-error" role="alert">{error}</p>}

        {loading && <div className="idle-state">Bezig met laden...</div>}

        {!loading && !actieveConsultant && (
          <div className="idle-state">
            Nog geen consultant ingesteld — kies er één bij "Call Insights — actieve consultant" in het AdminPanel.
          </div>
        )}

        {!loading && actieveConsultant && ambigueMatches.length > 0 && (
          <div className="insights-ambigu-sectie">
            <h2>Welke kandidaat is dit?</h2>
            <p className="page-intro">
              Dit telefoonnummer komt bij meerdere kandidaten voor — kies de juiste, dan wordt het gesprek alsnog beoordeeld.
            </p>
            {ambigueMatches.map((match) => (
              <div key={match.recording_url} className="insights-call-card">
                <div className="insights-call-header">
                  <span className="insights-call-datum">{formatDatum(match.call_started_at)}</span>
                </div>
                {(match.kandidaat_kandidaten ?? []).map((candidateId) => (
                  <label key={candidateId} className="insights-veld-header">
                    <input
                      type="radio"
                      name={`kandidaat-${match.recording_url}`}
                      checked={gekozenKandidaat[match.recording_url] === candidateId}
                      onChange={() => setGekozenKandidaat((prev) => ({ ...prev, [match.recording_url]: candidateId }))}
                    />
                    <span>{namen[candidateId] ?? `Kandidaat ${candidateId}`}</span>
                  </label>
                ))}
                <div className="insights-call-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={!gekozenKandidaat[match.recording_url] || bezigMetKiezen.has(match.recording_url)}
                    onClick={() => bevestigKandidaatKeuze(match)}
                  >
                    {bezigMetKiezen.has(match.recording_url) ? 'Bezig...' : 'Bevestigen'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && actieveConsultant && gesprekken.length === 0 && ambigueMatches.length === 0 && !error && (
          <div className="idle-state">Geen openstaande suggesties — alles is al beoordeeld.</div>
        )}

        {!loading &&
          gesprekken.map((gesprek) => (
            <div key={gesprek.recordingUrl} className="insights-call-card">
              <div className="insights-call-header">
                <span className="insights-kandidaat-naam">{namen[gesprek.candidateId] ?? `Kandidaat ${gesprek.candidateId}`}</span>
                <span className="insights-call-datum">{formatDatum(gesprek.callStartedAt)}</span>
              </div>

              {gesprek.velden.map((veld) => {
                const staat = bewerking[gesprek.recordingUrl]?.[veld.id] ?? { checked: true, waarde: veld.suggested_value }
                const opties = VELD_OPTIES[veld.field_name]
                return (
                  <div key={veld.id} className="insights-veld-row">
                    <div className="insights-veld-header">
                      <input
                        type="checkbox"
                        checked={staat.checked}
                        onChange={(e) => updateVeldState(gesprek.recordingUrl, veld.id, { checked: e.target.checked })}
                      />
                      <span className="insights-veld-label">{VELD_LABELS[veld.field_name] ?? veld.field_name}</span>
                    </div>
                    <div className="insights-veld-waardes">
                      {veld.current_value && <span className="insights-waarde-oud">{veld.current_value}</span>}
                      <span>→</span>
                      {opties ? (
                        <select
                          className="field-select"
                          value={staat.waarde}
                          disabled={!staat.checked}
                          onChange={(e) => updateVeldState(gesprek.recordingUrl, veld.id, { waarde: e.target.value })}
                        >
                          {opties.map((optie) => (
                            <option key={optie} value={optie}>
                              {optie}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          value={staat.waarde}
                          disabled={!staat.checked}
                          onChange={(e) => updateVeldState(gesprek.recordingUrl, veld.id, { waarde: e.target.value })}
                        />
                      )}
                    </div>
                    {veld.field_name === 'address' && staat.checked && (
                      <p className="insights-quote">
                        Let op: straatnaam/postcode van de oude woonplaats worden bij bevestigen leeggemaakt (horen niet meer bij de
                        nieuwe plaats) — vul zelf aan in Bullhorn indien nodig.
                      </p>
                    )}
                    {veld.quote && <p className="insights-quote">“{veld.quote}”</p>}
                  </div>
                )
              })}

              <div className="insights-call-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={bezigMetOpslaan.has(gesprek.recordingUrl)}
                  onClick={() => bevestigGesprek(gesprek)}
                >
                  {bezigMetOpslaan.has(gesprek.recordingUrl) ? 'Bezig...' : 'Bevestigen'}
                </button>
              </div>
            </div>
          ))}
      </main>
    </div>
  )
}
