import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { maakStrategie, slaOpdrachtOp, fetchRecenteOpdrachten } from '../../lib/externZoekenApi'
import OpdrachtVoorClaude from './extern-zoeken/OpdrachtVoorClaude'

/**
 * Extern Zoeken — externe search via LinkedIn Recruiter (tegenhanger van de
 * Kandidaat Matcher). Stap 1: vacature → zoekopdracht, die de consultant hier
 * controleert en aanpast. Stap 2: "Klaar voor Claude" slaat de opdracht op en
 * opent de opdrachtpagina (?opdracht=<id>), die Claude in Chrome uitvoert in
 * Recruiter — zie extern-zoeken/OpdrachtVoorClaude.jsx.
 */

// Lijstvelden worden als "één per regel" bewerkt.
const LIJST_VELDEN = [
  { key: 'vaardigheden', label: 'Vaardigheden (één per regel)' },
  { key: 'uitsluiten_huidige_bedrijven', label: 'Huidige werkgever uitsluiten (één per regel)' },
  { key: 'harde_eisen', label: 'Harde eisen (voor het scoren)' },
  { key: 'pluspunten', label: 'Pluspunten' },
  { key: 'knock_outs', label: 'Knock-outs' },
]

const naarRegels = (lijst) => (lijst ?? []).join('\n')
const naarLijst = (tekst) =>
  tekst
    .split('\n')
    .map((r) => r.trim())
    .filter(Boolean)

