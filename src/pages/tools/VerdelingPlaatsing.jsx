import { useState } from 'react'
import { Link } from 'react-router-dom'
import { jsPDF } from 'jspdf'

/**
 * Verdeling Plaatsing — poort van plaatsing-verdeling.html
 * ("Provisie Calculator W&S Plaatsing").
 *
 * Rekenlogica exact overgenomen uit de bron-calc():
 * - Bruto aandelen: Sales 30%, Recruiter 30%, Consultant 40% van dealwaarde.
 * - Onboarding: 20% van eigen bruto-aandeel wordt afgedragen. Sales' afdracht
 *   gaat naar "Head of Sales"; Recruiter's én Consultant's afdrachten gaan
 *   beide naar "Head of Recruitment" (samengevoegd tot één rij als beide
 *   van toepassing zijn).
 * - Netto per persoon = bruto - eigen afdracht.
 * - Aanbetaling (indien aan) wordt 50/50 verdeeld tussen Sales en
 *   Consultant (Recruiter krijgt niets) en telt als "al ontvangen".
 * - Restant per persoon/head-of = netto - al ontvangen.
 * - Percentage-basis: totaal restant (als er een aanbetaling is) of de
 *   volledige dealwaarde (als er geen aanbetaling is).
 */

const AANBETALING_OPTIES = [2500, 5000, 10000]

function parseDutch(str) {
  return parseFloat((str || '').replace(/\./g, '').replace(',', '.')) || 0
}

function fmt(n) {
  return '€ ' + Math.round(n).toLocaleString('nl-NL')
}

function fmtPct(n) {
  return (Math.round(n * 10) / 10).toLocaleString('nl-NL') + '%'
}

/**
 * Bouwt een PDF-samenvatting van de verdeling (voor bijlage in Bullhorn) en
 * downloadt hem direct naar de downloadsmap van de browser, via jsPDF's
 * ingebouwde .save() — dit opent geen printdialoog, het is een echt
 * PDF-bestand.
 */
