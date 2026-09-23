import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  maakStrategie,
  slaOpdrachtOp,
  fetchOpdracht,
  koppelExtensie,
  startInRecruiter,
} from '../../lib/externZoekenApi'

/**
 * Extern Zoeken — externe search via LinkedIn Recruiter (tegenhanger van de
 * Kandidaat Matcher). Stap 1: vacature → zoekopdracht, die de consultant hier
 * controleert en aanpast. Het uitvoeren in Recruiter (project aanmaken,
 * zoeken, pipeline vullen, berichten) doet straks de BURG Chrome-extensie.
 */

// Lijstvelden worden als "één per regel" bewerkt.
const LIJST_VELDEN = [
  { key: 'locaties', label: 'Locaties (één per regel, zoals in Recruiter: "Plaats, Provincie, Nederland")' },
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
  const [extensieVersie, setExtensieVersie] = useState(null)
  const [opdracht, setOpdracht] = useState(null)

  useEffect(
    () =>
      koppelExtensie({
        onVersie: setExtensieVersie,
        onFout: (melding) => setFout(`Extensie: ${melding}`),
      }),
    [],
  )

  // Voortgang live volgen zolang de extensie bezig is.
  useEffect(() => {
    if (!opdracht?.id || !['concept', 'bezig'].includes(opdracht.status)) return
    const timer = setInterval(async () => {
      try {
        setOpdracht(await fetchOpdracht(opdracht.id))
      } catch {
        // volgende poging
      }
    }, 3000)
    return () => clearInterval(timer)
  }, [opdracht?.id, opdracht?.status])

  async function handleStart() {
    setFout('')
    try {
      const id = await slaOpdrachtOp(vacatureId.trim(), vacaturetekst.trim(), strategie)
      setOpdracht({ id, status: 'concept', voortgang: 'Extensie starten…' })
      startInRecruiter(id)
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
        <p className="page-intro">
          Plak de vacature en laat de zoekopdracht voor LinkedIn Recruiter opstellen. Controleer en verbeter de boolean
          en filters; daarna voert de BURG-extensie de search uit in Recruiter.
        </p>

        {fout && <p className="form-error">{fout}</p>}

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
                disabled={!extensieVersie || opdracht?.status === 'bezig'}
                onClick={handleStart}
              >
                Start in Recruiter
              </button>
              <button type="button" className="btn btn-secondary" onClick={handleKopieer}>
                {gekopieerd ? 'Gekopieerd' : 'Kopieer zoekopdracht'}
              </button>
            </div>
            {!extensieVersie && (
              <p className="matcher-dropdown-sub">
                BURG-extensie niet gevonden in deze browser — installeer of activeer de extensie om te starten.
              </p>
            )}
            {opdracht && (
              <div className="field">
                <label>Voortgang in Recruiter</label>
                <p>
                  <strong>{opdracht.status}</strong> — {opdracht.voortgang}
                </p>
                {opdracht.foutmelding && <p className="form-error">{opdracht.foutmelding}</p>}
                {opdracht.status === 'bezig' && (
                  <p className="matcher-dropdown-sub">Laat dit tabblad open zolang de extensie bezig is.</p>
                )}
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  )
}
