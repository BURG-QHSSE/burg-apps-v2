import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../lib/AuthProvider'

/**
 * Doorgroei Tracker — KPI-dashboard voor de doorgroei van recruitment- en
 * salesmedewerkers richting hun doelrol.
 *
 * Databron: geen Supabase, maar een publieke Google Apps Script GET-endpoint
 * (CORS-open, geen auth) die drie arrays teruggeeft: `roster`, `recruitment`
 * en `sales`. Zie DATA_URL hieronder.
 *
 * BELANGRIJK — rolgebonden zichtbaarheid (client-side, geen server-side
 * afdwingbaarheid mogelijk want de bron kent geen auth-concept):
 * - role 'user': alleen eigen rijen zichtbaar (match op naam, case/whitespace
 *   ongevoelig).
 * - role 'manager'/'admin': alles zichtbaar, ongefilterd.
 * - Geen match gevonden voor een 'user': duidelijke uitleg tonen i.p.v. een
 *   stille lege dashboard.
 */

const DATA_URL =
  'https://script.google.com/macros/s/AKfycbzt0qsIaPpWCpyR0-YLjynTDOcWmGtnWskEBTfLwIMUcN7hpdp_fKlQvrZJ0ErIIQaiTA/exec'

function normalizeNaam(naam) {
  return (naam || '').trim().toLowerCase()
}

/**
 * Bepaalt de badge-toon voor een status-string. De bron levert een kant-en-
 * klare Nederlandse samenvatting ("Behaald" / "Bezig (...)"); we kleuren op
 * basis daarvan zonder de tekst zelf te herschrijven.
 */
function statusToneClass(status) {
  const s = (status || '').toLowerCase()
  if (s.startsWith('behaald')) return 'badge-mos'
  if (s.startsWith('bezig')) return 'badge-blauwgrijs'
  return 'badge-inactive'
}

function StatusBadge({ status }) {
  return <span className={`badge ${statusToneClass(status)}`}>{status || '—'}</span>
}

function ExclusiefBadge({ exclusiefOk }) {
  if (exclusiefOk === 'n.v.t.' || !exclusiefOk) {
    return <span className="badge badge-inactive">n.v.t.</span>
  }
  if (exclusiefOk === 'Ja') {
    return <span className="badge badge-mos">Ja</span>
  }
  return <span className="badge badge-brand">Nee</span>
}

function fmtGetal(n) {
  if (n === null || n === undefined) return '—'
  return (Math.round(n * 100) / 100).toLocaleString('nl-NL')
}

/**
 * Compacte progressie-balk voor een reeks periodewaarden (maanden of weken).
 * `null` = periode nog niet bereikt/geen data (zichtbaar onderscheiden van
 * 0), hoogte van de vulling is proportioneel aan waarde t.o.v. het doel per
 * periode (gecapt op 100%, want overschrijden van het doel is prima).
 */