function printForBullhorn(uitkomst) {
  if (!uitkomst) return

  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const marginX = 48
  let y = 56

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.text('Verdeling Plaatsing', marginX, y)
  y += 20

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(110, 110, 110)
  doc.text(new Date().toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' }), marginX, y)
  y += 28

  doc.setTextColor(20, 20, 20)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('Dealwaarde', marginX, y)
  doc.text(fmt(uitkomst.deal), 400, y)
  y += 16
  doc.setFont('helvetica', 'normal')
  doc.text('Aanbetaling', marginX, y)
  doc.text(uitkomst.aanbetaling > 0 ? fmt(uitkomst.aanbetaling) : '—', 400, y)
  y += 16
  doc.text('Nog te betalen', marginX, y)
  doc.text(fmt(uitkomst.totaalRestant), 400, y)
  y += 28

  doc.setDrawColor(210, 210, 210)
  doc.line(marginX, y, 547, y)
  y += 24

  const rowLine = (naam, subLabel, pctLabel, bedragLabel, restantLabel) => {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.text(naam, marginX, y)
    doc.text(pctLabel, 500, y, { align: 'right' })
    y += 14
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(110, 110, 110)
    if (subLabel) doc.text(subLabel, marginX, y)
    doc.text(bedragLabel, 500, y, { align: 'right' })
    y += 12
    doc.text(restantLabel, 500, y, { align: 'right' })
    doc.setTextColor(20, 20, 20)
    y += 22
  }

  uitkomst.personen.forEach((p) => {
    const pct = fmtPct((p.restant / uitkomst.pctBasis) * 100)
    const subParts = []
    if (p.onboarding) subParts.push(p.afdrachtLabel)
    if (uitkomst.aanbetaling > 0 && p.al > 0) subParts.push('al ontvangen: ' + fmt(p.al))
    const subLabel = p.rol + (subParts.length > 0 ? ' · ' + subParts.join(' · ') : '')
    rowLine(p.naam + (p.onboarding ? ' (onboarding)' : ''), subLabel, pct, fmt(p.netto) + ' totaal', '+ ' + fmt(p.restant) + ' te ontvangen')
  })

  uitkomst.headRows.forEach((h) => {
    const pct = fmtPct((h.bedrag / uitkomst.pctBasis) * 100)
    rowLine(h.naam, h.omschrijving, pct, '', '+ ' + fmt(h.bedrag) + ' te ontvangen')
  })

  y += 6
  doc.setDrawColor(210, 210, 210)
  doc.line(marginX, y, 547, y)
  y += 20

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  if (uitkomst.aanbetaling > 0) {
    doc.text('Aanbetaling (al voldaan)', marginX, y)
    doc.text(fmt(uitkomst.aanbetaling), 500, y, { align: 'right' })
    y += 16
  }
  doc.text('Nog te betalen', marginX, y)
  doc.text(fmt(uitkomst.totaalRestant), 500, y, { align: 'right' })
  y += 16
  doc.text('Dealwaarde totaal', marginX, y)
  doc.text(fmt(uitkomst.deal), 500, y, { align: 'right' })

  const datumSlug = new Date().toISOString().slice(0, 10)
  doc.save(`verdeling-plaatsing-${datumSlug}.pdf`)
}

function ResultRow({ naam, rol, netto, al, restant, onboarding, afdrachtLabel, heeftAanbetaling, pctBasis }) {
  const heeftAl = heeftAanbetaling && al > 0
  const subParts = []
  if (onboarding) subParts.push(afdrachtLabel)
  if (heeftAl) subParts.push('al ontvangen: ' + fmt(al))
  const pct = fmtPct((restant / pctBasis) * 100)

  return (
    <div className="result-row">
      <div className="result-left">
        <div className="result-name">
          {naam}
          {onboarding && <span className="badge-onboarding">onboarding</span>}
        </div>
        <div className="result-sub">
          {rol}
          {subParts.length > 0 ? ' · ' + subParts.join(' · ') : ''}
        </div>
      </div>
      <div className="result-right">
        <div className="result-pct">{pct}</div>
        <div className="result-amount">{fmt(netto)} totaal</div>
        <div className="result-restant">+ {fmt(restant)} te ontvangen</div>
      </div>
    </div>
  )
}

function HeadRow({ naam, bedrag, omschrijving, pctBasis }) {
  return (
    <div className="result-row result-row-head">
      <div className="result-left">
        <div className="result-name">{naam}</div>
        <div className="result-sub">{omschrijving}</div>
      </div>
      <div className="result-right">
        <div className="result-pct">{fmtPct((bedrag / pctBasis) * 100)}</div>
        <div className="result-restant">+ {fmt(bedrag)} te ontvangen</div>
      </div>
    </div>
  )
}

export default function VerdelingPlaatsing() {
  const [dealStr, setDealStr] = useState('')
  const [heeftAanbetaling, setHeeftAanbetaling] = useState(false)
  const [aanbetalingBedrag, setAanbetalingBedrag] = useState(5000)

  const [salesNaam, setSalesNaam] = useState('')
  const [recNaam, setRecNaam] = useState('')
  const [conNaam, setConNaam] = useState('')
  const [obSales, setObSales] = useState(false)
  const [obRec, setObRec] = useState(false)
  const [obCon, setObCon] = useState(false)

  const deal = parseDutch(dealStr)
  const aanbetaling = heeftAanbetaling ? aanbetalingBedrag : 0

  const dealGevuld = deal > 0
  const namenGevuld =
    salesNaam.trim().length > 0 && recNaam.trim().length > 0 && conNaam.trim().length > 0
  const allesGevuld = dealGevuld && namenGevuld

  function toggleAanbetaling(checked) {
    setHeeftAanbetaling(checked)
  }

  let body
  let uitkomst = null

  if (!dealGevuld) {
    body = <div className="idle-state">Vul een dealwaarde in om de verdeling te berekenen</div>
  } else {
    // Bruto aandelen
    const salesBruto = deal * 0.3
    const recBruto = deal * 0.3
    const conBruto = deal * 0.4

    // Onboarding afdrachten
    const salesAfdracht = obSales ? salesBruto * 0.2 : 0
    const recAfdracht = obRec ? recBruto * 0.2 : 0
    const conAfdracht = obCon ? conBruto * 0.2 : 0

    // Netto per persoon
    const salesNetto = salesBruto - salesAfdracht
    const recNetto = recBruto - recAfdracht
    const conNetto = conBruto - conAfdracht

    // Aanbetaling verdeling
    const salesAl = aanbetaling > 0 ? aanbetaling * 0.5 : 0
    const conAl = aanbetaling > 0 ? aanbetaling * 0.5 : 0
    const recAl = 0

    // Nog te ontvangen
    const salesRestant = salesNetto - salesAl
    const recRestant = recNetto - recAl
    const conRestant = conNetto - conAl

    // Head of
    const headSalesBedrag = salesAfdracht
    const headRecBedrag = recAfdracht + conAfdracht

    const totaalRestant = salesRestant + recRestant + conRestant + headSalesBedrag + headRecBedrag

    // Basis voor percentage: restant bij aanbetaling, totaal zonder
    const pctBasis = aanbetaling > 0 ? totaalRestant : deal

    const salesLabel = salesNaam || 'Sales officer'
    const recLabel = recNaam || 'Recruiter'
    const conLabel = conNaam || 'Consultant'

    const headRecParts = []
    if (recAfdracht > 0) headRecParts.push(recLabel)
    if (conAfdracht > 0) headRecParts.push(conLabel)

    uitkomst = {
      deal,
      aanbetaling,
      totaalRestant,
      pctBasis,
      personen: [
        {
          naam: salesLabel,
          rol: 'Sales officer',
          netto: salesNetto,
          al: salesAl,
          restant: salesRestant,
          onboarding: obSales,
          afdrachtLabel: '20% → Head of Sales',
        },
        {
          naam: recLabel,
          rol: 'Recruiter',
          netto: recNetto,
          al: recAl,
          restant: recRestant,
          onboarding: obRec,
          afdrachtLabel: '20% → Head of Recruitment',
        },
        {
          naam: conLabel,
          rol: 'Consultant',
          netto: conNetto,
          al: conAl,
          restant: conRestant,
          onboarding: obCon,
          afdrachtLabel: '20% → Head of Recruitment',
        },
      ],
      headRows: [
        ...(headSalesBedrag > 0
          ? [{ naam: 'Head of Sales', bedrag: headSalesBedrag, omschrijving: 'Onboarding afdracht van ' + salesLabel }]
          : []),
        ...(headRecBedrag > 0
          ? [
              {
                naam: 'Head of Recruitment',
                bedrag: headRecBedrag,
                omschrijving: 'Onboarding afdracht van ' + headRecParts.join(' & '),
              },
            ]
          : []),
      ],
    }

    body = (
      <>
        <div className="metric-grid">
          <div className="metric-card">
            <span className="metric-card-label">Dealwaarde</span>
            <span className="metric-card-value">{fmt(deal)}</span>
          </div>
          <div className="metric-card">
            <span className="metric-card-label">Aanbetaling</span>
            <span className="metric-card-value">{aanbetaling > 0 ? fmt(aanbetaling) : '—'}</span>
          </div>
          <div className="metric-card">
            <span className="metric-card-label">Al voldaan</span>
            <span className="metric-card-value">{aanbetaling > 0 ? fmt(aanbetaling) : fmt(0)}</span>
          </div>
          <div className="metric-card metric-card-accent">
            <span className="metric-card-label">Nog te betalen</span>
            <span className="metric-card-value">{fmt(totaalRestant)}</span>
          </div>
        </div>

        <div className="results-list">
          <ResultRow
            naam={salesLabel}
            rol="Sales officer"
            netto={salesNetto}
            al={salesAl}
            restant={salesRestant}
            onboarding={obSales}
            afdrachtLabel="20% → Head of Sales"
            heeftAanbetaling={aanbetaling > 0}
            pctBasis={pctBasis}
          />
          <ResultRow
            naam={recLabel}
            rol="Recruiter"
            netto={recNetto}
            al={recAl}
            restant={recRestant}
            onboarding={obRec}
            afdrachtLabel="20% → Head of Recruitment"
            heeftAanbetaling={aanbetaling > 0}
            pctBasis={pctBasis}
          />
          <ResultRow
            naam={conLabel}
            rol="Consultant"
            netto={conNetto}
            al={conAl}
            restant={conRestant}
            onboarding={obCon}
            afdrachtLabel="20% → Head of Recruitment"
            heeftAanbetaling={aanbetaling > 0}
            pctBasis={pctBasis}
          />

          {headSalesBedrag > 0 && (
            <HeadRow
              naam="Head of Sales"
              bedrag={headSalesBedrag}
              omschrijving={'Onboarding afdracht van ' + salesLabel}
              pctBasis={pctBasis}
            />
          )}
          {headRecBedrag > 0 && (
            <HeadRow
              naam="Head of Recruitment"
              bedrag={headRecBedrag}
              omschrijving={'Onboarding afdracht van ' + headRecParts.join(' & ')}
              pctBasis={pctBasis}
            />
          )}

          <div className="totaal-block">
            {aanbetaling > 0 && (
              <div className="totaal-row">
                <span>Aanbetaling (al voldaan)</span>
                <strong>{fmt(aanbetaling)}</strong>
              </div>
            )}
            <div className="totaal-row">
              <span>Nog te betalen</span>
              <strong>{fmt(totaalRestant)}</strong>
            </div>
            <div className="totaal-row">
              <span>Dealwaarde totaal</span>
              <strong>{fmt(deal)}</strong>
            </div>
          </div>

          <div className="print-bullhorn-row">
            <button type="button" className="btn btn-secondary" onClick={() => printForBullhorn(uitkomst)}>
              Print for Bullhorn
            </button>
          </div>
        </div>
      </>
    )
  }

  return (
    <div className="page">
      <header className="topbar">
        <div>
          <h1>Verdeling Plaatsing</h1>
        </div>
        <div className="topbar-actions">
          <Link to="/" className="btn btn-secondary">
            Terug naar dashboard
          </Link>
        </div>
      </header>

      <main className="page-content">
        <div className={allesGevuld ? 'required-banner hidden' : 'required-banner'}>
          <span className="required-banner-dot"></span>
          Vul dealwaarde én alle namen in om de verdeling te berekenen
        </div>

        <div className="calc-columns">
          <div className="calc-section">
            <p className="calc-section-label">Plaatsing</p>

            <div className="control-row">
              <span className="control-label">
                <span className={dealGevuld ? 'required-dot filled' : 'required-dot'}></span>
                Dealwaarde (excl. BTW)
              </span>
              <div className={dealGevuld ? 'text-input-wrap has-input' : 'text-input-wrap needs-input'}>
                <span className="text-input-prefix">€</span>
                <input
                  type="text"
                  placeholder="bijv. 15.000"
                  inputMode="decimal"
                  value={dealStr}
                  onChange={(e) => setDealStr(e.target.value)}
                />
              </div>
            </div>

            <div className="control-row">
              <span className="control-label">Aanbetaling</span>
              <div className="toggle-wrap">
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={heeftAanbetaling}
                    onChange={(e) => toggleAanbetaling(e.target.checked)}
                  />
                  <div className="toggle-track"></div>
                  <div className="toggle-thumb"></div>
                </label>
                <span className="toggle-val">
                  {heeftAanbetaling ? `Ja — ${fmt(aanbetalingBedrag)}` : 'Nee — € 0'}
                </span>
              </div>

              {heeftAanbetaling && (
                <div className="aanbetaling-options">
                  {AANBETALING_OPTIES.map((bedrag) => (
                    <button
                      key={bedrag}
                      type="button"
                      className={aanbetalingBedrag === bedrag ? 'btn-group-btn active' : 'btn-group-btn'}
                      onClick={() => setAanbetalingBedrag(bedrag)}
                    >
                      {fmt(bedrag)}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <p className="calc-section-label" style={{ marginTop: 'var(--space-5)' }}>
              <span className={salesNaam.trim() ? 'required-dot filled' : 'required-dot'}></span>{' '}
              Sales officer
            </p>
            <div className="person-block">
              <div className={salesNaam.trim() ? 'text-input-wrap has-input' : 'text-input-wrap needs-input'}>
                <input
                  type="text"
                  placeholder="Naam"
                  value={salesNaam}
                  onChange={(e) => setSalesNaam(e.target.value)}
                />
              </div>
              <div className="onboarding-row">
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={obSales}
                    onChange={(e) => setObSales(e.target.checked)}
                  />
                  <div className="toggle-track"></div>
                  <div className="toggle-thumb"></div>
                </label>
                <span className="onboarding-label">In onboarding → 20% naar Head of Sales</span>
              </div>
            </div>
          </div>

          <div className="calc-section">
            <p className="calc-section-label">
              <span className={recNaam.trim() ? 'required-dot filled' : 'required-dot'}></span>{' '}
              Recruiter
            </p>
            <div className="person-block">
              <div className={recNaam.trim() ? 'text-input-wrap has-input' : 'text-input-wrap needs-input'}>
                <input
                  type="text"
                  placeholder="Naam"
                  value={recNaam}
                  onChange={(e) => setRecNaam(e.target.value)}
                />
              </div>
              <div className="onboarding-row">
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={obRec}
                    onChange={(e) => setObRec(e.target.checked)}
                  />
                  <div className="toggle-track"></div>
                  <div className="toggle-thumb"></div>
                </label>
                <span className="onboarding-label">In onboarding → 20% naar Head of Recruitment</span>
              </div>
            </div>

            <p className="calc-section-label">
              <span className={conNaam.trim() ? 'required-dot filled' : 'required-dot'}></span>{' '}
              Consultant
            </p>
            <div className="person-block">
              <div className={conNaam.trim() ? 'text-input-wrap has-input' : 'text-input-wrap needs-input'}>
                <input
                  type="text"
                  placeholder="Naam"
                  value={conNaam}
                  onChange={(e) => setConNaam(e.target.value)}
                />
              </div>
              <div className="onboarding-row">
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={obCon}
                    onChange={(e) => setObCon(e.target.checked)}
                  />
                  <div className="toggle-track"></div>
                  <div className="toggle-thumb"></div>
                </label>
                <span className="onboarding-label">In onboarding → 20% naar Head of Recruitment</span>
              </div>
            </div>
          </div>
        </div>

        {body}
      </main>
    </div>
  )
}
