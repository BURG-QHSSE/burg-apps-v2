import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../lib/AuthProvider'
import { fetchKandidaten, addKandidaat, removeKandidaat, subscribeToKandidaten } from '../../lib/proeftijdApi'

/**
 * Proeftijd Tracker — poort van de originele `proeftijd.html` (los,
 * localStorage-gebaseerd HTML-bestand in de oorspronkelijke BURG-Apps repo).
 * Belangrijkste verschil met de bron: data staat nu in Supabase
 * (`proeftijd_kandidaten`, RLS: elke ingelogde gebruiker mag lezen/toevoegen/
 * verwijderen) i.p.v. localStorage, zodat collega's dezelfde lijst zien i.p.v.
 * elk hun eigen losse lijstje op hun eigen apparaat. Geen limiet meer op het
 * aantal kandidaten (de bron had een harde grens van 6, puur ingegeven door
 * schermruimte in de losse HTML-versie).
 */

function getEndDate(k) {
  const d = new Date(k.start_datum)
  d.setMonth(d.getMonth() + k.duur_maanden)
  return d
}

function formatDatum(date) {
  return new Date(date).toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

/** "42D 08U 23M" (11 tekens) of " GESLAAGD  " (ook 11 tekens, zelfde breedte). */
function getDisplayString(k) {
  const diff = getEndDate(k) - Date.now()
  if (diff <= 0) return ' GESLAAGD  '

  const dagen = Math.floor(diff / 864e5)
  const uren = Math.floor((diff % 864e5) / 36e5)
  const minuten = Math.floor((diff % 36e5) / 6e4)

  return (
    String(dagen).padStart(2, '0') +
    'D ' +
    String(uren).padStart(2, '0') +
    'U ' +
    String(minuten).padStart(2, '0') +
    'M'
  )
}

function getProgress(k) {
  const start = new Date(k.start_datum).getTime()
  const end = getEndDate(k).getTime()
  return Math.min(100, Math.max(0, ((Date.now() - start) / (end - start)) * 100))
}

/** Eén "vallend kaartje": animeert alleen als het teken echt wijzigt t.o.v. de vorige render. */
function FlapChar({ char }) {
  const foldRef = useRef(null)
  const foldSpanRef = useRef(null)
  const vorigeCharRef = useRef(char)

  useEffect(() => {
    const vorigeChar = vorigeCharRef.current
    if (vorigeChar !== char && foldRef.current && foldSpanRef.current) {
      foldSpanRef.current.textContent = vorigeChar
      const fold = foldRef.current
      fold.classList.remove('flap-fold-flipping')
      void fold.offsetWidth // reflow forceren zodat de animatie opnieuw start
      fold.classList.add('flap-fold-flipping')
    }
    vorigeCharRef.current = char
  }, [char])

  return (
    <div className="flap">
      <div className="flap-upper">
        <span>{char}</span>
      </div>
      <div className="flap-sep" />
      <div className="flap-lower">
        <span>{char}</span>
      </div>
      <div className="flap-fold" ref={foldRef}>
        <span ref={foldSpanRef}>{char}</span>
      </div>
    </div>
  )
}

function FlapBoard({ displayStr, done }) {
  const items = []
  Array.from(displayStr).forEach((ch, i) => {
    if (i === 3 || i === 7) items.push({ type: 'gap', key: `gap-${i}` })
    items.push({ type: 'flap', char: ch, key: `flap-${i}` })
  })

  return (
    <div className={done ? 'flap-board flap-board-done' : 'flap-board'}>
      {items.map((item) =>
        item.type === 'gap' ? <div className="flap-gap" key={item.key} /> : <FlapChar char={item.char} key={item.key} />,
      )}
    </div>
  )
}

function KandidaatCard({ kandidaat, onVerwijderen, confirmDeleteId, setConfirmDeleteId, verwijderBezig }) {
  const done = getEndDate(kandidaat) <= new Date()
  const displayStr = getDisplayString(kandidaat)

  return (
    <div className={done ? 'section-card proeftijd-card proeftijd-card-done' : 'section-card proeftijd-card'}>
      <div className="proeftijd-card-header">
        <span className={done ? 'proeftijd-naam proeftijd-naam-done' : 'proeftijd-naam'}>{kandidaat.naam}</span>
        {confirmDeleteId === kandidaat.id ? (
          <div className="proeftijd-confirm-delete">
            <span>Zeker?</span>
            <button
              type="button"
              className="btn btn-danger"
              disabled={verwijderBezig}
              onClick={() => onVerwijderen(kandidaat.id)}
            >
              Ja
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setConfirmDeleteId(null)}>
              Nee
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="delete-btn"
            title="Verwijderen"
            onClick={() => setConfirmDeleteId(kandidaat.id)}
          >
            ✕
          </button>
        )}
      </div>

      <FlapBoard displayStr={displayStr} done={done} />

      <div className="progress-bar">
        <div
          className="progress-fill"
          style={{ width: `${done ? 100 : getProgress(kandidaat).toFixed(1)}%` }}
        />
      </div>

      <div className="proeftijd-meta">
        <span>Start: {formatDatum(kandidaat.start_datum)}</span>
        <span className="months-badge">{kandidaat.duur_maanden} mnd</span>
        <span>Einde: {formatDatum(getEndDate(kandidaat))}</span>
      </div>
    </div>
  )
}

