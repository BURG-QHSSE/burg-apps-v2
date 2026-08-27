import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchAlleRunsVoorGebruiksoverzicht } from '../../lib/kandidaatMatcherApi'

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
 * Kandidaat Matcher - Gebruik — admin-only overzicht van wie de Kandidaat
 * Matcher gebruikt, hoe vaak, met hoeveel kandidaten per run, en tegen
 * welke kosten (zie toolRegistry.js: minimumRole 'admin', in tegenstelling
 * tot de matcher zelf die sinds 2026-08-27 voor iedereen open staat).
 *
 * Leest rechtstreeks matching_runs uit (geen aparte tabel/Edge Function
 * nodig — created_by_naam/aantal_kandidaten/geschatte_kosten_usd stonden er
 * al in) en aggregeert client-side per created_by_naam.
 */
export default function MatcherGebruik() {
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

  return (
    <div className="page">
      <header className="topbar">
        <div>
          <h1>Kandidaat Matcher - Gebruik</h1>
        </div>
        <div className="topbar-actions">
          <Link to="/" className="btn btn-secondary">
            Terug naar dashboard
          </Link>
        </div>
      </header>

      <main className="page-content">
        <p className="page-intro">
          Overzicht van wie de Kandidaat Matcher gebruikt, hoe vaak, met hoeveel kandidaten per run en tegen welke
          geschatte Claude-kosten. Dit overzicht is alleen voor admins zichtbaar — de matcher zelf staat open voor
          iedereen.
        </p>

        {loading && <p>Gegevens laden…</p>}

        {!loading && fout && (
          <p className="form-error" role="alert">
            Kon gegevens niet laden: {fout}
          </p>
        )}

        {!loading && !fout && runs.length === 0 && <div className="idle-state">Nog geen runs gestart.</div>}

        {!loading && !fout && runs.length > 0 && (
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
                      <td data-label="Kosten">
                        <strong>{fmtUsd(g.kostenUsd)}</strong>
                      </td>
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
        )}
      </main>
    </div>
  )
}
