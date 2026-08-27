import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  startRun,
  processBatch,
  fetchRun,
  fetchResultaten,
  fetchMijnRuns,
  fetchKandidaatNamen,
} from '../../lib/kandidaatMatcherApi'
import { extraheerVacatureBestand } from '../../lib/vacatureBestandExtractie'
import bullhornLogo from '../../assets/bullhorn-icon.png'

const BULLHORN_CANDIDATE_URL = (id) => `https://cls22.bullhornstaffing.com/BullhornSTAFFING/OpenWindow.cfm?Entity=Candidate&id=${id}`

const STATUS_LABELS = {
  wacht: 'Wacht',
  bezig: 'Bezig',
  klaar: 'Klaar',
  fout: 'Fout',
  kostenlimiet: 'Gestopt: kostenlimiet bereikt',
}

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
 * Open voor iedereen (zie toolRegistry.js minimumRole: 'user') - zie
 * MatcherGebruik.jsx voor het admin-only gebruiksoverzicht (wie, hoe vaak,
 * hoeveel kandidaten, kosten).
 *
 * process-batch mag maar ~150s per aanroep duren (Supabase's wall-clock-
 * limiet, zie schema.sql), dus deze pagina roept 'm herhaaldelijk aan
 * totdat de run klaar is — vandaar de poll-loop in de useEffect hieronder.
 */
