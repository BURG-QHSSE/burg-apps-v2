import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  startRun,
  processBatch,
  fetchRun,
  fetchResultaten,
  fetchMijnRuns,
  fetchKandidaatNamen,
} from '../../lib/kandidaatMatcherApi'
import { extraheerVacatureBestand } from '../../lib/vacatureBestandExtractie'

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
 * Kandidaat Matcher — consultant zet in Bullhorn zelf een bulk-Notitie
 * (actie "Matching", tekst = het vacature-ID) op de kandidaten van een
 * boolean search, typt datzelfde vacature-ID hieronder in en plakt een
 * vacaturetekst; Claude scoort elke kandidaat op het geanonimiseerde
 * CV/intake-veld (zie supabase/functions/kandidaat-matcher voor de
 * anonimisering — namen, mail, telefoon, LinkedIn en postcode gaan nooit
 * naar Claude).
 *
 * Notitie i.p.v. distributielijst: een nieuwe distributielijst is tot ~1
 * week onzichtbaar voor de koppeling met Bullhorn (bevestigd met Bullhorn
 * support) — een notitie is wél meteen zichtbaar.
 *
 * Tijdelijk admin-only (zie toolRegistry.js) — nog openstaande AVG-/
 * Bullhorn-rechten-vragen bij Sam voordat dit breder uitrolt.
 *
 * process-batch mag maar ~150s per aanroep duren (Supabase's wall-clock-
 * limiet, zie schema.sql), dus deze pagina roept 'm herhaaldelijk aan
 * totdat de run klaar is — vandaar de poll-loop in de useEffect hieronder.
 */
