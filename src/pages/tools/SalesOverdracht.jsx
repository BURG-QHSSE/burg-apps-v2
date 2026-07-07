import { useState } from 'react'
import { Link } from 'react-router-dom'
import emailjs from '@emailjs/browser'

/**
 * Sales Overdracht — poort van jobpull.html.
 * Formulier waarmee Sales een vacature-overdracht naar de Consultant
 * stuurt via EmailJS. Validatie en veldnamen exact overgenomen uit de
 * bron zodat het bestaande EmailJS-template blijft werken.
 *
 * Tijd-invoer: de bron gebruikt een custom scroll-drum picker (uren/
 * minuten, 5-min stappen, default 08:00). Dat is een vrij fragiele
 * bespoke widget puur voor een leuke interactie — hier gekozen voor een
 * simpele, robuuste `<input type="time">` met dezelfde default (08:00),
 * gestyled met de bestaande text-input-wrap tokens. Functioneel identiek
 * (levert "HH:MM" op), zonder de scroll/snap-fragiliteit.
 */

const EMAILJS_PUBLIC_KEY = 'tojkMyUVtV2ZhNoN9'
const EMAILJS_SERVICE_ID = 'service_tdpa3m9'
const EMAILJS_TEMPLATE_ID = 'template_0re2a5g'
const ONTVANGERS = ['nils.denherder@burgqhsse.nl']

const SENIORITEIT_OPTIES = ['Onboarding', 'Medior', 'Senior']
const TYPE_AFSPRAAK_OPTIES = [
  { value: 'Teams', label: '🖥 Teams' },
  { value: 'Op locatie', label: '📍 Op locatie' },
]
const ZOEKDUUR_OPTIES = [
  'Minder dan 1 maand',
  '1–3 maanden',
  '3–6 maanden',
  'Langer dan 6 maanden',
  'Onbekend',
]

const REQUIRED_KEYS = [
  'sales_naam',
  'bedrijf',
  'functie',
  'senioriteit',
  'gp1',
  'datum',
  'tijd',
  'type_afspraak',
  'beschrijving',
  'zoekduur',
  'bureaus',
  'kandidaten',
  'salaris',
  'voorwaarden',
]

/**
 * Drieledige toggle (Nee/Ja/Onbekend of vergelijkbaar) met semantische
 * kleur per keuze. Groen = gunstig/rustgevend (mos), rood = waarschuwend
 * (brand), amber-achtig = neutraal-onzeker. We hebben bewust geen nieuw
 * amber-token toegevoegd: --blauwgrijs dient hier als neutrale "onbekend"
 * staat, wat binnen het systeem past (signatuurkleur, spaarzaam, hier als
 * accent op een enkele knop i.p.v. als vlak).
 */
function TriToggle({ value, onChange, options }) {
  return (
    <div className="btn-toggle-group">
      {options.map((opt) => {
        const isActive = value === opt.value
        const toneClass = opt.tone ? ` btn-toggle-${opt.tone}` : ''
        return (
          <button
            key={opt.value}
            type="button"
            className={isActive ? `btn-toggle active${toneClass}` : 'btn-toggle'}
            onClick={() => onChange(opt.value)}
          >
            {opt.label ?? opt.value}
          </button>
        )
      })}
    </div>
  )
}

function FormField({ label, required, filled, full, children }) {
  return (
    <div className={full ? 'field-block field-block-full' : 'field-block'}>
      <label className="field-label">
        <span className={filled ? 'required-dot filled' : required ? 'required-dot' : 'required-dot required-dot-hidden'}></span>
        {label}
      </label>
      {children}
    </div>
  )
}

