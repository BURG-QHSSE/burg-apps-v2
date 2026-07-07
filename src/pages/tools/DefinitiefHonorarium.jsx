import { useState } from 'react'
import { Link } from 'react-router-dom'

/**
 * Definitief Honorarium — poort van plaatsing.html ("Honorarium tool").
 * Rekenlogica exact overgenomen: basJaar = maand*periodes*(1+vak);
 * bonusAbs = maand*periodes*bonusPct; jaar = basJaar+bonusAbs+lease;
 * fee = jaar*(feePct/100). Go vanaf fee >= 13.500.
 * Maandsalaris en fee percentage zijn vrije-tekst velden (NL-notatie,
 * bijv. "5.250") en zijn verplicht voordat er een resultaat verschijnt.
 */

const PERIODE_OPTIONS = [12, 13, 14]
const DREMPEL = 13500

function parseDutch(str) {
  return parseFloat((str || '').replace(/\./g, '').replace(',', '.')) || 0
}

function fmt(n) {
  return '€ ' + Math.round(n).toLocaleString('nl-NL')
}

function fmtFeePct(n) {
  return n.toFixed(1).replace('.', ',') + '%'
}

function fmtBonusPct(bonusFractie) {
  const pct = bonusFractie * 100
  return pct % 1 === 0 ? pct.toFixed(0) + '%' : pct.toFixed(1).replace('.', ',') + '%'
}

export default function DefinitiefHonorarium() {
  const [maandStr, setMaandStr] = useState('')
  const [feePctStr, setFeePctStr] = useState('')
  const [periodes, setPeriodes] = useState(12)
  const [vakAan, setVakAan] = useState(true)
  const [lease, setLease] = useState(false)
  const [bonusPct, setBonusPct] = useState(0)

  const maand = parseDutch(maandStr)
  const feePct = parseDutch(feePctStr)
  const vak = vakAan ? 0.08 : 0
  const leaseBedrag = lease ? 6000 : 0
  const bonusFractie = bonusPct / 100

  const maandGevuld = maand > 0
  const feeGevuld = feePct > 0
  const allesGevuld = maandGevuld && feeGevuld

  const basJaar = maand * periodes * (1 + vak)
  const bonusAbs = maand * periodes * bonusFractie
  const jaar = basJaar + bonusAbs + leaseBedrag
  const fee = jaar * (feePct / 100)
  const isGo = fee >= DREMPEL

  return (
    <div className="page">
      <header className="topbar">
        <div>
          <h1>Definitief Honorarium</h1>
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
            <span className="metric-card-label">Bruto jaarsalaris</span>
            <span className="metric-card-value">{allesGevuld ? fmt(jaar) : '—'}</span>
          </div>
          <div className="metric-card">
            <span className="metric-card-label">Fee percentage</span>
            <span className="metric-card-value">{allesGevuld ? fmtFeePct(feePct) : '—'}</span>
          </div>
          <div className="metric-card metric-card-accent">
            <span className="metric-card-label">Honorarium</span>
            <span className="metric-card-value">{allesGevuld ? fmt(fee) : '—'}</span>
          </div>
        </div>

        <div className={allesGevuld ? 'required-banner hidden' : 'required-banner'}>
          <span className="required-banner-dot"></span>
          Vul maandsalaris én fee percentage in om te berekenen
        </div>

        <div className="calc-columns">
          <div className="calc-section">
            <div className="control-row">
              <span className="control-label">
                <span className={maandGevuld ? 'required-dot filled' : 'required-dot'}></span>
                Maandsalaris
              </span>
              <div className={maandGevuld ? 'text-input-wrap has-input' : 'text-input-wrap needs-input'}>
                <span className="text-input-prefix">€</span>
                <input
                  type="text"
                  placeholder="bijv. 5.250"
                  inputMode="decimal"
                  value={maandStr}
                  onChange={(e) => setMaandStr(e.target.value)}
                />
                <span className="text-input-suffix">/ mnd</span>
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
              <div className="toggle-wrap">
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={vakAan}
                    onChange={(e) => setVakAan(e.target.checked)}
                  />
                  <div className="toggle-track"></div>
                  <div className="toggle-thumb"></div>
                </label>
                <span className="toggle-val">{vakAan ? 'Ja — 8%' : 'Nee — 0%'}</span>
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
                  step={0.5}
                  value={bonusPct}
                  onChange={(e) => setBonusPct(Number(e.target.value))}
                />
                <span className="control-input-value">{fmtBonusPct(bonusFractie)}</span>
              </div>
            </div>

            <div className="control-row">
              <span className="control-label">
                <span className={feeGevuld ? 'required-dot filled' : 'required-dot'}></span>
                Fee percentage
              </span>
              <div className={feeGevuld ? 'text-input-wrap has-input' : 'text-input-wrap needs-input'}>
                <input
                  type="text"
                  placeholder="bijv. 23"
                  inputMode="decimal"
                  style={{ textAlign: 'center' }}
                  value={feePctStr}
                  onChange={(e) => setFeePctStr(e.target.value)}
                />
                <span className="text-input-suffix">%</span>
              </div>
            </div>
          </div>
        </div>

        {allesGevuld ? (
          <div className={isGo ? 'verdict verdict-go' : 'verdict verdict-nogo'}>
            {isGo
              ? `Go — honorarium boven minimumdrempel van ${fmt(DREMPEL)}`
              : `No-go — honorarium komt niet boven ${fmt(DREMPEL)}`}
          </div>
        ) : (
          <div className="verdict verdict-idle">
            Vul de oranje velden in om het honorarium te berekenen
          </div>
        )}
        <p className="drempel-note">
          Minimumdrempel: {fmt(DREMPEL)} · Bonus exclusief vakantiegeld · Leaseauto +€ 6.000
        </p>
      </main>
    </div>
  )
}
