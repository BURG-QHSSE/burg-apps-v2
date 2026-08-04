import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchCallStatsForPeriod, fetchCallStatsRoster } from '../../lib/callStatsApi'

/**
 * Bel Overzicht — belstatistieken per medewerker uit 3CX CDR-data.
 *
 * Databron: `call_daily_stats` (tabel, cron gevuld elke nacht 00:20 voor de
 * vorige dag) en de views `call_weekly_stats`/`call_quarterly_stats` die
 * daar automatisch op groeperen. Alleen beantwoorde gesprekken tellen mee.
 * RLS staat iedereen toe deze cijfers te lezen (geen rol-restrictie) — zie
 * supabase/schema.sql en lib/callStatsApi.js.
 *
 * Datum-navigatie werkt op een "anker"-dag (UTC-gebaseerd, want call_date/
 * week_start/quarter_start zijn tijdloze DATE-waarden): bij wisselen van
 * dag/week/kwartaal wordt de periode rond datzelfde anker herberekend, en
 * vorige/volgende/datumkeuze verschuiven het anker. Zo kun je vrij door het
 * hele jaar (en verder terug) bladeren, niet alleen het huidige kwartaal.
 */

const PERIOD_OPTIONS = [
  { value: 'dag', label: 'Dag' },
  { value: 'week', label: 'Week' },
  { value: 'kwartaal', label: 'Kwartaal' },
]

const MAAND_KORT = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec']

function todayUTC() {
  const nu = new Date()
  return new Date(Date.UTC(nu.getFullYear(), nu.getMonth(), nu.getDate()))
}

function addDaysUTC(datum, dagen) {
  return new Date(datum.getTime() + dagen * 86400000)
}

/** Maandag van de ISO-week waar `datum` in valt. */
function startOfWeekUTC(datum) {
  const weekdag = datum.getUTCDay() || 7 // zondag (0) telt als 7, ISO-week begint op maandag
  return addDaysUTC(datum, -(weekdag - 1))
}

/** Eerste dag van het kalenderkwartaal waar `datum` in valt. */
function startOfQuarterUTC(datum) {
  const kwartaalMaand = Math.floor(datum.getUTCMonth() / 3) * 3
  return new Date(Date.UTC(datum.getUTCFullYear(), kwartaalMaand, 1))
}

function addPeriodUTC(datum, period, delta) {
  if (period === 'dag') return addDaysUTC(datum, delta)
  if (period === 'week') return addDaysUTC(datum, delta * 7)
  const start = startOfQuarterUTC(datum)
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + delta * 3, 1))
}

function toISODate(datum) {
  return datum.toISOString().slice(0, 10)
}

function periodValueFor(period, anchor) {
  if (period === 'dag') return toISODate(anchor)
  if (period === 'week') return toISODate(startOfWeekUTC(anchor))
  return toISODate(startOfQuarterUTC(anchor))
}

/** ISO-weeknummer (week met de eerste donderdag van het jaar is week 1). */
function isoWeekNumber(maandag) {
  const d = new Date(Date.UTC(maandag.getUTCFullYear(), maandag.getUTCMonth(), maandag.getUTCDate()))
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7))
  const jaarStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil(((d - jaarStart) / 86400000 + 1) / 7)
}

function formatPeriodLabel(period, anchor) {
  if (period === 'dag') {
    return anchor.toLocaleDateString('nl-NL', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    })
  }

  if (period === 'week') {
    const start = startOfWeekUTC(anchor)
    const eind = addDaysUTC(start, 6)
    const startLabel = `${start.getUTCDate()} ${MAAND_KORT[start.getUTCMonth()]}`
    const eindLabel = `${eind.getUTCDate()} ${MAAND_KORT[eind.getUTCMonth()]} ${eind.getUTCFullYear()}`
    return `Week ${isoWeekNumber(start)} · ${startLabel} – ${eindLabel}`
  }

  const start = startOfQuarterUTC(anchor)
  const kwartaalNummer = Math.floor(start.getUTCMonth() / 3) + 1
  return `Q${kwartaalNummer} ${start.getUTCFullYear()}`
}

function fmtAantal(n) {
  return Math.round(n || 0).toLocaleString('nl-NL')
}

function fmtMinuten(n) {
  return (Math.round((n || 0) * 10) / 10).toLocaleString('nl-NL')
}