export default function ExternZoeken() {
  const [vacatureId, setVacatureId] = useState('')
  const [vacaturetekst, setVacaturetekst] = useState('')
  const [strategie, setStrategie] = useState(null)
  const [bezig, setBezig] = useState(false)
  const [fout, setFout] = useState('')
  const [gekopieerd, setGekopieerd] = useState(false)
  const [searchParams, setSearchParams] = useSearchParams()
  const opdrachtId = searchParams.get('opdracht')
  const [recent, setRecent] = useState([])

  useEffect(() => {
    if (opdrachtId) return
    fetchRecenteOpdrachten()
      .then(setRecent)
      .catch(() => setRecent([]))
  }, [opdrachtId])

  async function handleKlaarVoorClaude() {
    setFout('')
    try {
      const id = await slaOpdrachtOp(vacatureId.trim(), vacaturetekst.trim(), strategie)
      setSearchParams({ opdracht: id })
    } catch (err) {
      setFout(err.message)
    }
  }

  async function handleMaak() {
    setBezig(true)
    setFout('')
    try {
      setStrategie(await maakStrategie(vacatureId.trim(), vacaturetekst.trim()))
    } catch (err) {
      setFout(err.message)
    } finally {
      setBezig(false)
    }
  }

  const zet = (key, waarde) => setStrategie((s) => ({ ...s, [key]: waarde }))

  async function handleKopieer() {
    await navigator.clipboard.writeText(JSON.stringify({ vacatureId: vacatureId.trim(), ...strategie }, null, 2))
    setGekopieerd(true)
    setTimeout(() => setGekopieerd(false), 2000)
  }

  return (
    <div className="page">
      <header className="topbar">
        <div>
          <h1>Extern Zoeken</h1>
        </div>
        <div className="topbar-actions">
          <Link to="/" className="btn btn-secondary">
            Terug naar dashboard
          </Link>
        </div>
      </header>
      <main className="page-content">
        {opdrachtId ? (
          <>
            <p>
              <Link to="/tools/extern-zoeken">← Nieuwe zoekopdracht</Link>
            </p>
            <OpdrachtVoorClaude opdrachtId={opdrachtId} />
          </>
        ) : (
          <>
        <p className="page-intro">
          Plak de vacature en laat de zoekopdracht voor LinkedIn Recruiter opstellen. Controleer en verbeter de boolean
          en filters; daarna voert Claude in Chrome de search uit in Recruiter.
        </p>

        {fout && <p className="form-error">{fout}</p>}

        {recent.length > 0 && (
          <section className="matcher-setup">
            <h2>Recente opdrachten</h2>
            <ul>
              {recent.map((o) => (
                <li key={o.id}>
                  <Link to={`/tools/extern-zoeken?opdracht=${o.id}`}>{o.strategie?.projectnaam ?? o.vacature_id}</Link>{' '}
                  — {o.status}
                  {o.voortgang && <> · {o.voortgang}</>}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="matcher-setup">
          <div className="field">
            <label htmlFor="extern-vacature-id">Vacature-ID</label>
            <input
              id="extern-vacature-id"
              type="text"
              inputMode="numeric"
              placeholder="Bijv. 23300"
              value={vacatureId}
              onChange={(e) => setVacatureId(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="extern-vacature">Vacaturetekst</label>
            <textarea
              id="extern-vacature"
              className="matcher-textarea"
              rows={10}
              placeholder="Plak hier de vacaturetekst…"
              value={vacaturetekst}
              onChange={(e) => setVacaturetekst(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!vacaturetekst.trim() || bezig}
            onClick={handleMaak}
          >
            {bezig ? 'Bezig…' : strategie ? 'Opnieuw opstellen' : 'Zoekopdracht opstellen'}
          </button>
        </section>

        {strategie && (
          <section className="matcher-setup">
            <h2>Zoekopdracht</h2>
            {strategie.toelichting && <p className="page-intro">{strategie.toelichting}</p>}

            <div className="field">
              <label htmlFor="extern-projectnaam">Projectnaam in Recruiter</label>
              <input
                id="extern-projectnaam"
                type="text"
                value={strategie.projectnaam}
                onChange={(e) => zet('projectnaam', e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="extern-titels">Functietitels (boolean)</label>
              <textarea
                id="extern-titels"
                className="matcher-textarea"
                rows={3}
                value={strategie.functietitels_boolean}
                onChange={(e) => zet('functietitels_boolean', e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="extern-trefwoorden">Trefwoorden (boolean)</label>
              <textarea
                id="extern-trefwoorden"
                className="matcher-textarea"
                rows={2}
                value={strategie.trefwoorden_boolean}
                onChange={(e) => zet('trefwoorden_boolean', e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="extern-postcode">
                Locatie: postcode van de vestiging{strategie.vestigingsplaats && ` (${strategie.vestigingsplaats})`} + straal in km
              </label>
              <div className="matcher-upload-row">
                <input
                  id="extern-postcode"
                  type="text"
                  placeholder="Bijv. 3011 AB"
                  value={strategie.postcode ?? ''}
                  onChange={(e) => zet('postcode', e.target.value)}
                />
                <input
                  aria-label="Straal in km"
                  type="number"
                  min={1}
                  value={strategie.straal_km ?? 40}
                  onChange={(e) => zet('straal_km', Number(e.target.value))}
                />
              </div>
              {!strategie.postcode?.trim() && (
                <p className="form-error">Postcode staat niet in de vacaturetekst — vul hem zelf in.</p>
              )}
            </div>
            <div className="field">
              <label htmlFor="extern-jaren-min">Jaren ervaring (min – max)</label>
              <div className="matcher-upload-row">
                <input
                  id="extern-jaren-min"
                  type="number"
                  min={0}
                  value={strategie.jaren_ervaring_min ?? ''}
                  onChange={(e) => zet('jaren_ervaring_min', e.target.value === '' ? 0 : Number(e.target.value))}
                />
                <input
                  aria-label="Jaren ervaring maximum"
                  type="number"
                  min={0}
                  placeholder="geen max"
                  value={strategie.jaren_ervaring_max ?? ''}
                  onChange={(e) => zet('jaren_ervaring_max', e.target.value === '' ? null : Number(e.target.value))}
                />
              </div>
            </div>
            {LIJST_VELDEN.map(({ key, label }) => (
              <div className="field" key={key}>
                <label htmlFor={`extern-${key}`}>{label}</label>
                <textarea
                  id={`extern-${key}`}
                  className="matcher-textarea"
                  rows={Math.max(2, (strategie[key]?.length ?? 0) + 1)}
                  value={naarRegels(strategie[key])}
                  onChange={(e) => zet(key, naarLijst(e.target.value))}
                />
              </div>
            ))}
            <div className="field">
              <label htmlFor="extern-ideaal">Ideaal profiel</label>
              <textarea
                id="extern-ideaal"
                className="matcher-textarea"
                rows={4}
                value={strategie.ideaal_profiel}
                onChange={(e) => zet('ideaal_profiel', e.target.value)}
              />
            </div>
            <div className="field">
              <label>
                <input
                  type="checkbox"
                  checked={strategie.engels_vereist}
                  onChange={(e) => zet('engels_vereist', e.target.checked)}
                />{' '}
                Engels vereist
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={strategie.nederlands_vereist}
                  onChange={(e) => zet('nederlands_vereist', e.target.checked)}
                />{' '}
                Nederlands vereist
              </label>
            </div>

            <div className="matcher-upload-row">
              <button
                type="button"
                className="btn btn-primary"
                disabled={!strategie.postcode?.trim()}
                onClick={handleKlaarVoorClaude}
              >
                Klaar voor Claude
              </button>
              <button type="button" className="btn btn-secondary" onClick={handleKopieer}>
                {gekopieerd ? 'Gekopieerd' : 'Kopieer zoekopdracht'}
              </button>
            </div>
          </section>
        )}
          </>
        )}
      </main>
    </div>
  )
}
