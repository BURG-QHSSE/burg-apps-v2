import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchAlleRunsVoorGebruiksoverzicht } from '../../lib/kandidaatMatcherApi'
import { fetchCallInsightsGebruikData } from '../../lib/callInsightsApi'
import { fetchAllProfiles } from '../../lib/adminApi'

const STATUS_LABELS = {
  wacht: 'Wacht',
  bezig: 'Bezig',
  klaar: 'Klaar',
  fout: 'Fout',
  kostenlimiet: 'Gestopt: kostenlimiet',
}

function fmtAantal(n) {
  return Math.round(n || 0).toLocaleString('nl-NL')
}

function fmtUsd(n) {
  return `$${(n || 0).toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/**
 * Tab 1: Kandidaat Matcher — ongewijzigde inhoud t.o.v. het vroegere
 * MatcherGebruik.jsx, alleen verplaatst naar een tabblad. Leest rechtstreeks
 * matching_runs uit en aggregeert client-side per created_by_naam.
 */
function KandidaatMatcherTab() {
  const [runs, setRuns] = useState([])
  const [loading, setLoading] = useState(true)
  const [fout, setFout] = useState('')

  useEffect(() => {
    let isMounted = true
    fetchAlleRunsVoorGebruiksoverzicht()
      .then((data) => {
        if (isMounted) setRuns(data)
      })
      .catch((err) => {
        if (isMounted) setFout(err.message || 'Onbekende fout bij het laden van het gebruiksoverzicht.')
      })
      .finally(() => {
        if (isMounted) setLoading(false)
      })
    return () => {
      isMounted = false
    }
  }, [])

  const perGebruiker = useMemo(() => {
    const map = new Map()
    for (const run of runs) {
      const naam = run.created_by_naam || 'Onbekend'
      const bestaand = map.get(naam) ?? { naam, aantalRuns: 0, aantalKandidaten: 0, kostenUsd: 0 }
      bestaand.aantalRuns += 1
      bestaand.aantalKandidaten += run.aantal_kandidaten || 0
      bestaand.kostenUsd += Number(run.geschatte_kosten_usd || 0)
      map.set(naam, bestaand)
    }
    return Array.from(map.values()).sort((a, b) => b.kostenUsd - a.kostenUsd)
  }, [runs])

  const totalen = useMemo(
    () =>
      perGebruiker.reduce(
        (acc, g) => ({
          aantalRuns: acc.aantalRuns + g.aantalRuns,
          aantalKandidaten: acc.aantalKandidaten + g.aantalKandidaten,
          kostenUsd: acc.kostenUsd + g.kostenUsd,
        }),
        { aantalRuns: 0, aantalKandidaten: 0, kostenUsd: 0 },
      ),
    [perGebruiker],
  )

  if (loading) return <p>Gegevens laden…</p>
  if (fout) return <p className="form-error" role="alert">Kon gegevens niet laden: {fout}</p>
  if (runs.length === 0) return <div className="idle-state">Nog geen runs gestart.</div>

  return (
    <>
      <div className="metric-grid">
        <div className="metric-card metric-card-accent">
          <span className="metric-card-label">Totale kosten</span>
          <span className="metric-card-value">{fmtUsd(totalen.kostenUsd)}</span>
        </div>
        <div className="metric-card">
          <span className="metric-card-label">Totaal runs</span>
          <span className="metric-card-value">{fmtAantal(totalen.aantalRuns)}</span>
        </div>
        <div className="metric-card">
          <span className="metric-card-label">Totaal kandidaten verwerkt</span>
          <span className="metric-card-value">{fmtAantal(totalen.aantalKandidaten)}</span>
        </div>
      </div>

      <h2>Per gebruiker</h2>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Naam</th>
              <th>Aantal runs</th>
              <th>Kandidaten verwerkt</th>
              <th>Kosten</th>
              <th>Gem. kosten per kandidaat</th>
            </tr>
          </thead>
          <tbody>
            {perGebruiker.map((g) => (
              <tr key={g.naam}>
                <td data-label="Naam">{g.naam}</td>
                <td data-label="Aantal runs">{fmtAantal(g.aantalRuns)}</td>
                <td data-label="Kandidaten verwerkt">{fmtAantal(g.aantalKandidaten)}</td>
                <td data-label="Kosten"><strong>{fmtUsd(g.kostenUsd)}</strong></td>
                <td data-label="Gem. kosten per kandidaat">
                  {g.aantalKandidaten > 0 ? fmtUsd(g.kostenUsd / g.aantalKandidaten) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Recente runs</h2>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Datum</th>
              <th>Naam</th>
              <th>Vacature</th>
              <th>Kandidaten</th>
              <th>Status</th>
              <th>Kosten</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id}>
                <td data-label="Datum">{new Date(run.created_at).toLocaleString('nl-NL')}</td>
                <td data-label="Naam">{run.created_by_naam || 'Onbekend'}</td>
                <td data-label="Vacature">{run.vacature_naam}</td>
                <td data-label="Kandidaten">{fmtAantal(run.aantal_kandidaten)}</td>
                <td data-label="Status">{STATUS_LABELS[run.status] ?? run.status}</td>
                <td data-label="Kosten">{fmtUsd(run.geschatte_kosten_usd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

/**
 * Tab 2: Call Insights — per consultant hoeveel gesprekken verwerkt, hoeveel
 * suggesties daaruit kwamen, hoeveel daarvan geaccepteerd/afgewezen/nog
 * pending, en tegen welke kosten (call_insights_processed.kosten_usd, zie
 * de kosten-guardrail in de call-insights Edge Function).
 */
function CallInsightsTab() {
  const [data, setData] = useState(null)
  const [profielen, setProfielen] = useState([])
  const [loading, setLoading] = useState(true)
  const [fout, setFout] = useState('')

  useEffect(() => {
    let isMounted = true
    Promise.all([fetchCallInsightsGebruikData(), fetchAllProfiles()])
      .then(([gebruikData, profielenData]) => {
        if (!isMounted) return
        setData(gebruikData)
        setProfielen(profielenData)
      })
      .catch((err) => {
        if (isMounted) setFout(err.message || 'Onbekende fout bij het laden van het gebruiksoverzicht.')
      })
      .finally(() => {
        if (isMounted) setLoading(false)
      })
    return () => {
      isMounted = false
    }
  }, [])

  const naamPerId = useMemo(() => new Map(profielen.map((p) => [p.id, p.naam || p.email])), [profielen])

  const perConsultant = useMemo(() => {
    if (!data) return []
    const map = new Map()
    const pak = (userId) => {
      if (!map.has(userId)) {
        map.set(userId, {
          userId,
          naam: naamPerId.get(userId) || 'Onbekend',
          verwerkt: 0,
          suggesties: 0,
          geaccepteerd: 0,
          afgewezen: 0,
          pending: 0,
          kostenUsd: 0,
        })
      }
      return map.get(userId)
    }
    for (const r of data.verwerkt) {
      const entry = pak(r.user_id)
      entry.verwerkt += 1
      entry.kostenUsd += Number(r.kosten_usd || 0)
    }
    for (const s of data.suggesties) {
      const entry = pak(s.user_id)
      entry.suggesties += 1
      if (s.status === 'geaccepteerd') entry.geaccepteerd += 1
      else if (s.status === 'afgewezen') entry.afgewezen += 1
      else entry.pending += 1
    }
    return Array.from(map.values()).sort((a, b) => b.kostenUsd - a.kostenUsd)
  }, [data, naamPerId])

  const totalen = useMemo(
    () =>
      perConsultant.reduce(
        (acc, c) => ({
          verwerkt: acc.verwerkt + c.verwerkt,
          suggesties: acc.suggesties + c.suggesties,
          pending: acc.pending + c.pending,
          kostenUsd: acc.kostenUsd + c.kostenUsd,
        }),
        { verwerkt: 0, suggesties: 0, pending: 0, kostenUsd: 0 },
      ),
    [perConsultant],
  )

  if (loading) return <p>Gegevens laden…</p>
  if (fout) return <p className="form-error" role="alert">Kon gegevens niet laden: {fout}</p>
  if (perConsultant.length === 0) return <div className="idle-state">Nog geen gesprekken verwerkt.</div>

  return (
    <>
      <div className="metric-grid">
        <div className="metric-card metric-card-accent">
          <span className="metric-card-label">Totale kosten</span>
          <span className="metric-card-value">{fmtUsd(totalen.kostenUsd)}</span>
        </div>
        <div className="metric-card">
          <span className="metric-card-label">Gesprekken verwerkt</span>
          <span className="metric-card-value">{fmtAantal(totalen.verwerkt)}</span>
        </div>
        <div className="metric-card">
          <span className="metric-card-label">Suggesties gevonden</span>
          <span className="metric-card-value">{fmtAantal(totalen.suggesties)}</span>
        </div>
        <div className="metric-card">
          <span className="metric-card-label">Nog openstaand</span>
          <span className="metric-card-value">{fmtAantal(totalen.pending)}</span>
        </div>
      </div>

      <h2>Per consultant</h2>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Naam</th>
              <th>Gesprekken verwerkt</th>
              <th>Suggesties</th>
              <th>Geaccepteerd</th>
              <th>Afgewezen</th>
              <th>Nog pending</th>
              <th>Kosten</th>
            </tr>
          </thead>
          <tbody>
            {perConsultant.map((c) => (
              <tr key={c.userId}>
                <td data-label="Naam">{c.naam}</td>
                <td data-label="Gesprekken verwerkt">{fmtAantal(c.verwerkt)}</td>
                <td data-label="Suggesties">{fmtAantal(c.suggesties)}</td>
                <td data-label="Geaccepteerd">{fmtAantal(c.geaccepteerd)}</td>
                <td data-label="Afgewezen">{fmtAantal(c.afgewezen)}</td>
                <td data-label="Nog pending">{fmtAantal(c.pending)}</td>
                <td data-label="Kosten"><strong>{fmtUsd(c.kostenUsd)}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

const TABS = [
  { id: 'kandidaat-matcher', label: 'Kandidaat Matcher', Component: KandidaatMatcherTab },
  { id: 'call-insights', label: 'Call Insights', Component: CallInsightsTab },
]

/**
 * Tooling Gebruik — admin-only, gebruiksoverzicht per tool. Hernoemd vanuit
 * "Kandidaat Matcher - Gebruik" (2026-09-16) toen Call Insights als tweede
 * tab bijkwam — zelfde route/tool-id (matcher-gebruik) in toolRegistry.js,
 * dus geen kapotte links/bookmarks.
 */
export default function ToolingGebruik() {
  const [actieveTab, setActieveTab] = useState(TABS[0].id)
  const ActieveComponent = TABS.find((t) => t.id === actieveTab)?.Component ?? TABS[0].Component

  return (
    <div className="page">
      <header className="topbar">
        <div>
          <h1>Tooling Gebruik</h1>
        </div>
        <div className="topbar-actions">
          <Link to="/" className="btn btn-secondary">
            Terug naar dashboard
          </Link>
        </div>
      </header>

      <main className="page-content">
        <p className="page-intro">
          Overzicht van wie welke AI-tool gebruikt, hoe vaak, en tegen welke geschatte Claude-kosten. Alleen voor admins
          zichtbaar.
        </p>

        <div className="tab-bar" style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-6)' }}>
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={tab.id === actieveTab ? 'btn btn-primary' : 'btn btn-secondary'}
              onClick={() => setActieveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <ActieveComponent />
      </main>
    </div>
  )
}