export default function KandidaatMatcher() {
  const [vacatureId, setVacatureId] = useState('')

  const [vacaturetekst, setVacaturetekst] = useState('')
  const [bestandNaam, setBestandNaam] = useState('')

  const [run, setRun] = useState(null)
  const [runDetail, setRunDetail] = useState(null)
  const [resultaten, setResultaten] = useState([])
  const [namen, setNamen] = useState({})
  const [voortgang, setVoortgang] = useState(null)
  const [bezig, setBezig] = useState(false)
  const [fout, setFout] = useState('')

  const [statusFilter, setStatusFilter] = useState(ALLE_FILTER)
  const [salarisFilter, setSalarisFilter] = useState(ALLE_FILTER)
  const [uurtariefFilter, setUurtariefFilter] = useState(ALLE_FILTER)

  const [eerdereRuns, setEerdereRuns] = useState([])
  const gestopt = useRef(false)

  const laadEerdereRuns = useCallback(() => {
    fetchMijnRuns().then(setEerdereRuns).catch(() => {})
  }, [])

  useEffect(() => {
    laadEerdereRuns()
  }, [laadEerdereRuns])

  async function handleBestandUpload(e) {
    const bestand = e.target.files?.[0]
    if (!bestand) return
    setFout('')
    try {
      const tekst = await extraheerVacatureBestand(bestand)
      setBestandNaam(bestand.name)
      setVacaturetekst(tekst)
    } catch (err) {
      setFout(err.message)
    } finally {
      e.target.value = ''
    }
  }

  /** Namen worden bewust pas live opgehaald zodra er echt resultaten getoond worden — nooit opgeslagen, zie kandidaatMatcherApi.js. */
  async function laadNamen(resultatenLijst) {
    const ids = resultatenLijst.map((r) => r.bullhorn_id)
    if (ids.length === 0) return
    try {
      setNamen(await fetchKandidaatNamen(ids))
    } catch {
      // niet fataal — de kaarten vallen dan terug op "Kandidaat {id}"
    }
  }

  // Kandidaten worden bewust pas getoond zodra de hele run klaar is (geen
  // tussentijdse "wacht"-rijen) — daarom wordt setResultaten hier pas ná de
  // loop aangeroepen, niet per tussentijdse tick.
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

      if (voortgangResultaat.klaar) break
    }
    setBezig(false)
    try {
      setRunDetail(await fetchRun(runId))
    } catch {
      // niet fataal — de run zelf is al klaar, alleen de kosten-/statusweergave mist dan
    }
    try {
      const data = await fetchResultaten(runId)
      setResultaten(data)
      await laadNamen(data)
    } catch (err) {
      setFout(err.message)
    }
    laadEerdereRuns()
  }

  async function handleStart() {
    const vacatureIdGetrimd = vacatureId.trim()
    if (!vacatureIdGetrimd || !vacaturetekst.trim()) return
    setFout('')
    setBezig(true)
    setResultaten([])
    setNamen({})
    setVoortgang(null)
    setRunDetail(null)
    setStatusFilter(ALLE_FILTER)
    setSalarisFilter(ALLE_FILTER)
    setUurtariefFilter(ALLE_FILTER)
    try {
      const gestart = await startRun(vacatureIdGetrimd, vacaturetekst.trim())
      setRun(gestart)
      if (gestart.aantalKandidaten === 0) {
        setFout(
          'Geen kandidaten gevonden - controleer of de bulk-Notitie (actie "Matching", tekst = dit vacature-ID) goed is gezet in Bullhorn.',
        )
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
    setRun({ runId: eerdereRun.id, vacatureNaam: eerdereRun.vacature_naam, aantalKandidaten: eerdereRun.aantal_kandidaten })
    setRunDetail(eerdereRun)
    setResultaten([])
    setNamen({})
    setFout('')
    setStatusFilter(ALLE_FILTER)
    setSalarisFilter(ALLE_FILTER)
    setUurtariefFilter(ALLE_FILTER)

    if (eerdereRun.status === 'bezig') {
      // De run stond nog "bezig" maar niemand roept process-batch meer aan
      // (bv. het tabblad stond op de achtergrond) — gewoon hervatten i.p.v.
      // een halve, stilstaande run te laten staan.
      gestopt.current = false
      setBezig(true)
      setVoortgang({ verwerkt: 0, totaal: eerdereRun.aantal_kandidaten, resterend: eerdereRun.aantal_kandidaten })
      pollTotKlaar(eerdereRun.id, eerdereRun.aantal_kandidaten)
      return
    }

    gestopt.current = true
    setVoortgang(null)
    setBezig(false)
    fetchResultaten(eerdereRun.id)
      .then((data) => {
        setResultaten(data)
        laadNamen(data)
      })
      .catch((err) => setFout(err.message))
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
          Zet in Bullhorn een bulk-Notitie (actie "Matching", tekst = het vacature-ID) op de kandidaten van je boolean
          search, typ hieronder datzelfde vacature-ID en plak de vacaturetekst. De matcher scoort daarna elke kandidaat op
          het geanonimiseerde CV — namen, e-mail, telefoon, LinkedIn en postcode gaan nooit mee naar buiten.
        </p>

        {fout && <p className="form-error">{fout}</p>}

        {!run && (
          <section className="matcher-setup">
            <div className="field">
              <label htmlFor="matcher-vacature-id">Vacature-ID</label>
              <input
                id="matcher-vacature-id"
                type="text"
                inputMode="numeric"
                placeholder="Zelfde ID als in de bulk-Notitie in Bullhorn…"
                value={vacatureId}
                onChange={(e) => setVacatureId(e.target.value)}
              />
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
                <input id="matcher-bestand" type="file" accept=".txt,.pdf,.docx" onChange={handleBestandUpload} />
                {bestandNaam && <span className="matcher-dropdown-sub">Geladen: {bestandNaam}</span>}
              </div>
            </div>

            <button
              type="button"
              className="btn btn-primary"
              disabled={!vacatureId.trim() || !vacaturetekst.trim() || bezig}
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
                        <strong>{r.vacature_naam}</strong>
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
              <h2>{run.vacatureNaam}</h2>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  gestopt.current = true
                  setRun(null)
                  setRunDetail(null)
                  setResultaten([])
                  setNamen({})
                  setVoortgang(null)
                  setVacatureId('')
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
                    <span className="matcher-kandidaat-naam">{namen[r.bullhorn_id] ?? `Kandidaat ${r.bullhorn_id}`}</span>
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
                  <a
                    href={BULLHORN_CANDIDATE_URL(r.bullhorn_id)}
                    target="_blank"
                    rel="noreferrer"
                    className="matcher-bullhorn-knop"
                  >
                    Bekijken in Bullhorn
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  )
}