export default function BelOverzicht() {
  const [period, setPeriod] = useState('dag')
  const [anchor, setAnchor] = useState(() => todayUTC())

  const [roster, setRoster] = useState([])
  const [rosterLoading, setRosterLoading] = useState(true)
  const [rosterError, setRosterError] = useState('')

  const [stats, setStats] = useState([])
  const [statsLoading, setStatsLoading] = useState(true)
  const [statsError, setStatsError] = useState('')

  // Roster (naam + welke medewerkers meetellen) hoeft maar één keer geladen
  // te worden — verandert niet bij het wisselen van periode.
  useEffect(() => {
    let isMounted = true

    fetchCallStatsRoster()
      .then((data) => {
        if (isMounted) setRoster(data)
      })
      .catch((err) => {
        if (isMounted) setRosterError(err.message || 'Onbekende fout bij het laden van medewerkers.')
      })
      .finally(() => {
        if (isMounted) setRosterLoading(false)
      })

    return () => {
      isMounted = false
    }
  }, [])

  const periodValue = useMemo(() => periodValueFor(period, anchor), [period, anchor])

  useEffect(() => {
    let isMounted = true
    setStatsLoading(true)
    setStatsError('')

    fetchCallStatsForPeriod(period, periodValue)
      .then((data) => {
        if (isMounted) setStats(data)
      })
      .catch((err) => {
        if (isMounted) setStatsError(err.message || 'Onbekende fout bij het laden van belcijfers.')
      })
      .finally(() => {
        if (isMounted) setStatsLoading(false)
      })

    return () => {
      isMounted = false
    }
  }, [period, periodValue])

  const huidigePeriodValue = useMemo(() => periodValueFor(period, todayUTC()), [period])
  const kanVooruit = periodValue < huidigePeriodValue
  const isHuidigePeriode = periodValue === huidigePeriodValue

  const rijen = useMemo(() => {
    const statsPerUser = new Map(stats.map((rij) => [rij.user_id, rij]))

    return roster.map((entry) => {
      const s = statsPerUser.get(entry.userId)
      const callsIn = s?.calls_in ?? 0
      const callsOut = s?.calls_out ?? 0
      const minutesIn = Number(s?.minutes_in ?? 0)
      const minutesOut = Number(s?.minutes_out ?? 0)

      return {
        ...entry,
        callsIn,
        callsOut,
        callsTotaal: callsIn + callsOut,
        minutesIn,
        minutesOut,
        minutesTotaal: minutesIn + minutesOut,
      }
    })
  }, [roster, stats])

  const totalen = useMemo(
    () =>
      rijen.reduce(
        (acc, r) => ({
          callsIn: acc.callsIn + r.callsIn,
          callsOut: acc.callsOut + r.callsOut,
          callsTotaal: acc.callsTotaal + r.callsTotaal,
          minutesIn: acc.minutesIn + r.minutesIn,
          minutesOut: acc.minutesOut + r.minutesOut,
          minutesTotaal: acc.minutesTotaal + r.minutesTotaal,
        }),
        { callsIn: 0, callsOut: 0, callsTotaal: 0, minutesIn: 0, minutesOut: 0, minutesTotaal: 0 },
      ),
    [rijen],
  )

  function handleDatumInput(e) {
    if (!e.target.value) return
    const [jaar, maand, dag] = e.target.value.split('-').map(Number)
    setAnchor(new Date(Date.UTC(jaar, maand - 1, dag)))
  }

  const loading = rosterLoading || statsLoading
  const loadError = rosterError || statsError

  return (
    <div className="page">
      <header className="topbar">
        <div>
          <h1>Bel Overzicht</h1>
        </div>
        <div className="topbar-actions">
          <Link to="/" className="btn btn-secondary">
            Terug naar dashboard
          </Link>
        </div>
      </header>

      <main className="page-content">
        <div className="control-row">
          <span className="control-label">Periode</span>
          <div className="btn-toggle-group">
            {PERIOD_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={period === opt.value ? 'btn-toggle active' : 'btn-toggle'}
                onClick={() => setPeriod(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="date-nav-row">
          <button type="button" className="btn btn-secondary" onClick={() => setAnchor((a) => addPeriodUTC(a, period, -1))}>
            ‹ Vorige
          </button>

          <div className="date-nav-center">
            <span className="date-nav-label">{formatPeriodLabel(period, anchor)}</span>
            <div className="text-input-wrap">
              <input type="date" value={toISODate(anchor)} onChange={handleDatumInput} />
            </div>
          </div>

          <button
            type="button"
            className="btn btn-secondary"
            disabled={!kanVooruit}
            onClick={() => setAnchor((a) => addPeriodUTC(a, period, 1))}
          >
            Volgende ›
          </button>

          {!isHuidigePeriode && (
            <button type="button" className="btn btn-ghost" onClick={() => setAnchor(todayUTC())}>
              Vandaag
            </button>
          )}
        </div>

        {loading && <p>Gegevens laden…</p>}

        {!loading && loadError && (
          <p className="form-error" role="alert">
            Kon gegevens niet laden: {loadError}
          </p>
        )}

        {!loading && !loadError && rijen.length === 0 && (
          <div className="idle-state">Geen medewerkers gevonden met een gekoppeld 3CX-toestel.</div>
        )}

        {!loading && !loadError && rijen.length > 0 && (
          <>
            <div className="metric-grid">
              <div className="metric-card">
                <span className="metric-card-label">Inkomend</span>
                <span className="metric-card-value">{fmtAantal(totalen.callsIn)}</span>
              </div>
              <div className="metric-card">
                <span className="metric-card-label">Uitgaand</span>
                <span className="metric-card-value">{fmtAantal(totalen.callsOut)}</span>
              </div>
              <div className="metric-card metric-card-accent">
                <span className="metric-card-label">Totaal gesprekken</span>
                <span className="metric-card-value">{fmtAantal(totalen.callsTotaal)}</span>
              </div>
              <div className="metric-card">
                <span className="metric-card-label">Totaal belminuten</span>
                <span className="metric-card-value">{fmtMinuten(totalen.minutesTotaal)}</span>
              </div>
            </div>

            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Naam</th>
                    <th>Inkomend</th>
                    <th>Uitgaand</th>
                    <th>Totaal gesprekken</th>
                    <th>Min. inkomend</th>
                    <th>Min. uitgaand</th>
                    <th>Totaal minuten</th>
                  </tr>
                </thead>
                <tbody>
                  {rijen.map((r) => (
                    <tr key={r.userId}>
                      <td data-label="Naam">{r.naam}</td>
                      <td data-label="Inkomend">{fmtAantal(r.callsIn)}</td>
                      <td data-label="Uitgaand">{fmtAantal(r.callsOut)}</td>
                      <td data-label="Totaal gesprekken">
                        <strong>{fmtAantal(r.callsTotaal)}</strong>
                      </td>
                      <td data-label="Min. inkomend">{fmtMinuten(r.minutesIn)}</td>
                      <td data-label="Min. uitgaand">{fmtMinuten(r.minutesOut)}</td>
                      <td data-label="Totaal minuten">
                        <strong>{fmtMinuten(r.minutesTotaal)}</strong>
                      </td>
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
