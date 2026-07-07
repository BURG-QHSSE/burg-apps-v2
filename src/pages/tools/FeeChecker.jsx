import { useState } from 'react'
import { Link } from 'react-router-dom'

/**
 * Fee Checker — poort van calculator.html.
 * Rekenlogica exact overgenomen: basJaar = maand*periodes*(1+vak);
 * bonusAbs = maand*periodes*bonusPct; jaar = basJaar+bonusAbs+lease;
 * fee = jaar*(feePct/100). Go vanaf fee >= 13.500.
 */

const PERIODE_OPTIONS = [12, 13, 14]
const FEE_PCT_OPTIONS = [21, 22, 23, 24, 25, 26]
const DREMPEL = 13500

function fmt(n) {
  return '€ ' + Math.round(n).toLocaleString('nl-NL')
}

export default function FeeChecker() {
  const [maand, setMaand] = useState(4500)
  const [periodes, setPeriodes] = useState(12)
  const [vakPct, setVakPct] = useState(8)
  const [lease, setLease] = useState(false)
  const [bonusPct, setBonusPct] = useState(0)
  const [feePct, setFeePct] = useState(21)

  const vak = vakPct / 100
  const leaseBedrag = lease ? 6000 : 0
  const bonusFractie = bonusPct / 100

  const basJaar = maand * periodes * (1 + vak)
  const bonusAbs = maand * periodes * bonusFractie
  const jaar = basJaar + bonusAbs + leaseBedrag
  const fee = jaar * (feePct / 100)
  const isGo = fee >= DREMPEL

  return (
    <div className="page">
      <header className="topbar">
        <div>
          <h1>Fee Checker</h1>
        </div>
        <div className="topbar-actions">
          <Link to="/" className="btn btn-secondary">
            Terug naar dashboard
          </Link>
        </div>
      </header>

      <main className="page-content">
        <div className="metric-grid">
          <div className="metric-card">
            <span className="metric-card-label">Maandsalaris</span>
            <span className="metric-card-value">{fmt(maand)}</span>
          </div>
          <div className="metric-card">
            <span className="metric-card-label">Bruto jaarsalaris</span>
            <span className="metric-card-value">{fmt(jaar)}</span>
          </div>
          <div className="metric-card metric-card-accent">
            <span className="metric-card-label">Fee</span>
            <span className="metric-card-value">{fmt(fee)}</span>
          </div>
          <div className="metric-card">
            <span className="metric-card-label">Fee percentage</span>
            <span className="metric-card-value">{feePct}%</span>
          </div>
        </div>

        <div className="calc-columns">
          <div className="calc-section">
            <div className="control-row">
              <span className="control-label">Maandsalaris</span>
              <div className="control-input">
                <input
                  type="range"
                  className="slider"
                  min={2000}
                  max={12000}
                  step={100}
                  value={maand}
                  onChange={(e) => setMaand(Number(e.target.value))}
                />
                <span className="control-input-value">{fmt(maand)}</span>
              </div>
            </div>

            <div className="control-row">
              <span className="control-label">Periodes</span>
              <div className="btn-group">
                {PERIODE_OPTIONS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={periodes === n ? 'btn-group-btn active' : 'btn-group-btn'}
                    onClick={() => setPeriodes(n)}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            <div className="control-row">
              <span className="control-label">Vakantiegeld</span>
              <div className="control-input">
                <input
                  type="range"
                  className="slider"
                  min={0}
                  max={8}
                  step={1}
                  value={vakPct}
                  onChange={(e) => setVakPct(Number(e.target.value))}
                />
                <span className="control-input-value">{vakPct}%</span>
              </div>
            </div>
          </div>

          <div className="calc-section">
            <div className="control-row">
              <span className="control-label">Leaseauto</span>
              <div className="toggle-wrap">
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={lease}
                    onChange={(e) => setLease(e.target.checked)}
                  />
                  <div className="toggle-track"></div>
                  <div className="toggle-thumb"></div>
                </label>
                <span className="toggle-val">
                  {lease ? 'Ja — € 6.000' : 'Nee — € 0'}
                </span>
              </div>
            </div>

            <div className="control-row">
              <span className="control-label">Bonus</span>
              <div className="control-input">
                <input
                  type="range"
                  className="slider"
                  min={0}
                  max={10}
                  step={1}
                  value={bonusPct}
                  onChange={(e) => setBonusPct(Number(e.target.value))}
                />
                <span className="control-input-value">{bonusPct}%</span>
              </div>
            </div>

            <div className="control-row">
              <span className="control-label">Fee percentage</span>
              <div className="btn-group">
                {FEE_PCT_OPTIONS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={feePct === n ? 'btn-group-btn active' : 'btn-group-btn'}
                    onClick={() => setFeePct(n)}
                  >
                    {n}%
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className={isGo ? 'verdict verdict-go' : 'verdict verdict-nogo'}>
          {isGo
            ? `Go — fee boven minimumdrempel van ${fmt(DREMPEL)}`
            : `No-go — fee komt niet boven ${fmt(DREMPEL)}`}
        </div>
        <p className="drempel-note">
          Minimumdrempel: {fmt(DREMPEL)} · No-go onder {fmt(DREMPEL)} fee · Bonus exclusief vakantiegeld
        </p>
      </main>
    </div>
  )
}
