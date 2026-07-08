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
  'https://script.google.com/macros/s/AKfycbzIicChs1q6DlRUyW-JHFm9lZHyBynl_zyAf8tczD85MJmnAHQT_LNzdkgoWZ29_IkWnQ/exec'

function normalizeNaam(naam) {
  // String(...) i.p.v. aannemen dat naam al tekst is — zie statusToneClass
  // hieronder voor dezelfde reden (een kolomverschuiving in de bron kan hier
  // een getal leveren, en .trim() bestaat niet op number).
  return String(naam ?? '').trim().toLowerCase()
}

/**
 * Bepaalt de badge-toon voor een status-string. De bron levert een kant-en-
 * klare Nederlandse samenvatting ("Behaald" / "Bezig (...)"); we kleuren op
 * basis daarvan zonder de tekst zelf te herschrijven.
 */
function statusToneClass(status) {
  // String(...) i.p.v. aannemen dat status al tekst is: de bron (Google
  // Sheet) kan door een kolomverschuiving per ongeluk een getal leveren waar
  // tekst wordt verwacht — zonder deze coercion crasht .toLowerCase() daarop
  // en valt de hele pagina wit weg.
  const s = String(status ?? '').toLowerCase()
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

function DoelCard({ entry, periodeLabel, doelPerPeriode, waarden, gemLabel, gemWaarde, besteLabel, besteWaarde }) {
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
          <span className="metric-card-label">{gemLabel}</span>
          <span className="metric-card-value">{fmtGetal(gemWaarde)}</span>
        </div>
        <div className="metric-card">
          <span className="metric-card-label">{besteLabel}</span>
          <span className="metric-card-value">{fmtGetal(besteWaarde)}</span>
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
  const [pogingen, setPogingen] = useState(0)

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
        console.error('[DoorgroeiTracker] Kon data niet laden (poging ' + (pogingen + 1) + '):', err)

        // De bron (Google Apps Script) heeft soms een trage "cold start" —
        // één stille herpoging lost dat meestal vanzelf op, voordat we de
        // gebruiker met een foutmelding opzadelen.
        if (pogingen === 0) {
          setPogingen(1)
          return
        }

        setLoadError(err.message || 'Onbekende fout bij het laden van de data.')
        setLoading(false)
      })

    return () => {
      isMounted = false
    }
  }, [pogingen])

  const isPlainUser = profile?.role === 'user'
  const eigenNaamNormalized = normalizeNaam(profile?.naam)

  const { visibleRecruitment, visibleSales, geenMatch } = useMemo(() => {
    if (!data) {
      return { visibleRoster: [], visibleRecruitment: [], visibleSales: [], geenMatch: false }
    }

    // Array.isArray i.p.v. enkel ?? [] — garandeert ook dat de bron echt een
    // array teruggaf (niet bv. een object of string), anders crasht de
    // .filter/.map hieronder alsnog op "is not a function".
    const roster = Array.isArray(data.roster) ? data.roster : []
    const recruitment = Array.isArray(data.recruitment) ? data.recruitment : []
    const sales = Array.isArray(data.sales) ? data.sales : []

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
          <div className="idle-state">
            <p className="form-error" role="alert">
              Kon gegevens niet laden: {loadError}
            </p>
            <p>De bron is soms traag — probeer het gerust nog een keer.</p>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setLoadError('')
                setPogingen(0)
              }}
            >
              Opnieuw proberen
            </button>
          </div>
        )}

        {!loading && !loadError && isPlainUser && geenMatch && (
          <div className="idle-state">
            Geen gegevens gevonden voor &apos;{profile?.naam || '(geen naam ingesteld)'}&apos;. Vraag een admin je
            naam in het Adminpaneel exact zo in te stellen als in de bron-Sheet.
          </div>
        )}

        {!loading && !loadError && !(isPlainUser && geenMatch) && (
          <>
            {visibleRecruitment.length > 0 && (
              <div className="calc-section">
                <p className="calc-section-label">Recruitment</p>
                <div className="doel-card-grid">
                  {visibleRecruitment.map((entry, i) => (
                    <DoelCard
                      entry={entry}
                      periodeLabel="maand"
                      doelPerPeriode={entry.doelPerPeriode}
                      waarden={Array.isArray(entry.months) ? entry.months : []}
                      gemLabel="Gem. laatste periode"
                      gemWaarde={entry.avgLastPeriod}
                      besteLabel="Beste periodegemiddelde"
                      besteWaarde={entry.bestPeriodAvg}
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
                      waarden={Array.isArray(entry.weeks) ? entry.weeks : []}
                      gemLabel="Huidige reeks"
                      gemWaarde={entry.huidigeReeks}
                      besteLabel="Beste reeks"
                      besteWaarde={entry.besteReeks}
                      key={`${entry.naam}-${i}`}
                    />
                  ))}
                </div>
              </div>
            )}

            {visibleRecruitment.length === 0 && visibleSales.length === 0 && (
              <div className="idle-state">Geen gegevens beschikbaar.</div>
            )}
          </>
        )}
      </main>
    </div>
  )
}