export default function KandidaatMatcher() {
  // De actieve run staat ook in de URL (?run=...) zodat een teruggekeerde/
  // herladen tabblad (bv. na het openen van een kandidaat in Bullhorn - een
  // achtergrondtabblad kan door de browser herladen worden) dezelfde run
  // automatisch weer oppakt in plaats van terug te vallen op het lege
  // startformulier.
  const [searchParams, setSearchParams] = useSearchParams()

  // Concept-invoer (vacature-ID/-tekst/bestandsnaam, vóór er een run is
  // gestart) wordt ook in sessionStorage bewaard - anders raakte je getypte
  // ID/geplakte tekst kwijt zodra de browser dit tabblad op de achtergrond
  // herlaadt (bv. terwijl je in een ander tabblad de jobpull ophaalt).
  const CONCEPT_SLEUTEL = 'kandidaat-matcher-concept'

  function leesConcept() {
    try {
      const ruw = sessionStorage.getItem(CONCEPT_SLEUTEL)
      return ruw ? JSON.parse(ruw) : {}
    } catch {
      return {}
    }
  }

  const [vacatureId, setVacatureId] = useState(() => leesConcept().vacatureId ?? '')
  const [vacaturetekst, setVacaturetekst] = useState(() => leesConcept().vacaturetekst ?? '')
  const [bestandNaam, setBestandNaam] = useState(() => leesConcept().bestandNaam ?? '')

  useEffect(() => {
    try {
      sessionStorage.setItem(CONCEPT_SLEUTEL, JSON.stringify({ vacatureId, vacaturetekst, bestandNaam }))
    } catch {
      // sessionStorage kan onbeschikbaar zijn (privénavigatie e.d.) - dan blijft de concept-invoer gewoon niet bewaard
    }
  }, [vacatureId, vacaturetekst, bestandNaam])

  const [run, setRun] = useState(null)
  const [runDetail, setRunDetail] = useState(null)
  const [resultaten, setResultaten] = useState([])
  const [namen, setNamen] = useState({})
  const [voortgang, setVoortgang] = useState(null)
  const [bezig, setBezig] = useState(false)
  const [fout, setFout] = useState('')

  // Multi-select: een lege array betekent "geen filter" (alles zichtbaar),
  // net als voorheen ALLE_FILTER deed.
  const [statusFilter, setStatusFilter] = useState([])
  const [salarisFilter, setSalarisFilter] = useState([])
  const [uurtariefFilter, setUurtariefFilter] = useState([])

  const [eerdereRuns, setEerdereRuns] = useState([])
  const gestopt = useRef(false)

  // Welke van de drie filter-dropdowns openstaat (null = geen).
  const [openFilter, setOpenFilter] = useState(null)
  const statusVeldRef = useRef(null)
  const salarisVeldRef = useRef(null)
  const uurtariefVeldRef = useRef(null)

  // Sluit de openstaande filter-dropdown bij een klik erbuiten.
  useEffect(() => {
    if (!openFilter) return undefined
    function handleClickBuiten(e) {
      const ref = { status: statusVeldRef, salaris: salarisVeldRef, uurtarief: uurtariefVeldRef }[openFilter]
      if (ref?.current && !ref.current.contains(e.target)) {
        setOpenFilter(null)
      }
    }
    document.addEventListener('mousedown', handleClickBuiten)
    return () => document.removeEventListener('mousedown', handleClickBuiten)
  }, [openFilter])

  const laadEerdereRuns = useCallback(() => {
    fetchMijnRuns().then(setEerdereRuns).catch(() => {})
  }, [])

  useEffect(() => {
    laadEerdereRuns()
  }, [laadEerdereRuns])

  // Bij het laden van de pagina (of een herlaad van een op de achtergrond
  // geplaatst tabblad) de run uit de URL herstellen, i.p.v. terug te vallen
  // op het lege startformulier.
  useEffect(() => {
    const runIdUitUrl = searchParams.get('run')
    if (!runIdUitUrl || run) return
    fetchRun(runIdUitUrl)
      .then((eerdereRun) => handleBekijkEerdereRun(eerdereRun))
      .catch(() => {
        // ongeldige/verwijderde run-id in de URL - gewoon terugvallen op het startformulier
        setSearchParams({}, { replace: true })
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  const namenCacheSleutel = (runId) => `kandidaat-matcher-namen-${runId}`

  /**
   * Namen worden nooit in de database opgeslagen (zie kandidaatMatcherApi.js
   * / matching_resultaten-schema - bewust geen PII), maar wél gecachet in
   * sessionStorage van de browser, per run - anders moest bij elke
   * tabblad-herlaad (bv. de browser herlaadt een tabblad op de achtergrond)
   * alles opnieuw live bij Bullhorn opgehaald worden. sessionStorage is
   * puur lokaal bij de kijker en verdwijnt zodra het tabblad echt gesloten
   * wordt - geen centrale opslag.
   */
  async function laadNamen(runId, resultatenLijst) {
    const ids = resultatenLijst.map((r) => r.bullhorn_id)
    if (ids.length === 0) return

    let gecachet = {}
    try {
      const ruw = sessionStorage.getItem(namenCacheSleutel(runId))
      if (ruw) gecachet = JSON.parse(ruw)
    } catch {
      // sessionStorage kan onbeschikbaar zijn (privénavigatie e.d.) - gewoon zonder cache verder
    }

    const ontbrekendeIds = ids.filter((id) => !(id in gecachet))
    if (ontbrekendeIds.length === 0) {
      setNamen(gecachet)
      return
    }

    try {
      const nieuw = await fetchKandidaatNamen(ontbrekendeIds)
      const samengevoegd = { ...gecachet, ...nieuw }
      setNamen(samengevoegd)
      try {
        sessionStorage.setItem(namenCacheSleutel(runId), JSON.stringify(samengevoegd))
      } catch {
        // opslag kan falen (quota/privénavigatie) - niet fataal, dan wordt gewoon opnieuw opgehaald een volgende keer
      }
    } catch {
      setNamen(gecachet) // toon in elk geval wat we al hadden
    }
  }

  // Hoeveel process-batch-aanroepen tegelijk lopen - matching_pak_batch()
  // gebruikt FOR UPDATE SKIP LOCKED (zie schema.sql), dus meerdere
  // gelijktijdige aanroepen claimen veilig verschillende rijen. Was eerder
  // altijd maar 1 keten tegelijk, wat bij een grote run onnodig traag was.
  const GELIJKTIJDIGE_BATCHES = 3

  // Kandidaten worden bewust pas getoond zodra de hele run klaar is (geen
  // tussentijdse "wacht"-rijen) — daarom wordt setResultaten hier pas ná de
  // loop aangeroepen, niet per tussentijdse tick.
  async function pollTotKlaar(runId, totaal) {
    gestopt.current = false
    let klaarGemeld = false

    async function werker() {
      while (!gestopt.current && !klaarGemeld) {
        let voortgangResultaat
        try {
          voortgangResultaat = await processBatch(runId)
        } catch (err) {
          setFout(err.message)
          break
        }

        const verwerktTotaal = totaal - voortgangResultaat.resterend
        setVoortgang({ verwerkt: verwerktTotaal, totaal, resterend: voortgangResultaat.resterend })

        if (voortgangResultaat.klaar) {
          klaarGemeld = true
          break
        }
      }
    }

    await Promise.all(Array.from({ length: GELIJKTIJDIGE_BATCHES }, werker))

    setBezig(false)
    try {
      setRunDetail(await fetchRun(runId))
    } catch {
      // niet fataal — de run zelf is al klaar, alleen de kosten-/statusweergave mist dan
    }
    try {
      const data = await fetchResultaten(runId)
      setResultaten(data)
      await laadNamen(runId, data)
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
    setStatusFilter([])
    setSalarisFilter([])
    setUurtariefFilter([])
    try {
      const gestart = await startRun(vacatureIdGetrimd, vacaturetekst.trim())
      setRun(gestart)
      setSearchParams({ run: gestart.runId }, { replace: true })
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
    setSearchParams({ run: eerdereRun.id }, { replace: true })
    setRun({ runId: eerdereRun.id, vacatureNaam: eerdereRun.vacature_naam, aantalKandidaten: eerdereRun.aantal_kandidaten })
    setRunDetail(eerdereRun)
    setResultaten([])
    setNamen({})
    setFout('')
    setStatusFilter([])
    setSalarisFilter([])
    setUurtariefFilter([])

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
        laadNamen(eerdereRun.id, data)
      })
      .catch((err) => setFout(err.message))
  }

  const resultatenGefilterd = useMemo(() => {
    return resultaten.filter(
      (r) =>
        (statusFilter.length === 0 || statusFilter.includes(r.bullhorn_status)) &&
        (salarisFilter.length === 0 || salarisFilter.includes(r.salaris_band)) &&
        (uurtariefFilter.length === 0 || uurtariefFilter.includes(r.uurtarief_band)),
    )
  }, [resultaten, statusFilter, salarisFilter, uurtariefFilter])

  /** Toggelt één waarde in of uit een multi-select filter-array. */
  function toggleFilterWaarde(setFilter, waarde) {
    setFilter((huidig) => (huidig.includes(waarde) ? huidig.filter((w) => w !== waarde) : [...huidig, waarde]))
  }

  /** Samenvatting voor de dropdown-knop, bv. "Status: Alle" / "Status: Actief" / "Status: 3 geselecteerd". */
  function filterSamenvatting(gekozen, label) {
    if (gekozen.length === 0) return `${label}: Alle`
    if (gekozen.length === 1) return `${label}: ${gekozen[0]}`
    return `${label}: ${gekozen.length} geselecteerd`
  }

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
                  setSearchParams({}, { replace: true })
                  setRun(null)
                  setRunDetail(null)
                  setResultaten([])
                  setNamen({})
                  setVoortgang(null)
                  setVacatureId('')
                  setVacaturetekst('')
                  setBestandNaam('')
                  setStatusFilter([])
                  setSalarisFilter([])
                  setUurtariefFilter([])
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
                </span>
              </div>
            )}

            {runDetail?.status === 'kostenlimiet' && (
              <p className="form-error">{runDetail.foutmelding}</p>
            )}

            {resultaten.length > 0 && (
              <div className="matcher-filters">
                <div className="field matcher-filter-veld" ref={statusVeldRef}>
                  <button
                    type="button"
                    className="matcher-filter-knop"
                    onClick={() => setOpenFilter(openFilter === 'status' ? null : 'status')}
                  >
                    {filterSamenvatting(statusFilter, 'Status')}
                  </button>
                  {openFilter === 'status' && (
                    <div className="matcher-dropdown">
                      {uniekeWaarden(resultaten, 'bullhorn_status').map((w) => (
                        <label key={w} className="matcher-dropdown-item matcher-filter-optie">
                          <input
                            type="checkbox"
                            checked={statusFilter.includes(w)}
                            onChange={() => toggleFilterWaarde(setStatusFilter, w)}
                          />
                          {w}
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                <div className="field matcher-filter-veld" ref={salarisVeldRef}>
                  <button
                    type="button"
                    className="matcher-filter-knop"
                    onClick={() => setOpenFilter(openFilter === 'salaris' ? null : 'salaris')}
                  >
                    {filterSamenvatting(salarisFilter, 'Salaris range')}
                  </button>
                  {openFilter === 'salaris' && (
                    <div className="matcher-dropdown">
                      {uniekeWaarden(resultaten, 'salaris_band').map((w) => (
                        <label key={w} className="matcher-dropdown-item matcher-filter-optie">
                          <input
                            type="checkbox"
                            checked={salarisFilter.includes(w)}
                            onChange={() => toggleFilterWaarde(setSalarisFilter, w)}
                          />
                          {w}
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                <div className="field matcher-filter-veld" ref={uurtariefVeldRef}>
                  <button
                    type="button"
                    className="matcher-filter-knop"
                    onClick={() => setOpenFilter(openFilter === 'uurtarief' ? null : 'uurtarief')}
                  >
                    {filterSamenvatting(uurtariefFilter, 'Uurtarief range')}
                  </button>
                  {openFilter === 'uurtarief' && (
                    <div className="matcher-dropdown">
                      {uniekeWaarden(resultaten, 'uurtarief_band').map((w) => (
                        <label key={w} className="matcher-dropdown-item matcher-filter-optie">
                          <input
                            type="checkbox"
                            checked={uurtariefFilter.includes(w)}
                            onChange={() => toggleFilterWaarde(setUurtariefFilter, w)}
                          />
                          {w}
                        </label>
                      ))}
                    </div>
                  )}
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
                    <img src={bullhornLogo} alt="" className="matcher-bullhorn-logo" />
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