function ProgressReeks({ waarden, doelPerPeriode, periodeLabel }) {
  return (
    <div className="reeks-grid">
      {waarden.map((waarde, i) => {
        const heeftData = waarde !== null && waarde !== undefined
        const pct = heeftData && doelPerPeriode > 0 ? Math.min(100, Math.round((waarde / doelPerPeriode) * 100)) : 0
        const gehaald = heeftData && doelPerPeriode > 0 && waarde >= doelPerPeriode

        return (
          <div className="reeks-item" key={i}>
            <div className="reeks-bar-track">
              {heeftData && (
                <div
                  className={gehaald ? 'reeks-bar-fill reeks-bar-fill-gehaald' : 'reeks-bar-fill'}
                  style={{ height: `${Math.max(pct, 4)}%` }}
                />
              )}
            </div>
            <span className="reeks-item-value">{heeftData ? fmtGetal(waarde) : '—'}</span>
            <span className="reeks-item-label">
              {periodeLabel} {i + 1}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function RosterRow({ entry }) {
  return (
    <div className="result-row">
      <div className="result-left">
        <div className="result-name">{entry.naam}</div>
        <div className="result-sub">
          {entry.team} · doel: {entry.doelRol}
        </div>
      </div>
      <div className="result-right">
        <StatusBadge status={entry.status} />
        <div className="result-amount">
          reeks {fmtGetal(entry.huidigeReeks)} / beste {fmtGetal(entry.besteReeks)} · duur {entry.reeksDuur ?? '—'}
        </div>
      </div>
    </div>
  )
}

function DoelCard({ entry, periodeLabel, doelPerPeriode, waarden }) {
  return (
    <div className="section-card doel-card">
      <div className="doel-card-header">
        <div>
          <div className="doel-card-rol">
            {entry.huidigeRol} <span className="doel-card-arrow">→</span> {entry.doelRol}
          </div>
          <div className="result-name">{entry.naam}</div>
        </div>
        <StatusBadge status={entry.status} />
      </div>

      <div className="metric-grid doel-metric-grid">
        <div className="metric-card">
          <span className="metric-card-label">Doel per {periodeLabel}</span>
          <span className="metric-card-value">{fmtGetal(doelPerPeriode)}</span>
        </div>
        <div className="metric-card">
          <span className="metric-card-label">Vereiste reeks</span>
          <span className="metric-card-value">{entry.vereisteReeks ?? '—'}</span>
        </div>
        <div className="metric-card">
          <span className="metric-card-label">Gem. laatste periode</span>
          <span className="metric-card-value">{fmtGetal(entry.avgLastPeriod)}</span>
        </div>
        <div className="metric-card">
          <span className="metric-card-label">Beste periodegemiddelde</span>
          <span className="metric-card-value">{fmtGetal(entry.bestPeriodAvg)}</span>
        </div>
      </div>

      {entry.minExclusief !== null && entry.minExclusief !== undefined && (
        <div className="control-row doel-exclusief-row">
          <span className="control-label">Exclusiviteit vereist ({fmtGetal(entry.minExclusief)}%)</span>
          <ExclusiefBadge exclusiefOk={entry.exclusiefOk} />
        </div>
      )}

      <p className="calc-section-label doel-reeks-label">
        Progressie per {periodeLabel} (t.o.v. doel {fmtGetal(doelPerPeriode)})
      </p>
      <ProgressReeks
        waarden={waarden}
        doelPerPeriode={doelPerPeriode}
        periodeLabel={periodeLabel === 'maand' ? 'M' : 'W'}
      />
    </div>
  )
}

export default function DoorgroeiTracker() {
  const { profile } = useAuth()

  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    let isMounted = true

    setLoading(true)
    setLoadError('')

    fetch(DATA_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`Server antwoordde met status ${res.status}`)
        return res.json()
      })
      .then((json) => {
        if (!isMounted) return
        setData(json)
        setLoading(false)
      })
      .catch((err) => {
        if (!isMounted) return
        console.error('[DoorgroeiTracker] Kon data niet laden:', err)
        setLoadError(err.message || 'Onbekende fout bij het laden van de data.')
        setLoading(false)
      })

    return () => {
      isMounted = false
    }
  }, [])

  const isPlainUser = profile?.role === 'user'
  const eigenNaamNormalized = normalizeNaam(profile?.naam)

  const { visibleRoster, visibleRecruitment, visibleSales, geenMatch } = useMemo(() => {
    if (!data) {
      return { visibleRoster: [], visibleRecruitment: [], visibleSales: [], geenMatch: false }
    }

    const roster = data.roster ?? []
    const recruitment = data.recruitment ?? []
    const sales = data.sales ?? []

    if (!isPlainUser) {
      return { visibleRoster: roster, visibleRecruitment: recruitment, visibleSales: sales, geenMatch: false }
    }

    const filterEigen = (arr) => arr.filter((entry) => normalizeNaam(entry.naam) === eigenNaamNormalized)

    const eigenRoster = filterEigen(roster)
    const eigenRecruitment = filterEigen(recruitment)
    const eigenSales = filterEigen(sales)

    const heeftGeenEnkeleMatch =
      eigenRoster.length === 0 && eigenRecruitment.length === 0 && eigenSales.length === 0

    return {
      visibleRoster: eigenRoster,
      visibleRecruitment: eigenRecruitment,
      visibleSales: eigenSales,
      geenMatch: heeftGeenEnkeleMatch,
    }
  }, [data, isPlainUser, eigenNaamNormalized])

  return (
    <div className="page">
      <header className="topbar">
        <div>
          <h1>Doorgroei Tracker</h1>
        </div>
        <div className="topbar-actions">
          <Link to="/" className="btn btn-secondary">
            Terug naar dashboard
          </Link>
        </div>
      </header>

      <main className="page-content">
        {loading && <p>Gegevens laden…</p>}

        {!loading && loadError && (
          <p className="form-error" role="alert">
            Kon gegevens niet laden: {loadError}
          </p>
        )}

        {!loading && !loadError && isPlainUser && geenMatch && (
          <div className="idle-state">
            Geen gegevens gevonden voor &apos;{profile?.naam || '(geen naam ingesteld)'}&apos;. Vraag een admin je
            naam in het Adminpaneel exact zo in te stellen als in de bron-Sheet.
          </div>
        )}

        {!loading && !loadError && !(isPlainUser && geenMatch) && (
          <>
            {visibleRoster.length > 0 && (
              <div className="calc-section">
                <p className="calc-section-label">Overzicht</p>
                <div className="results-list">
                  {visibleRoster.map((entry, i) => (
                    <RosterRow entry={entry} key={`${entry.naam}-${i}`} />
                  ))}
                </div>
              </div>
            )}

            {visibleRecruitment.length > 0 && (
              <div className="calc-section">
                <p className="calc-section-label">Recruitment</p>
                <div className="doel-card-grid">
                  {visibleRecruitment.map((entry, i) => (
                    <DoelCard
                      entry={entry}
                      periodeLabel="maand"
                      doelPerPeriode={entry.doelPerPeriode}
                      waarden={entry.months ?? []}
                      key={`${entry.naam}-${i}`}
                    />
                  ))}
                </div>
              </div>
            )}

            {visibleSales.length > 0 && (
              <div className="calc-section">
                <p className="calc-section-label">Sales</p>
                <div className="doel-card-grid">
                  {visibleSales.map((entry, i) => (
                    <DoelCard
                      entry={entry}
                      periodeLabel="week"
                      doelPerPeriode={entry.doelPerWeek}
                      waarden={entry.weeks ?? []}
                      key={`${entry.naam}-${i}`}
                    />
                  ))}
                </div>
              </div>
            )}

            {visibleRoster.length === 0 && visibleRecruitment.length === 0 && visibleSales.length === 0 && (
              <div className="idle-state">Geen gegevens beschikbaar.</div>
            )}
          </>
        )}
      </main>
    </div>
  )
}
