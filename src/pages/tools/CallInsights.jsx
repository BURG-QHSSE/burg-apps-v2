import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import bullhornLogo from '../../assets/bullhorn-icon.png'
import { useAuth } from '../../lib/AuthProvider'
import {
  fetchPendingSuggesties,
  fetchAmbigueMatches,
  fetchAllePendingSuggesties,
  fetchAlleAmbigueMatches,
  fetchConsultantProfielen,
  fetchKandidaatNamen,
  verifieerSuggestiesActueel,
  accepteerSuggestie,
  wijsSuggestieAf,
  resolveCandidateMatch,
} from '../../lib/callInsightsApi'

/**
 * Call Insights — automatisch gedetecteerde Bullhorn-veldwijzigingen
 * (salaris range, uurtarief range, woonplaats, voorkeur dienstverband,
 * status) uit 3CX-gesprekssamenvattingen. Welke AI hierachter zit staat
 * bewust nergens in de UI (zelfde afspraak als Kandidaat Matcher).
 *
 * Twee weergaven, bepaald door de ingelogde gebruiker (zie toolRegistry.js
 * canAccessTool voor wie hier überhaupt mag komen):
 * - Admin: overzicht + inbox over ALLE consultants heen (RLS "admin leest
 *   alle suggesties/verwerkte recordings" staat dit toe).
 * - Consultant (team='consultant', en de live-schakelaar in Instellingen
 *   staat aan): ziet uitsluitend de eigen gesprekken (auth.uid()).
 *
 * Matching + extractie gebeurt buiten deze UI om (call-insights Edge
 * Function, actie syncNewCalls, op een cron) — dit scherm toont alleen wat
 * al klaarstaat en verwerkt het besluit (accepteren schrijft direct naar
 * Bullhorn, zie supabase/functions/call-insights).
 *
 * Kandidaatnamen worden live opgehaald, nooit opgeslagen — zelfde AVG-
 * voorzichtigheid als Kandidaat Matcher.
 */

const BULLHORN_CANDIDATE_URL = (id) => `https://cls22.bullhornstaffing.com/BullhornSTAFFING/OpenWindow.cfm?Entity=Candidate&id=${id}`

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
  employmentPreference: ['Loondienst', 'Interim', 'Loondienst, Interim'],
  status: ['OTW', 'Placeable', 'Door ons geplaatst', 'Geen specialist', 'DNC', 'New Lead'],
}

