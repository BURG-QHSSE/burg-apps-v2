import { useEffect, useRef, useState } from 'react'
import { PIJLERS, STELLINGEN, SCORE_OPTIES, scoreBetekenis, functieLabel, berekenEindscore, fmtScore, STATUS_LABELS } from './constants'
import { hrUpdateGpbMedewerker, hrUpdateGpbLeidinggevende, hrUpdateGpbDoelen } from '../../../lib/gpbApi'

const AUTOSAVE_DEBOUNCE_MS = 1500

function gemiddelde(waarden) {
  return waarden.reduce((a, b) => a + b, 0) / waarden.length
}

/**
 * Vergelijkingsweergave + volledig rapport in één component (zie
 * GPB-Principes.md: dit zijn twee weergaven van dezelfde vastgelegde data).
 * Scores van de leidinggevende zijn leidend voor de eindscore — de
 * zelfevaluatie van de medewerker is ter vergelijking zichtbaar.
 *
 * hrBewerkbaar (alleen doorgegeven vanuit het Beheer-overzicht, dus alleen
 * bereikbaar voor hr/admin — de RPC's hieronder controleren de rol ook
 * zelf) zet een "Bewerken"-toggle aan waarmee HR tijdens het bespreken van
 * de GPB (functioneringsgesprek) een score, toelichting of doel kan
 * corrigeren zonder dat de medewerker/leidinggevende het formulier
 * opnieuw hoeft in te vullen. onOpgeslagen ververst de data bij de
 * aanroeper na een geslaagde save.
 *
 * Autosave tijdens bewerken (zelfde AUTOSAVE_DEBOUNCE_MS-patroon als
 * GpbInvulForm — gebouwd naar aanleiding van hetzelfde soort dataverlies-
 * risico: HR kan een tijdje bezig zijn met corrigeren tijdens een
 * functioneringsgesprek, en zonder tussentijds opslaan gaat dat verloren
 * als de tab dichtgaat of de sessie verloopt vóór er op "Wijzigingen
 * opslaan" is geklikt). Doelen worden pas meegestuurd zodra ze compleet
 * zijn (omschrijving + deadline) — anders faalt de datum-cast in
 * hr_update_gpb_doelen terwijl iemand nog gewoon aan het typen is.
 */
