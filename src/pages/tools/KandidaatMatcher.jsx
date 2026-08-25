import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  searchTearsheets,
  startRun,
  processBatch,
  fetchRun,
  fetchResultaten,
  fetchMijnRuns,
} from '../../lib/kandidaatMatcherApi'

const BULLHORN_CANDIDATE_URL = (id) => `https://cls22.bullhornstaffing.com/BullhornSTAFFING/OpenWindow.cfm?Entity=Candidate&id=${id}`

const STATUS_LABELS = {
  wacht: 'Wacht',
  bezig: 'Bezig',
  klaar: 'Klaar',
  fout: 'Fout',
  kostenlimiet: 'Gestopt: kostenlimiet bereikt',
}

const ALLE_FILTER = '__alle__'

/** Unieke, niet-lege waarden van een veld uit de resultatenlijst, voor de filter-dropdowns. */
function uniekeWaarden(resultaten, veld) {
  return Array.from(new Set(resultaten.map((r) => r[veld]).filter((w) => w && w !== 'Onbekend'))).sort()
}

function scoreBadgeClass(score) {
  if (score === null || score === undefined) return 'badge'
  if (score >= 90) return 'badge badge-active'
  if (score >= 70) return 'badge badge-brand'
  if (score >= 50) return 'badge badge-blauwgrijs'
  return 'badge badge-inactive'
}

/**
 * Kandidaat Matcher — consultant kiest een Bullhorn-tearsheet (al gevuld
 * via een boolean search in Bullhorn zelf) en plakt een vacaturetekst;
 * Claude scoort elke kandidaat op het geanonimiseerde CV/intake-veld (zie
 * supabase/functions/kandidaat-matcher voor de anonimisering — namen,
 * mail, telefoon, LinkedIn en postcode gaan nooit naar Claude).
 *
 * Tijdelijk admin-only (zie toolRegistry.js) — nog openstaande AVG-/
 * Bullhorn-rechten-vragen bij Sam voordat dit breder uitrolt.
 *
 * process-batch mag maar ~150s per aanroep duren (Supabase's wall-clock-
 * limiet, zie schema.sql), dus deze pagina roept 'm herhaaldelijk aan
 * totdat de run klaar is — vandaar de poll-loop in de useEffect hieronder.
 */