function formatDatum(iso) {
  const d = new Date(iso)
  return d.toLocaleString('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export default function CallInsights() {
  const { user, profile } = useAuth()
  const isAdmin = profile?.role === 'admin'

  const [consultantProfielen, setConsultantProfielen] = useState([])
  const [suggesties, setSuggesties] = useState([])
  const [ambigueMatches, setAmbigueMatches] = useState([])
  const [namen, setNamen] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  // Feedback na het bevestigen van een kandidaat-keuze bij een ambigu
  // gesprek — anders verdwijnt de kaart na het herladen zonder dat de
  // consultant ziet of dat wel/niet een suggestie opleverde.
  const [keuzeResultaat, setKeuzeResultaat] = useState(null)
  // Per-call bewerkstatus: { [recording_url]: { [suggestionId]: { checked, waarde } } }
  const [bewerking, setBewerking] = useState({})
  const [bezigMetOpslaan, setBezigMetOpslaan] = useState(new Set())
  const [bezigMetAfwijzen, setBezigMetAfwijzen] = useState(new Set())
  const [bevestigModalGesprek, setBevestigModalGesprek] = useState(null)
  const [gekozenKandidaat, setGekozenKandidaat] = useState({})
  const [bezigMetKiezen, setBezigMetKiezen] = useState(new Set())
  // Admin-only weergavefilter — puur om in te kunnen zoomen op de gesprekken
  // van één consultant (bv. om voorbeelden van hun data te bekijken); heeft
  // geen effect op wie er daadwerkelijk verwerkt wordt (dat bepaalt
  // profiles.team alleen). '' = iedereen.
  const [consultantFilter, setConsultantFilter] = useState('')
  // { [suggestionId]: { actueleWaarde, verouderd } } — checkt of het
  // Bullhorn-veld sindsdien elders is gewijzigd (zie verifieerSuggestiesActueel).
  const [veldStatus, setVeldStatus] = useState({})

  const consultantNaamPerId = useMemo(
    () => new Map(consultantProfielen.map((c) => [c.id, c.naam || c.email])),
    [consultantProfielen],
  )

  async function laadGegevens() {
    setLoading(true)
    setError(null)
    try {
      let suggestiesData
      let ambigueData
      if (isAdmin) {
        const consultanten = await fetchConsultantProfielen()
        setConsultantProfielen(consultanten)
        ;[suggestiesData, ambigueData] = await Promise.all([fetchAllePendingSuggesties(), fetchAlleAmbigueMatches()])
      } else {
        ;[suggestiesData, ambigueData] = await Promise.all([fetchPendingSuggesties(user.id), fetchAmbigueMatches(user.id)])
      }
      setSuggesties(suggestiesData)
      setAmbigueMatches(ambigueData)

      const kandidaatIds = [
        ...new Set([
          ...suggestiesData.map((s) => s.bullhorn_candidate_id),
          ...ambigueData.flatMap((m) => m.kandidaat_kandidaten ?? []),
        ]),
      ]
      const [namenData, veldStatusData] = await Promise.all([
        fetchKandidaatNamen(kandidaatIds),
        verifieerSuggestiesActueel(suggestiesData.map((s) => s.id)),
      ])
      setNamen(namenData)
      setVeldStatus(veldStatusData)

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
    if (!user?.id) return
    laadGegevens()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, isAdmin])

  // Scrollpositie bewaren - zonder dit sprong je terug naar boven zodra het
  // tabblad (bv. na het bekijken van een kandidaat in Bullhorn) naar de
  // achtergrond ging en herladen werd. Zelfde patroon als KandidaatMatcher.jsx.
  const SCROLL_CACHE_SLEUTEL = 'call-insights-scroll'

  useEffect(() => {
    function bewaarScroll() {
      try {
        sessionStorage.setItem(SCROLL_CACHE_SLEUTEL, String(window.scrollY))
      } catch {
        // sessionStorage kan onbeschikbaar zijn - dan blijft de scrollpositie gewoon niet bewaard
      }
    }
    document.addEventListener('visibilitychange', bewaarScroll)
    window.addEventListener('pagehide', bewaarScroll)
    return () => {
      document.removeEventListener('visibilitychange', bewaarScroll)
      window.removeEventListener('pagehide', bewaarScroll)
    }
  }, [])

  // Herstellen zodra er weer iets te tonen is - pas dan is de pagina lang
  // genoeg om ergens naartoe te kunnen scrollen.
  useEffect(() => {
    if (loading) return
    try {
      const bewaard = sessionStorage.getItem(SCROLL_CACHE_SLEUTEL)
      if (bewaard) window.scrollTo(0, Number(bewaard))
    } catch {
      // niet fataal - dan begin je gewoon bovenaan
    }
  }, [loading])

  async function bevestigKandidaatKeuze(match) {
    const candidateId = gekozenKandidaat[match.recording_url]
    if (!candidateId) return
    setBezigMetKiezen((prev) => new Set(prev).add(match.recording_url))
    setError(null)
    setKeuzeResultaat(null)
    try {
      const resultaat = await resolveCandidateMatch(match.recording_url, candidateId)
      setKeuzeResultaat(
        resultaat.suggestiesAantal > 0
          ? `Kandidaat gekozen — ${resultaat.suggestiesAantal} suggestie${resultaat.suggestiesAantal === 1 ? '' : 's'} gevonden, te zien hieronder bij de openstaande suggesties.`
          : 'Kandidaat gekozen — geen wijzigingen gedetecteerd in dit gesprek.',
      )
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

  const ambigueMatchesGefilterd = useMemo(
    () => (consultantFilter ? ambigueMatches.filter((m) => m.user_id === consultantFilter) : ambigueMatches),
    [ambigueMatches, consultantFilter],
  )

  const gesprekken = useMemo(() => {
    const perGesprek = new Map()
    const relevanteSuggesties = consultantFilter ? suggesties.filter((s) => s.user_id === consultantFilter) : suggesties
    for (const s of relevanteSuggesties) {
      if (!perGesprek.has(s.recording_url)) {
        perGesprek.set(s.recording_url, {
          recordingUrl: s.recording_url,
          candidateId: s.bullhorn_candidate_id,
          userId: s.user_id,
          callStartedAt: s.call_started_at,
          samenvatting: s.call_summary,
          velden: [],
        })
      }
      perGesprek.get(s.recording_url).velden.push(s)
    }
    return [...perGesprek.values()].sort((a, b) => new Date(b.callStartedAt) - new Date(a.callStartedAt))
  }, [suggesties, consultantFilter])

  // Admin-only: puur ter oriëntatie boven de inbox — wie moet nog wat
  // afhandelen. Historie (al afgehandeld, kosten) staat in Tooling Gebruik.
  const overzichtPerConsultant = useMemo(() => {
    if (!isAdmin) return []
    const perGebruiker = new Map(
      consultantProfielen.map((c) => [c.id, { userId: c.id, naam: c.naam || c.email, pendingSuggesties: 0, ambigu: 0 }]),
    )
    for (const s of suggesties) {
      const entry = perGebruiker.get(s.user_id)
      if (entry) entry.pendingSuggesties += 1
    }
    for (const m of ambigueMatches) {
      const entry = perGebruiker.get(m.user_id)
      if (entry) entry.ambigu += 1
    }
    return [...perGebruiker.values()].sort((a, b) => b.pendingSuggesties + b.ambigu - (a.pendingSuggesties + a.ambigu))
  }, [isAdmin, consultantProfielen, suggesties, ambigueMatches])

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

  async function handleBevestigModalConfirm() {
    const gesprek = bevestigModalGesprek
    if (!gesprek) return
    setBevestigModalGesprek(null)
    await bevestigGesprek(gesprek)
  }

  async function wijsVeldAf(gesprek, veld) {
    setBezigMetAfwijzen((prev) => new Set(prev).add(veld.id))
    setError(null)
    try {
      await wijsSuggestieAf(veld.id)
      setSuggesties((prev) => prev.filter((s) => s.id !== veld.id))
      setBewerking((prev) => {
        const gesprekBewerking = { ...prev[gesprek.recordingUrl] }
        delete gesprekBewerking[veld.id]
        return { ...prev, [gesprek.recordingUrl]: gesprekBewerking }
      })
    } catch (err) {
      setError(err.message)
    } finally {
      setBezigMetAfwijzen((prev) => {
        const next = new Set(prev)
        next.delete(veld.id)
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
          Automatisch gedetecteerde wijzigingen uit gesprekken — de 3CX-gesprekssamenvatting wordt vergeleken met wat er nu in Bullhorn
          staat. Vink aan welke velden bijgewerkt moeten worden, corrigeer de waarde indien nodig, en klik op Bevestigen.
          {isAdmin &&
            (consultantFilter
              ? ` Je ziet nu alleen de gesprekken van ${consultantNaamPerId.get(consultantFilter) ?? 'deze consultant'}.`
              : ' Je ziet hier de gesprekken van alle consultants.')}
        </p>

        {error && <p className="form-error" role="alert">{error}</p>}
        {keuzeResultaat && <p className="form-success" role="status">{keuzeResultaat}</p>}

        {loading && <div className="idle-state">Bezig met laden...</div>}

        {!loading && isAdmin && overzichtPerConsultant.length > 0 && (
          <div className="admin-table-wrap" style={{ marginBottom: 'var(--space-6)' }}>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Consultant</th>
                  <th>Openstaande suggesties</th>
                  <th>Openstaande kandidaat-keuzes</th>
                </tr>
              </thead>
              <tbody>
                {overzichtPerConsultant.map((c) => (
                  <tr key={c.userId}>
                    <td data-label="Consultant">{c.naam}</td>
                    <td data-label="Openstaande suggesties">{c.pendingSuggesties}</td>
                    <td data-label="Openstaande kandidaat-keuzes">{c.ambigu}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && isAdmin && consultantProfielen.length === 0 && (
          <div className="idle-state">
            Nog geen enkele gebruiker met team "Consultant" ingesteld — zie "Alle gebruikers" in Instellingen.
          </div>
        )}

        {!loading && isAdmin && consultantProfielen.length > 0 && (
          <div className="field" style={{ maxWidth: 320, marginBottom: 'var(--space-6)' }}>
            <label>Bekijk gesprekken van</label>
            <select className="field-select" value={consultantFilter} onChange={(e) => setConsultantFilter(e.target.value)}>
              <option value="">— Iedereen —</option>
              {consultantProfielen.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.naam || c.email}
                </option>
              ))}
            </select>
          </div>
        )}

        {!loading && ambigueMatchesGefilterd.length > 0 && (
          <div className="insights-ambigu-sectie">
            <h2>Welke kandidaat is dit?</h2>
            <p className="page-intro">
              Dit telefoonnummer komt bij meerdere kandidaten voor — kies de juiste, dan wordt het gesprek alsnog beoordeeld.
            </p>
            {ambigueMatchesGefilterd.map((match) => (
              <div key={match.recording_url} className="insights-call-card">
                <div className="insights-call-header">
                  {isAdmin && <span className="insights-kandidaat-naam">{consultantNaamPerId.get(match.user_id) ?? 'Onbekend'}</span>}
                  <span className="insights-call-datum">{formatDatum(match.call_started_at)}</span>
                </div>
                {(match.kandidaat_kandidaten ?? []).map((candidateId) => (
                  <div key={candidateId} className="insights-ambigu-optie">
                    <label className="insights-veld-header">
                      <input
                        type="radio"
                        name={`kandidaat-${match.recording_url}`}
                        checked={gekozenKandidaat[match.recording_url] === candidateId}
                        onChange={() => setGekozenKandidaat((prev) => ({ ...prev, [match.recording_url]: candidateId }))}
                      />
                      <span>{namen[candidateId] ?? `Kandidaat ${candidateId}`}</span>
                    </label>
                    <a
                      href={BULLHORN_CANDIDATE_URL(candidateId)}
                      target="_blank"
                      rel="noreferrer"
                      className="matcher-bullhorn-knop"
                    >
                      <img src={bullhornLogo} alt="" className="matcher-bullhorn-logo" />
                      Bekijken in Bullhorn
                    </a>
                  </div>
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

        {!loading && gesprekken.length === 0 && ambigueMatchesGefilterd.length === 0 && !error && (
          <div className="idle-state">Geen openstaande suggesties — alles is al beoordeeld.</div>
        )}

        {!loading &&
          gesprekken.map((gesprek) => (
            <div key={gesprek.recordingUrl} className="insights-call-card">
              <div className="insights-call-header">
                <span className="insights-kandidaat-naam">{namen[gesprek.candidateId] ?? `Kandidaat ${gesprek.candidateId}`}</span>
                {isAdmin && (
                  <span className="insights-kandidaat-naam">— {consultantNaamPerId.get(gesprek.userId) ?? 'Onbekend'}</span>
                )}
                <span className="insights-call-datum">{formatDatum(gesprek.callStartedAt)}</span>
              </div>

              <a
                href={BULLHORN_CANDIDATE_URL(gesprek.candidateId)}
                target="_blank"
                rel="noreferrer"
                className="matcher-bullhorn-knop"
              >
                <img src={bullhornLogo} alt="" className="matcher-bullhorn-logo" />
                Bekijken in Bullhorn
              </a>

              {gesprek.samenvatting && <p className="insights-samenvatting">{gesprek.samenvatting}</p>}

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
                      <button
                        type="button"
                        className="insights-veld-afwijzen"
                        disabled={bezigMetAfwijzen.has(veld.id)}
                        onClick={() => wijsVeldAf(gesprek, veld)}
                      >
                        {bezigMetAfwijzen.has(veld.id) ? 'Bezig...' : 'Suggestie afwijzen'}
                      </button>
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
                    {veldStatus[veld.id]?.verouderd && (
                      <p className="form-error" role="alert">
                        Let op: dit veld staat inmiddels op "{veldStatus[veld.id].actueleWaarde || '(leeg)'}" in Bullhorn —
                        gewijzigd sinds deze suggestie is gedetecteerd. Controleer of bevestigen nog klopt.
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
                  onClick={() => setBevestigModalGesprek(gesprek)}
                >
                  {bezigMetOpslaan.has(gesprek.recordingUrl) ? 'Bezig...' : 'Bevestigen'}
                </button>
              </div>
            </div>
          ))}

        {bevestigModalGesprek && (
          <>
            <div className="mo-modal-overlay" onClick={() => setBevestigModalGesprek(null)} />
            <div className="mo-modal-box">
              <div className="mo-modal-title">Weet je het zeker?</div>
              <div className="mo-modal-sub">
                Dit schrijft de aangevinkte velden direct naar Bullhorn voor{' '}
                {namen[bevestigModalGesprek.candidateId] ?? `kandidaat ${bevestigModalGesprek.candidateId}`}.
              </div>
              {(() => {
                const aangevinkt = bevestigModalGesprek.velden.filter(
                  (veld) => (bewerking[bevestigModalGesprek.recordingUrl]?.[veld.id] ?? { checked: true }).checked,
                )
                if (aangevinkt.length === 0) {
                  return <p className="insights-modal-melding">Geen velden aangevinkt — alle suggesties van dit gesprek worden afgewezen.</p>
                }
                return (
                  <ul className="insights-modal-veldlijst">
                    {aangevinkt.map((veld) => {
                      const staat = bewerking[bevestigModalGesprek.recordingUrl]?.[veld.id] ?? { waarde: veld.suggested_value }
                      return (
                        <li key={veld.id}>
                          <strong>{VELD_LABELS[veld.field_name] ?? veld.field_name}:</strong>{' '}
                          {veld.current_value && <>{veld.current_value} → </>}
                          {staat.waarde}
                        </li>
                      )
                    })}
                  </ul>
                )
              })()}
              <div className="mo-modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setBevestigModalGesprek(null)}>
                  Annuleren
                </button>
                <button type="button" className="btn btn-primary" onClick={handleBevestigModalConfirm}>
                  Ja, doorvoeren
                </button>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