export default function SalesOverdracht() {
  const [salesNaam, setSalesNaam] = useState('')
  const [bedrijf, setBedrijf] = useState('')
  const [functie, setFunctie] = useState('')
  const [senioriteit, setSenioriteit] = useState('')

  const [gp1, setGp1] = useState('')
  const [gp2, setGp2] = useState('')

  const [datum, setDatum] = useState('')
  const [tijd, setTijd] = useState('08:00')
  const [typeAfspraak, setTypeAfspraak] = useState('')
  const [adres, setAdres] = useState('')
  const [auto, setAuto] = useState('')

  const [beschrijving, setBeschrijving] = useState('')
  const [zoekduur, setZoekduur] = useState('')
  const [bureaus, setBureaus] = useState('')
  const [kandidaten, setKandidaten] = useState('')
  const [salaris, setSalaris] = useState('')
  const [voorwaarden, setVoorwaarden] = useState('')
  const [feePct, setFeePct] = useState('')
  const [exclusief, setExclusief] = useState('')
  const [opmerkingen, setOpmerkingen] = useState('')

  const [status, setStatus] = useState('idle') // idle | sending | success | error
  const [errorMessage, setErrorMessage] = useState('')

  const isOpLocatie = typeAfspraak === 'Op locatie'
  const heeftVoorwaarden = voorwaarden === 'Ja'

  async function handleSubmit(e) {
    e.preventDefault()

    const data = {
      sales_naam: salesNaam.trim(),
      bedrijf: bedrijf.trim(),
      functie: functie.trim(),
      senioriteit,
      gp1: gp1.trim(),
      gp2: gp2.trim(),
      datum,
      tijd,
      type_afspraak: typeAfspraak,
      adres: isOpLocatie ? adres.trim() || '—' : '—',
      auto: isOpLocatie ? auto || '—' : '—',
      beschrijving: beschrijving.trim(),
      zoekduur,
      bureaus,
      kandidaten,
      salaris: salaris.trim(),
      voorwaarden,
      fee_pct: heeftVoorwaarden ? feePct.trim() || '—' : '—',
      exclusief: heeftVoorwaarden ? exclusief || '—' : '—',
      opmerkingen: opmerkingen.trim() || '—',
    }

    const missing = REQUIRED_KEYS.filter((key) => !data[key])
    if (isOpLocatie && (!adres.trim() || !auto)) missing.push('locatie')
    if (heeftVoorwaarden && (!feePct.trim() || !exclusief)) missing.push('voorwaarden-details')

    if (missing.length > 0) {
      setStatus('error')
      setErrorMessage('Vul alle verplichte velden in voor je verstuurt.')
      return
    }

    setStatus('sending')
    setErrorMessage('')

    try {
      for (const to of ONTVANGERS) {
        await emailjs.send(
          EMAILJS_SERVICE_ID,
          EMAILJS_TEMPLATE_ID,
          { ...data, to_email: to },
          EMAILJS_PUBLIC_KEY
        )
      }
      setStatus('success')
    } catch (err) {
      console.error(err)
      setStatus('error')
      setErrorMessage('Versturen mislukt. Controleer de EmailJS configuratie.')
    }
  }

  const isSending = status === 'sending'
  const isSuccess = status === 'success'

  return (
    <div className="page">
      <header className="topbar">
        <div>
          <h1>Sales Overdracht</h1>
        </div>
        <div className="topbar-actions">
          <Link to="/" className="btn btn-secondary">
            Terug naar dashboard
          </Link>
        </div>
      </header>

      <main className="page-content page-content-narrow">
        <p className="page-intro">
          Vul alle velden in om de overdracht van Sales naar Consultant te completeren.
        </p>

        <form onSubmit={handleSubmit}>
          <div className="section-card">
            <p className="calc-section-label">Betrokkenen</p>
            <div className="form-grid form-grid-3">
              <FormField label="Sales" required filled={!!salesNaam.trim()}>
                <div className={salesNaam.trim() ? 'text-input-wrap has-input' : 'text-input-wrap needs-input'}>
                  <input
                    type="text"
                    placeholder="Naam Salestijger"
                    value={salesNaam}
                    onChange={(e) => setSalesNaam(e.target.value)}
                  />
                </div>
              </FormField>
              <FormField label="Bedrijfsnaam" required filled={!!bedrijf.trim()}>
                <div className={bedrijf.trim() ? 'text-input-wrap has-input' : 'text-input-wrap needs-input'}>
                  <input
                    type="text"
                    placeholder="Naam opdrachtgever"
                    value={bedrijf}
                    onChange={(e) => setBedrijf(e.target.value)}
                  />
                </div>
              </FormField>
              <FormField label="Functietitel vacature" required filled={!!functie.trim()}>
                <div className={functie.trim() ? 'text-input-wrap has-input' : 'text-input-wrap needs-input'}>
                  <input
                    type="text"
                    placeholder="bijv. QHSSE Manager"
                    value={functie}
                    onChange={(e) => setFunctie(e.target.value)}
                  />
                </div>
              </FormField>
            </div>

            <hr className="section-divider" />

            <FormField label="Geschatte senioriteit" required filled={!!senioriteit}>
              <div className="btn-toggle-group">
                {SENIORITEIT_OPTIES.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    className={senioriteit === opt ? 'btn-toggle active' : 'btn-toggle'}
                    onClick={() => setSenioriteit(opt)}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </FormField>
          </div>

          <div className="section-card">
            <p className="calc-section-label">Gesprekspartners</p>
            <div className="form-grid form-grid-2">
              <FormField label="Gesprekspartner 1 (naam + functie)" required filled={!!gp1.trim()}>
                <div className={gp1.trim() ? 'text-input-wrap has-input' : 'text-input-wrap needs-input'}>
                  <input
                    type="text"
                    placeholder="bijv. Jan de Vries — HR Manager"
                    value={gp1}
                    onChange={(e) => setGp1(e.target.value)}
                  />
                </div>
              </FormField>
              <FormField label="Gesprekspartner 2 (naam + functie)" filled={!!gp2.trim()}>
                <div className="text-input-wrap">
                  <input
                    type="text"
                    placeholder="bijv. Lisa Smit — Directeur"
                    value={gp2}
                    onChange={(e) => setGp2(e.target.value)}
                  />
                </div>
              </FormField>
            </div>
          </div>

          <div className="section-card">
            <p className="calc-section-label">Afspraak</p>
            <div className="form-grid form-grid-3">
              <FormField label="Datum afspraak" required filled={!!datum}>
                <div className={datum ? 'text-input-wrap has-input' : 'text-input-wrap needs-input'}>
                  <input type="date" value={datum} onChange={(e) => setDatum(e.target.value)} />
                </div>
              </FormField>
              <FormField label="Tijd afspraak" required filled={!!tijd}>
                <div className={tijd ? 'text-input-wrap has-input' : 'text-input-wrap needs-input'}>
                  <input type="time" step="300" value={tijd} onChange={(e) => setTijd(e.target.value)} />
                </div>
              </FormField>
              <FormField label="Type afspraak" required filled={!!typeAfspraak}>
                <div className="btn-toggle-group">
                  {TYPE_AFSPRAAK_OPTIES.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      className={typeAfspraak === opt.value ? 'btn-toggle active' : 'btn-toggle'}
                      onClick={() => setTypeAfspraak(opt.value)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </FormField>
            </div>

            {isOpLocatie && (
              <div className="form-grid form-grid-2 conditional-block">
                <FormField label="Exact adres locatie" required filled={!!adres.trim()}>
                  <div className={adres.trim() ? 'text-input-wrap has-input' : 'text-input-wrap needs-input'}>
                    <input
                      type="text"
                      placeholder="Straat 1, 1234 AB Stad"
                      value={adres}
                      onChange={(e) => setAdres(e.target.value)}
                    />
                  </div>
                </FormField>
                <FormField label="Auto gereserveerd?" required filled={!!auto}>
                  <TriToggle
                    value={auto}
                    onChange={setAuto}
                    options={[
                      { value: 'Ja', tone: 'green' },
                      { value: 'Nee', tone: 'red' },
                    ]}
                  />
                </FormField>
              </div>
            )}
          </div>

          <div className="section-card">
            <p className="calc-section-label">Info over de job</p>
            <div className="form-grid form-grid-2">
              <FormField label="Beschrijving van de job" required filled={!!beschrijving.trim()} full>
                <textarea
                  className={beschrijving.trim() ? 'field-textarea has-input' : 'field-textarea needs-input'}
                  placeholder="Geef een korte omschrijving van de rol, context en verwachtingen..."
                  value={beschrijving}
                  onChange={(e) => setBeschrijving(e.target.value)}
                />
              </FormField>

              <FormField label="Hoe lang wordt er al gezocht?" required filled={!!zoekduur}>
                <select
                  className={zoekduur ? 'field-select has-input' : 'field-select needs-input'}
                  value={zoekduur}
                  onChange={(e) => setZoekduur(e.target.value)}
                >
                  <option value="" disabled>
                    Kies een optie
                  </option>
                  {ZOEKDUUR_OPTIES.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </FormField>

              <FormField label="Zijn er andere bureaus ingeschakeld?" required filled={!!bureaus}>
                <TriToggle
                  value={bureaus}
                  onChange={setBureaus}
                  options={[
                    { value: 'Nee', tone: 'green' },
                    { value: 'Ja', tone: 'red' },
                    { value: 'Onbekend', tone: 'neutral' },
                  ]}
                />
              </FormField>

              <FormField label="Zijn er kandidaten in proces?" required filled={!!kandidaten}>
                <TriToggle
                  value={kandidaten}
                  onChange={setKandidaten}
                  options={[
                    { value: 'Nee', tone: 'green' },
                    { value: 'Ja', tone: 'red' },
                    { value: 'Onbekend', tone: 'neutral' },
                  ]}
                />
              </FormField>

              <FormField label="Salarisindicatie" required filled={!!salaris.trim()}>
                <div className={salaris.trim() ? 'text-input-wrap has-input' : 'text-input-wrap needs-input'}>
                  <input
                    type="text"
                    placeholder="bijv. € 4.500 – € 6.000 / mnd"
                    value={salaris}
                    onChange={(e) => setSalaris(e.target.value)}
                  />
                </div>
              </FormField>

              <FormField label="Voorwaarden aanwezig?" required filled={!!voorwaarden}>
                <div className="btn-toggle-group">
                  <button
                    type="button"
                    className={voorwaarden === 'Ja' ? 'btn-toggle active btn-toggle-green' : 'btn-toggle'}
                    onClick={() => setVoorwaarden('Ja')}
                  >
                    Ja
                  </button>
                  <button
                    type="button"
                    className={voorwaarden === 'Nee' ? 'btn-toggle active btn-toggle-red' : 'btn-toggle'}
                    onClick={() => setVoorwaarden('Nee')}
                  >
                    Nee
                  </button>
                </div>
              </FormField>

              {heeftVoorwaarden && (
                <div className="form-grid form-grid-2 conditional-block conditional-block-full">
                  <FormField label="Fee percentage" required filled={!!feePct.trim()}>
                    <div className={feePct.trim() ? 'text-input-wrap has-input' : 'text-input-wrap needs-input'}>
                      <input
                        type="text"
                        placeholder="bijv. 20"
                        inputMode="decimal"
                        value={feePct}
                        onChange={(e) => setFeePct(e.target.value)}
                      />
                      <span className="text-input-suffix">%</span>
                    </div>
                  </FormField>
                  <FormField label="Exclusiviteit" required filled={!!exclusief}>
                    <div className="btn-toggle-group">
                      <button
                        type="button"
                        className={exclusief === 'Exclusief' ? 'btn-toggle active' : 'btn-toggle'}
                        onClick={() => setExclusief('Exclusief')}
                      >
                        Exclusief
                      </button>
                      <button
                        type="button"
                        className={exclusief === 'Niet exclusief' ? 'btn-toggle active' : 'btn-toggle'}
                        onClick={() => setExclusief('Niet exclusief')}
                      >
                        Niet exclusief
                      </button>
                    </div>
                  </FormField>
                </div>
              )}

              <FormField label="Aanvullende opmerkingen (optioneel)" filled={!!opmerkingen.trim()} full>
                <textarea
                  className="field-textarea"
                  placeholder="Overige relevante informatie voor de consultant..."
                  value={opmerkingen}
                  onChange={(e) => setOpmerkingen(e.target.value)}
                />
              </FormField>
            </div>
          </div>

          <div className="section-card submit-card">
            <div className="submit-row">
              <span className="submit-note">Vul alle verplichte velden in</span>
              <button type="submit" className="btn btn-primary" disabled={isSending || isSuccess}>
                {isSuccess ? 'Verstuurd ✓' : isSending ? 'Bezig met versturen...' : 'Overdracht versturen →'}
              </button>
            </div>

            {status === 'sending' && (
              <div className="verdict verdict-idle">Bezig met versturen...</div>
            )}
            {status === 'success' && (
              <div className="verdict verdict-go">
                Overdracht succesvol verstuurd naar alle ontvangers.
              </div>
            )}
            {status === 'error' && (
              <div className="verdict verdict-nogo">{errorMessage}</div>
            )}
          </div>
        </form>
      </main>
    </div>
  )
}