export default function KandidaatMatcher() {
  const [zoekterm, setZoekterm] = useState('')
  const [tearsheets, setTearsheets] = useState([])
  const [zoekenBezig, setZoekenBezig] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [geselecteerdeTearsheet, setGeselecteerdeTearsheet] = useState(null)

  const [vacaturetekst, setVacaturetekst] = useState('')
  const [bestandNaam, setBestandNaam] = useState('')

  const [run, setRun] = useState(null)
  const [runDetail, setRunDetail] = useState(null)
  const [resultaten, setResultaten] = useState([])
  const [voortgang, setVoortgang] = useState(null)
  const [bezig, setBezig] = useState(false)
  const [fout, setFout] = useState('')

  const [statusFilter, setStatusFilter] = useState(ALLE_FILTER)
  const [salarisFilter, setSalarisFilter] = useState(ALLE_FILTER)
  const [uurtariefFilter, setUurtariefFilter] = useState(ALLE_FILTER)

  const [eerdereRuns, setEerdereRuns] = useState([])
  const gestopt = useRef(false)
  const tearsheetVeldRef = useRef(null)

  const laadEerdereRuns = useCallback(() => {
    fetchMijnRuns().then(setEerdereRuns).catch(() => {})
  }, [])

  // Sluit de tearsheet-dropdown bij een klik buiten het zoekveld — zonder dit
  // blijft hij openstaan totdat je een resultaat kiest.
  useEffect(() => {
    if (!dropdownOpen) return undefined
    function handleClickBuiten(e) {
      if (tearsheetVeldRef.current && !tearsheetVeldRef.current.contains(e.target)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickBuiten)
    return () => document.removeEventListener('mousedown', handleClickBuiten)
  }, [dropdownOpen])

  useEffect(() => {
    laadEerdereRuns()
  }, [laadEerdereRuns])

  // Debounced tearsheet-zoekopdracht — lege term geeft de 20 meest recente.
  useEffect(() => {
    setZoekenBezig(true)
    const timer = setTimeout(() => {
      searchTearsheets(zoekterm)
        .then(setTearsheets)
        .catch((err) => setFout(err.message))
        .finally(() => setZoekenBezig(false))
    }, 350)
    return () => clearTimeout(timer)
  }, [zoekterm])

  async function handleBestandUpload(e) {
    const bestand = e.target.files?.[0]
    if (!bestand) return
    setBestandNaam(bestand.name)
    const tekst = await bestand.text()
    setVacaturetekst(tekst)
  }

  async function pollTotKlaar(runId, totaal) {
    gestopt.current = false
    while (!gestopt.current) {
      let voortgangResultaat
      try {
        voortgangResultaat = await processBatch(runId)
      } catch (err) {
        setFout(err.message)
        break
      }

      const verwerktTotaal = totaal - voortgangResultaat.resterend
      setVoortgang({ verwerkt: verwerktTotaal, totaal, resterend: voortgangResultaat.resterend })

      try {
        setResultaten(await fetchResultaten(runId))
      } catch {
        // een mislukte tussentijdse refresh is niet fataal, de volgende poll-tick probeert het opnieuw
      }

      if (voortgangResultaat.klaar) break
    }
    setBezig(false)
    try {
      setRunDetail(await fetchRun(runId))
    } catch {
      // niet fataal — de run zelf is al klaar, alleen de kosten-/statusweergave mist dan
    }
    laadEerdereRuns()
  }

  async function handleStart() {
    if (!geselecteerdeTearsheet || !vacaturetekst.trim()) return
    setFout('')
    setBezig(true)
    setResultaten([])
    setVoortgang(null)
    setRunDetail(null)
    setStatusFilter(ALLE_FILTER)
    setSalarisFilter(ALLE_FILTER)
    setUurtariefFilter(ALLE_FILTER)
    try {
      const gestart = await startRun(geselecteerdeTearsheet.id, vacaturetekst.trim())
      setRun(gestart)
      if (gestart.aantalKandidaten === 0) {
        setFout('Deze distributielijst bevat geen kandidaten.')
        setBezig(false)
        return
      }
      setVoortgang({ verwerkt: 0, totaal: gestart.aantalKandidaten, resterend: gestart.aantalKandidaten })
      await pollTotKlaar(gestart.runId, gestart.aantalKandidaten)
    } catch (err) {
      setFout(err.message)
      setBezig(false)
    }
  }

  function handleBekijkEerdereRun(eerdereRun) {
    gestopt.current = true
    setRun({ runId: eerdereRun.id, tearsheetNaam: eerdereRun.tearsheet_naam, aantalKandidaten: eerdereRun.aantal_kandidaten })
    setRunDetail(eerdereRun)
    setVoortgang(null)
    setBezig(false)
    setFout('')
    setStatusFilter(ALLE_FILTER)
    setSalarisFilter(ALLE_FILTER)
    setUurtariefFilter(ALLE_FILTER)
    fetchResultaten(eerdereRun.id).then(setResultaten).catch((err) => setFout(err.message))
  }

  const resultatenGefilterd = useMemo(() => {
    return resultaten.filter(
      (r) =>
        (statusFilter === ALLE_FILTER || r.bullhorn_status === statusFilter) &&
        (salarisFilter === ALLE_FILTER || r.salaris_band === salarisFilter) &&
        (uurtariefFilter === ALLE_FILTER || r.uurtarief_band === uurtariefFilter),
    )
  }, [resultaten, statusFilter, salarisFilter, uurtariefFilter])

  useEffect(() => () => {
    gestopt.current = true
  }, [])

  return (
    <div className="page">
      <header className="topbar">
        <h1>Kandidaat Matcher</h1>
      </header>
      <main className="page-content">
        <p className="form-error"><strong>In concept, nog niet testen.</strong></p>
        <p className="page-intro">
          Zet in Bullhorn de kandidaten van je boolean search op een distributielijst, kies die distributielijst hieronder en
          plak de vacaturetekst. De matcher scoort daarna elke kandidaat op het geanonimiseerde CV — namen, e-mail,
          telefoon, LinkedIn en postcode gaan nooit mee naar buiten.
        </p>

        {fout && <p className="form-error">{fout}</p>}

        {!run && (
          <section className="matcher-setup">
            <div className="field matcher-tearsheet-field" ref={tearsheetVeldRef}>
              <label htmlFor="matcher-zoek">Distributielijst</label>
              <input
                id="matcher-zoek"
                type="text"
                placeholder="Zoek op naam (leeg = 20 meest recente)…"
                value={geselecteerdeTearsheet ? geselecteerdeTearsheet.naam : zoekterm}
                onChange={(e) => {
                  setGeselecteerdeTearsheet(null)
                  setZoekterm(e.target.value)
                  setDropdownOpen(true)
                }}
                onFocus={() => setDropdownOpen(true)}
              />
              {dropdownOpen && !geselecteerdeTearsheet && (
                <div className="matcher-dropdown">
                  {zoekenBezig && <div className="matcher-dropdown-item matcher-dropdown-leeg">Zoeken…</div>}
                  {!zoekenBezig && tearsheets.length === 0 && (
                    <div className="matcher-dropdown-item matcher-dropdown-leeg">Geen distributielijsten gevonden.</div>
                  )}
                  {!zoekenBezig &&
                    tearsheets.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        className="matcher-dropdown-item"
                        onClick={() => {
                          setGeselecteerdeTearsheet(t)
                          setDropdownOpen(false)
                        }}
                      >
                        <strong>{t.naam}</strong>
                        {t.ownerNaam && <span className="matcher-dropdown-sub"> — {t.ownerNaam}</span>}
                      </button>
                    ))}
                </div>
              )}
            </div>

            <div className="field">
              <label htmlFor="matcher-vacature">Vacaturetekst</label>
              <textarea
                id="matcher-vacature"
                className="matcher-textarea"
                rows={10}
                placeholder="Plak hier de vacaturetekst (of de ruwe job pull uit Bullhorn)…"
                value={vacaturetekst}
                onChange={(e) => setVacaturetekst(e.target.value)}
              />
              <div className="matcher-upload-row">
                <input id="matcher-bestand" type="file" accept=".txt" onChange={handleBestandUpload} />
                {bestandNaam && <span className="matcher-dropdown-sub">Geladen: {bestandNaam}</span>}
              </div>
            </div>

            <button
              type="button"
              className="btn btn-primary"
              disabled={!geselecteerdeTearsheet || !vacaturetekst.trim() || bezig}
              onClick={handleStart}
            >
              {bezig ? 'Bezig…' : 'Start matching'}
            </button>

            {eerdereRuns.length > 0 && (
              <div className="matcher-eerdere-runs">
                <h2>Eerdere runs</h2>
                <ul>
                  {eerdereRuns.map((r) => (
                    <li key={r.id}>
                      <button type="button" className="matcher-dropdown-item" onClick={() => handleBekijkEerdereRun(r)}>
                        <strong>{r.tearsheet_naam}</strong>
                        <span className="matcher-dropdown-sub">
                          {' '}
                          — {r.aantal_kandidaten} kandidaten — {STATUS_LABELS[r.status] ?? r.status} —{' '}
                          {new Date(r.created_at).toLocaleDateString('nl-NL')}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

        {run && (
          <section className="matcher-run">
            <div className="matcher-run-header">
              <h2>{run.tearsheetNaam}</h2>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  gestopt.current = true
                  setRun(null)
                  setRunDetail(null)
                  setResultaten([])
                  setVoortgang(null)
                  setGeselecteerdeTearsheet(null)
                  setVacaturetekst('')
                  setBestandNaam('')
                  setStatusFilter(ALLE_FILTER)
                  setSalarisFilter(ALLE_FILTER)
                  setUurtariefFilter(ALLE_FILTER)
                }}
              >
                Nieuwe run
              </button>
            </div>

            {voortgang && (
              <div className="matcher-progress">
                <div className="matcher-progress-bar">
                  <div
                    className="matcher-progress-fill"
                    style={{ width: `${voortgang.totaal ? Math.round((voortgang.verwerkt / voortgang.totaal) * 100) : 0}%` }}
                  />
                </div>
                <span className="matcher-dropdown-sub">
                  {voortgang.verwerkt} / {voortgang.totaal} verwerkt
                  {runDetail && ` — geschatte kosten: $${Number(runDetail.geschatte_kosten_usd ?? 0).toFixed(2)}`}
                </span>
              </div>
            )}

            {runDetail?.status === 'kostenlimiet' && (
              <p className="form-error">{runDetail.foutmelding}</p>
            )}

            {resultaten.length > 0 && (
              <div className="matcher-filters">
                <div className="field">
                  <label htmlFor="matcher-filter-status">Status</label>
                  <select id="matcher-filter-status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                    <option value={ALLE_FILTER}>Alle</option>
                    {uniekeWaarden(resultaten, 'bullhorn_status').map((w) => (
                      <option key={w} value={w}>{w}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="matcher-filter-salaris">Salaris range</label>
                  <select id="matcher-filter-salaris" value={salarisFilter} onChange={(e) => setSalarisFilter(e.target.value)}>
                    <option value={ALLE_FILTER}>Alle</option>
                    {uniekeWaarden(resultaten, 'salaris_band').map((w) => (
                      <option key={w} value={w}>{w}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="matcher-filter-uurtarief">Uurtarief range</label>
                  <select id="matcher-filter-uurtarief" value={uurtariefFilter} onChange={(e) => setUurtariefFilter(e.target.value)}>
                    <option value={ALLE_FILTER}>Alle</option>
                    {uniekeWaarden(resultaten, 'uurtarief_band').map((w) => (
                      <option key={w} value={w}>{w}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {resultaten.length === 0 && !bezig && <p className="empty-state">Nog geen resultaten.</p>}
            {resultaten.length > 0 && resultatenGefilterd.length === 0 && (
              <p className="empty-state">Geen kandidaten voldoen aan de gekozen filters.</p>
            )}

            <ul className="matcher-resultaten">
              {resultatenGefilterd.map((r) => (
                <li key={r.id} className="matcher-resultaat-card">
                  <div className="matcher-resultaat-header">
                    <a href={BULLHORN_CANDIDATE_URL(r.bullhorn_id)} target="_blank" rel="noreferrer">
                      Kandidaat {r.bullhorn_id}
                    </a>
                    {r.status === 'klaar' ? (
                      <span className={scoreBadgeClass(r.score)}>{r.score}</span>
                    ) : (
                      <span className="badge">{STATUS_LABELS[r.status] ?? r.status}</span>
                    )}
                  </div>
                  {(r.bullhorn_status || r.salaris_band || r.uurtarief_band) && (
                    <p className="matcher-dropdown-sub">
                      {[r.bullhorn_status, r.salaris_band, r.uurtarief_band].filter(Boolean).join(' — ')}
                    </p>
                  )}
                  {r.onderbouwing && <p className="matcher-onderbouwing">{r.onderbouwing}</p>}
                  {r.status === 'fout' && r.foutmelding && <p className="form-error-inline">{r.foutmelding}</p>}
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  )
}