export default function ProeftijdTracker() {
  const { user } = useAuth()

  const [kandidaten, setKandidaten] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [verwijderBezig, setVerwijderBezig] = useState(false)

  const [modalOpen, setModalOpen] = useState(false)
  const [naam, setNaam] = useState('')
  const [startDatum, setStartDatum] = useState(() => new Date().toISOString().slice(0, 10))
  const [duurMaanden, setDuurMaanden] = useState(2)
  const [toevoegenBezig, setToevoegenBezig] = useState(false)
  const [modalError, setModalError] = useState('')

  const load = useCallback(async () => {
    try {
      const data = await fetchKandidaten()
      setKandidaten(data)
      setLoadError('')
    } catch (err) {
      setLoadError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const unsubscribe = subscribeToKandidaten(() => load())
    return unsubscribe
  }, [load])

  // Herteken elke 10 seconden zodat de tellers doorlopen — elke FlapChar
  // animeert zelf alleen als zijn eigen teken wijzigt (zie FlapChar hierboven).
  // Ook de sortering hangt hiervan af: zodra iemand's proeftijd afloopt moet
  // die naar onderen verschuiven, ook zonder dat er iets in de data wijzigt.
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 10000)
    return () => clearInterval(timer)
  }, [])

  const sortedKandidaten = useMemo(() => {
    return [...kandidaten].sort((a, b) => {
      const now = Date.now()
      const aDiff = getEndDate(a).getTime() - now
      const bDiff = getEndDate(b).getTime() - now
      if (aDiff <= 0 && bDiff > 0) return 1
      if (aDiff > 0 && bDiff <= 0) return -1
      return aDiff - bDiff
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kandidaten, tick])

  function openModal() {
    setNaam('')
    setStartDatum(new Date().toISOString().slice(0, 10))
    setDuurMaanden(2)
    setModalError('')
    setModalOpen(true)
  }

  async function handleToevoegen() {
    const naamTrimmed = naam.trim()
    if (!naamTrimmed) {
      setModalError('Vul een naam in.')
      return
    }
    if (!startDatum) {
      setModalError('Selecteer een startdatum.')
      return
    }

    setToevoegenBezig(true)
    setModalError('')
    try {
      await addKandidaat({ naam: naamTrimmed, startDatum, duurMaanden, userId: user?.id })
      setModalOpen(false)
      await load()
    } catch (err) {
      setModalError(err.message)
    } finally {
      setToevoegenBezig(false)
    }
  }

  async function handleVerwijderen(id) {
    setVerwijderBezig(true)
    try {
      await removeKandidaat(id)
      setConfirmDeleteId(null)
      await load()
    } catch (err) {
      setLoadError(err.message)
    } finally {
      setVerwijderBezig(false)
    }
  }

  return (
    <div className="page">
      <header className="topbar">
        <div>
          <h1>Proeftijd Tracker</h1>
        </div>
        <div className="topbar-actions">
          <Link to="/" className="btn btn-secondary">
            Terug naar dashboard
          </Link>
        </div>
      </header>

      <main className="page-content">
        <div className="proeftijd-toolbar">
          <p className="page-intro">
            {loading
              ? 'Kandidaten laden…'
              : `${kandidaten.length} kandi${kandidaten.length === 1 ? 'daat' : 'daten'} · bijgewerkt elke 30 seconden`}
          </p>
          <button type="button" className="btn btn-primary" onClick={openModal}>
            + Kandidaat toevoegen
          </button>
        </div>

        {!loading && loadError && (
          <p className="form-error" role="alert">
            Kon kandidaten niet laden: {loadError}
          </p>
        )}

        {!loading && !loadError && sortedKandidaten.length === 0 && (
          <div className="idle-state">Nog geen kandidaten. Voeg er één toe om te beginnen.</div>
        )}

        {!loading && !loadError && sortedKandidaten.length > 0 && (
          <div className="proeftijd-grid">
            {sortedKandidaten.map((k) => (
              <KandidaatCard
                key={k.id}
                kandidaat={k}
                onVerwijderen={handleVerwijderen}
                confirmDeleteId={confirmDeleteId}
                setConfirmDeleteId={setConfirmDeleteId}
                verwijderBezig={verwijderBezig}
              />
            ))}
          </div>
        )}
      </main>

      {modalOpen && (
        <>
          <div className="mo-modal-overlay" onClick={() => setModalOpen(false)} />
          <div className="mo-modal-box">
            <div className="mo-modal-title">Kandidaat toevoegen</div>

            <label className="field">
              <span>Naam kandidaat</span>
              <input
                type="text"
                value={naam}
                onChange={(e) => setNaam(e.target.value)}
                maxLength={40}
                disabled={toevoegenBezig}
                autoFocus
              />
            </label>

            <label className="field">
              <span>Startdatum proeftijd</span>
              <input
                type="date"
                value={startDatum}
                onChange={(e) => setStartDatum(e.target.value)}
                disabled={toevoegenBezig}
              />
            </label>

            <div className="field">
              <span>Duur proeftijd</span>
              <div className="btn-group">
                {[1, 2, 3].map((m) => (
                  <button
                    type="button"
                    key={m}
                    className={duurMaanden === m ? 'btn-group-btn active' : 'btn-group-btn'}
                    onClick={() => setDuurMaanden(m)}
                    disabled={toevoegenBezig}
                  >
                    {m} {m === 1 ? 'maand' : 'maanden'}
                  </button>
                ))}
              </div>
            </div>

            {modalError && (
              <p className="form-error" role="alert">
                {modalError}
              </p>
            )}

            <div className="mo-modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setModalOpen(false)} disabled={toevoegenBezig}>
                Annuleren
              </button>
              <button type="button" className="btn btn-primary" onClick={handleToevoegen} disabled={toevoegenBezig}>
                {toevoegenBezig ? 'Toevoegen…' : 'Toevoegen'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
