import { useState } from 'react'
import { PIJLERS, STELLINGEN, SCORE_OPTIES } from './constants'

function legeAntwoorden() {
  return PIJLERS.map(() => ({ scores: [null, null, null], toelichtingen: ['', '', ''] }))
}

function legeDoelen() {
  return [
    { omschrijving: '', pijler: 1, deadline: '' },
    { omschrijving: '', pijler: 1, deadline: '' },
    { omschrijving: '', pijler: 1, deadline: '' },
  ]
}

/**
 * Gedeeld invulformulier voor zowel de medewerker-zelfevaluatie als de
 * leidinggevende-beoordeling — zelfde 18 stellingen (score + verplichte
 * toelichting), alleen de medewerker vult daarnaast 3 persoonlijke doelen
 * in (toontDoelen=true).
 *
 * Werkt als concept: initialAntwoorden/initialDoelen vullen het formulier
 * met een eerder opgeslagen versie zodat bewerken (zolang de status dit
 * toelaat) niet weer bij nul begint. Alleen gebruikt als startwaarde bij
 * mount (useState-initializer) — een later wijzigende prop synct niet
 * automatisch na, dat is prima zolang de aanroeper wacht tot de initiële
 * data geladen is voordat dit component gemount wordt.
 */
export default function GpbInvulForm({
  titel,
  afdeling,
  functieniveau,
  toontDoelen,
  submitLabel,
  submitting,
  onSubmit,
  initialAntwoorden,
  initialDoelen,
}) {
  const [antwoorden, setAntwoorden] = useState(() => initialAntwoorden ?? legeAntwoorden())
  const [doelen, setDoelen] = useState(() => (toontDoelen ? initialDoelen ?? legeDoelen() : []))
  const [fout, setFout] = useState('')

  const stellingenPerPijler =
    STELLINGEN[afdeling]?.[functieniveau] ?? PIJLERS.map(() => [{ tekst: '—', voorbeeld: '' }, { tekst: '—', voorbeeld: '' }, { tekst: '—', voorbeeld: '' }])

  function setScore(pijlerIdx, stellingIdx, score) {
    setAntwoorden((current) =>
      current.map((p, i) =>
        i !== pijlerIdx ? p : { ...p, scores: p.scores.map((s, j) => (j === stellingIdx ? score : s)) },
      ),
    )
  }

  function setToelichting(pijlerIdx, stellingIdx, tekst) {
    setAntwoorden((current) =>
      current.map((p, i) =>
        i !== pijlerIdx ? p : { ...p, toelichtingen: p.toelichtingen.map((t, j) => (j === stellingIdx ? tekst : t)) },
      ),
    )
  }

  function setDoel(idx, veld, waarde) {
    setDoelen((current) => current.map((d, i) => (i !== idx ? d : { ...d, [veld]: waarde })))
  }

  function valideer() {
    for (const pijler of antwoorden) {
      for (let i = 0; i < 3; i++) {
        if (pijler.scores[i] === null) return 'Vul bij elke stelling een score in.'
        if (!pijler.toelichtingen[i].trim()) return 'Vul bij elke stelling een toelichting in.'
      }
    }
    if (toontDoelen) {
      for (const doel of doelen) {
        if (!doel.omschrijving.trim()) return 'Vul bij elk doel een omschrijving in.'
        if (!doel.deadline) return 'Vul bij elk doel een deadline in.'
      }
    }
    return ''
  }

  function handleSubmit() {
    const foutmelding = valideer()
    if (foutmelding) {
      setFout(foutmelding)
      return
    }
    setFout('')
    onSubmit(antwoorden, doelen)
  }

  return (
    <div className="gpb-invulform">
      <h2>{titel}</h2>

      {PIJLERS.map((pijlerNaam, pijlerIdx) => (
        <div className="section-card gpb-pijler-card" key={pijlerNaam}>
          <p className="calc-section-label">
            Pijler {pijlerIdx + 1}: {pijlerNaam}
          </p>

          {stellingenPerPijler[pijlerIdx].map((stelling, stellingIdx) => (
            <div className="gpb-stelling" key={stellingIdx}>
              <p className="gpb-stelling-tekst">{stelling.tekst}</p>
              {stelling.voorbeeld && <p className="gpb-stelling-voorbeeld">{stelling.voorbeeld}</p>}

              <div className="control-row">
                <span className="control-label">Score</span>
                <div className="btn-group">
                  {SCORE_OPTIES.map((optie) => (
                    <button
                      type="button"
                      key={optie}
                      className={
                        antwoorden[pijlerIdx].scores[stellingIdx] === optie ? 'btn-group-btn active' : 'btn-group-btn'
                      }
                      onClick={() => setScore(pijlerIdx, stellingIdx, optie)}
                      disabled={submitting}
                    >
                      {optie}
                    </button>
                  ))}
                </div>
              </div>

              <textarea
                className="field-textarea"
                placeholder="Toelichting (verplicht)…"
                value={antwoorden[pijlerIdx].toelichtingen[stellingIdx]}
                onChange={(e) => setToelichting(pijlerIdx, stellingIdx, e.target.value)}
                disabled={submitting}
              />
            </div>
          ))}
        </div>
      ))}

      {toontDoelen && (
        <div className="section-card">
          <p className="calc-section-label">Persoonlijke doelen (3 verplicht)</p>
          {doelen.map((doel, idx) => (
            <div className="gpb-doel-row" key={idx}>
              <label className="field">
                <span>Doel {idx + 1}</span>
                <input
                  type="text"
                  value={doel.omschrijving}
                  onChange={(e) => setDoel(idx, 'omschrijving', e.target.value)}
                  disabled={submitting}
                />
              </label>
              <label className="field">
                <span>Gekoppelde pijler</span>
                <select
                  value={doel.pijler}
                  onChange={(e) => setDoel(idx, 'pijler', Number(e.target.value))}
                  disabled={submitting}
                >
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
                  disabled={submitting}
                />
              </label>
            </div>
          ))}
        </div>
      )}

      {fout && (
        <p className="form-error" role="alert">
          {fout}
        </p>
      )}

      <button type="button" className="btn btn-primary" onClick={handleSubmit} disabled={submitting}>
        {submitting ? 'Bezig met opslaan…' : submitLabel}
      </button>
    </div>
  )
}