export default function GpbRapport({ beoordeling, doelen, acties, hrBewerkbaar, onOpgeslagen }) {
  const medewerkerAntwoorden = beoordeling.medewerker_antwoorden
  const leidinggevendeAntwoorden = beoordeling.leidinggevende_antwoorden

  const [bewerken, setBewerken] = useState(false)
  const [conceptMedewerker, setConceptMedewerker] = useState(medewerkerAntwoorden)
  const [conceptLeidinggevende, setConceptLeidinggevende] = useState(leidinggevendeAntwoorden)
  const [conceptDoelen, setConceptDoelen] = useState(
    doelen.map((d) => ({ omschrijving: d.omschrijving, pijler: d.pijler, deadline: d.deadline })),
  )
  const [opslaan, setOpslaan] = useState(false)
  const [fout, setFout] = useState('')
  const [conceptStatus, setConceptStatus] = useState('')
  const isEersteWijziging = useRef(true)

  const pijlerGemiddeldes = PIJLERS.map((_, i) => ({
    medewerker: medewerkerAntwoorden ? gemiddelde(medewerkerAntwoorden[i].scores) : null,
    leidinggevende: leidinggevendeAntwoorden ? gemiddelde(leidinggevendeAntwoorden[i].scores) : null,
  }))

  // Zelfde stellingen-tekst als in GpbInvulForm — zonder deze zie je in het
  // rapport alleen een los cijfer + toelichting, niet welke stelling erbij
  // hoort. Bij het bespreken van het rapport (functioneringsgesprek) is dat
  // net de context die nodig is.
  const stellingenPerPijler =
    STELLINGEN[beoordeling.afdeling]?.[beoordeling.functieniveau] ??
    PIJLERS.map(() => [{ tekst: '—', voorbeeld: '' }, { tekst: '—', voorbeeld: '' }, { tekst: '—', voorbeeld: '' }])

  const eindscore = berekenEindscore(beoordeling)
  const kanBewerken = hrBewerkbaar && beoordeling.status !== 'definitief'

  function startBewerken() {
    setConceptMedewerker(medewerkerAntwoorden)
    setConceptLeidinggevende(leidinggevendeAntwoorden)
    setConceptDoelen(doelen.map((d) => ({ omschrijving: d.omschrijving, pijler: d.pijler, deadline: d.deadline })))
    setFout('')
    setConceptStatus('')
    isEersteWijziging.current = true
    setBewerken(true)
  }

  useEffect(() => {
    if (!bewerken || opslaan) return undefined

    if (isEersteWijziging.current) {
      isEersteWijziging.current = false
      return undefined
    }

    const geldigeDoelen = conceptDoelen.filter((d) => d.omschrijving.trim() !== '' && d.deadline !== '')

    const timer = setTimeout(() => {
      setConceptStatus('bezig')
      Promise.all([
        conceptMedewerker ? hrUpdateGpbMedewerker(beoordeling.id, conceptMedewerker) : null,
        conceptLeidinggevende ? hrUpdateGpbLeidinggevende(beoordeling.id, conceptLeidinggevende) : null,
        geldigeDoelen.length > 0 ? hrUpdateGpbDoelen(beoordeling.id, geldigeDoelen) : null,
      ])
        .then(() => setConceptStatus('opgeslagen'))
        .catch(() => setConceptStatus('mislukt'))
    }, AUTOSAVE_DEBOUNCE_MS)

    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conceptMedewerker, conceptLeidinggevende, conceptDoelen, bewerken])

  useEffect(() => {
    if (conceptStatus !== 'opgeslagen') return undefined
    const timer = setTimeout(() => setConceptStatus(''), 2500)
    return () => clearTimeout(timer)
  }, [conceptStatus])

  function setMedewerkerScore(pijlerIdx, stellingIdx, score) {
    setConceptMedewerker((current) =>
      current.map((p, i) =>
        i !== pijlerIdx ? p : { ...p, scores: p.scores.map((s, j) => (j === stellingIdx ? score : s)) },
      ),
    )
  }

  function setMedewerkerToelichting(pijlerIdx, stellingIdx, tekst) {
    setConceptMedewerker((current) =>
      current.map((p, i) =>
        i !== pijlerIdx ? p : { ...p, toelichtingen: p.toelichtingen.map((t, j) => (j === stellingIdx ? tekst : t)) },
      ),
    )
  }

  function setLeidinggevendeScore(pijlerIdx, stellingIdx, score) {
    setConceptLeidinggevende((current) =>
      current.map((p, i) =>
        i !== pijlerIdx ? p : { ...p, scores: p.scores.map((s, j) => (j === stellingIdx ? score : s)) },
      ),
    )
  }

  function setLeidinggevendeToelichting(pijlerIdx, stellingIdx, tekst) {
    setConceptLeidinggevende((current) =>
      current.map((p, i) =>
        i !== pijlerIdx ? p : { ...p, toelichtingen: p.toelichtingen.map((t, j) => (j === stellingIdx ? tekst : t)) },
      ),
    )
  }

  function setDoel(idx, veld, waarde) {
    setConceptDoelen((current) => current.map((d, i) => (i !== idx ? d : { ...d, [veld]: waarde })))
  }

  async function handleOpslaan() {
    setOpslaan(true)
    setFout('')
    try {
      if (conceptMedewerker) await hrUpdateGpbMedewerker(beoordeling.id, conceptMedewerker)
      if (conceptLeidinggevende) await hrUpdateGpbLeidinggevende(beoordeling.id, conceptLeidinggevende)
      if (conceptDoelen.length > 0) await hrUpdateGpbDoelen(beoordeling.id, conceptDoelen)
      await onOpgeslagen?.()
      setConceptStatus('')
      setBewerken(false)
    } catch (err) {
      setFout(err.message)
    } finally {
      setOpslaan(false)
    }
  }

  function annuleerBewerken() {
    setConceptStatus('')
    setBewerken(false)
  }

  return (
    <div className="gpb-rapport">
      <div className="gpb-rapport-header">
        <div>
          <h2>{beoordeling.medewerker_naam}</h2>
          <p className="page-intro">
            {beoordeling.afdeling} · {functieLabel(beoordeling.afdeling, beoordeling.functieniveau)} · {beoordeling.periode}
          </p>
        </div>
        <div className="gpb-rapport-header-acties gpb-print-hide">
          {kanBewerken && !bewerken && (
            <button type="button" className="btn btn-secondary" onClick={startBewerken}>
              Bewerken
            </button>
          )}
          <span className={`badge badge-${beoordeling.status === 'definitief' ? 'mos' : 'blauwgrijs'}`}>
            {STATUS_LABELS[beoordeling.status]}
          </span>
        </div>
      </div>

      {fout && (
        <p className="form-error" role="alert">
          {fout}
        </p>
      )}

      {eindscore !== null && (
        <div className="section-card gpb-eindscore-card">
          <span className="metric-card-label">Eindscore (leidinggevende leidend)</span>
          <span className="metric-card-value">{fmtScore(eindscore)}</span>
        </div>
      )}

      {PIJLERS.map((pijlerNaam, i) => (
        <div className="section-card gpb-pijler-card" key={pijlerNaam}>
          <p className="calc-section-label">
            Pijler {i + 1}: {pijlerNaam} — gem. medewerker {fmtScore(pijlerGemiddeldes[i].medewerker)} · gem.
            leidinggevende {fmtScore(pijlerGemiddeldes[i].leidinggevende)}
          </p>

          {stellingenPerPijler[i].map((stelling, j) => (
            <div className="gpb-stelling" key={j}>
              <p className="gpb-stelling-tekst">
                <span className="gpb-stelling-nummer">
                  {i + 1}.{j + 1}
                </span>
                {stelling.tekst}
              </p>
              {stelling.voorbeeld && <p className="gpb-stelling-voorbeeld">{stelling.voorbeeld}</p>}

              <div className="gpb-vergelijk-grid">
                <div>
                  <p className="control-label">Zelfevaluatie</p>
                  {!medewerkerAntwoorden ? (
                    <p className="idle-state">Nog niet ingevuld.</p>
                  ) : bewerken ? (
                    <div className="gpb-vergelijk-item">
                      <div className="btn-group">
                        {SCORE_OPTIES.map((optie) => (
                          <button
                            type="button"
                            key={optie}
                            className={conceptMedewerker[i].scores[j] === optie ? 'btn-group-btn active' : 'btn-group-btn'}
                            onClick={() => setMedewerkerScore(i, j, optie)}
                            disabled={opslaan}
                          >
                            {optie}
                          </button>
                        ))}
                      </div>
                      <textarea
                        className="field-textarea"
                        value={conceptMedewerker[i].toelichtingen[j]}
                        onChange={(e) => setMedewerkerToelichting(i, j, e.target.value)}
                        disabled={opslaan}
                      />
                    </div>
                  ) : (
                    <div className="gpb-vergelijk-item">
                      <span className="badge badge-blauwgrijs">
                        {medewerkerAntwoorden[i].scores[j]} · {scoreBetekenis(medewerkerAntwoorden[i].scores[j])}
                      </span>
                      <p>{medewerkerAntwoorden[i].toelichtingen[j]}</p>
                    </div>
                  )}
                </div>

                <div>
                  <p className="control-label">Leidinggevende</p>
                  {!leidinggevendeAntwoorden ? (
                    <p className="idle-state">
                      {beoordeling.leidinggevende_ingevuld_at ? 'Ingevuld — zichtbaar na goedkeuring door HR.' : 'Nog niet ingevuld.'}
                    </p>
                  ) : bewerken ? (
                    <div className="gpb-vergelijk-item">
                      <div className="btn-group">
                        {SCORE_OPTIES.map((optie) => (
                          <button
                            type="button"
                            key={optie}
                            className={
                              conceptLeidinggevende[i].scores[j] === optie ? 'btn-group-btn active' : 'btn-group-btn'
                            }
                            onClick={() => setLeidinggevendeScore(i, j, optie)}
                            disabled={opslaan}
                          >
                            {optie}
                          </button>
                        ))}
                      </div>
                      <textarea
                        className="field-textarea"
                        value={conceptLeidinggevende[i].toelichtingen[j]}
                        onChange={(e) => setLeidinggevendeToelichting(i, j, e.target.value)}
                        disabled={opslaan}
                      />
                    </div>
                  ) : (
                    <div className="gpb-vergelijk-item">
                      <span className="badge badge-mos">
                        {leidinggevendeAntwoorden[i].scores[j]} · {scoreBetekenis(leidinggevendeAntwoorden[i].scores[j])}
                      </span>
                      <p>{leidinggevendeAntwoorden[i].toelichtingen[j]}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      ))}

      <div className="section-card">
        <p className="calc-section-label">Persoonlijke doelen</p>
        {doelen.length === 0 ? (
          <p className="idle-state">Nog geen doelen vastgelegd.</p>
        ) : bewerken ? (
          conceptDoelen.map((doel, idx) => (
            <div className="gpb-doel-row" key={idx}>
              <label className="field">
                <span>Doel {idx + 1}</span>
                <input
                  type="text"
                  value={doel.omschrijving}
                  onChange={(e) => setDoel(idx, 'omschrijving', e.target.value)}
                  disabled={opslaan}
                />
              </label>
              <label className="field">
                <span>Gekoppelde pijler</span>
                <select value={doel.pijler} onChange={(e) => setDoel(idx, 'pijler', Number(e.target.value))} disabled={opslaan}>
                  {PIJLERS.map((p, i) => (
                    <option key={p} value={i + 1}>
                      {i + 1}. {p}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Deadline</span>
                <input
                  type="date"
                  value={doel.deadline}
                  onChange={(e) => setDoel(idx, 'deadline', e.target.value)}
                  disabled={opslaan}
                />
              </label>
            </div>
          ))
        ) : (
          doelen.map((doel) => (
            <div className="gpb-doel-item" key={doel.id}>
              <span>{doel.omschrijving}</span>
              <span className="tool-card-hint">
                Pijler {doel.pijler} · deadline {new Date(doel.deadline).toLocaleDateString('nl-NL')}
              </span>
            </div>
          ))
        )}
      </div>

      <div className="gpb-rapport-acties gpb-print-hide">
        {bewerken ? (
          <>
            <button type="button" className="btn btn-primary" onClick={handleOpslaan} disabled={opslaan}>
              {opslaan ? 'Bezig met opslaan…' : 'Wijzigingen opslaan'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={annuleerBewerken} disabled={opslaan}>
              Annuleren
            </button>
            {conceptStatus === 'bezig' && <span className="gpb-concept-status">Tussentijds opslaan…</span>}
            {conceptStatus === 'opgeslagen' && <span className="gpb-concept-status">Tussentijds opgeslagen</span>}
            {conceptStatus === 'mislukt' && (
              <span className="gpb-concept-status gpb-concept-status-fout">Automatisch opslaan mislukt</span>
            )}
          </>
        ) : (
          <>
            {acties}
            <button type="button" className="btn btn-secondary" onClick={() => window.print()}>
              Afdrukken / opslaan als PDF
            </button>
          </>
        )}
      </div>
    </div>
  )
}
