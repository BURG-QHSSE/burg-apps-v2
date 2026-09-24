import { useEffect, useState } from 'react'
import { fetchOpdracht, fetchResultaten, slaClaudeResultatenOp } from '../../../lib/externZoekenApi'
import {
  OPDRACHT_VERSIE,
  SNELKOPPELING_NAAM,
  SNELKOPPELING_TEKST,
  leesClaudeResultaten,
  maakClaudeOpdracht,
} from '../../../lib/externZoekenClaude'

/**
 * Eén Extern Zoeken-opdracht, uitgevoerd door Claude in Chrome. Claude leest
 * hier het blok "Opdracht voor Claude" (via het commando /burg-extern-zoeken)
 * en plakt na elke resultatenpagina een JSON-melding in "Resultaten van Claude".
 * Deze pagina ververst zichzelf zolang de opdracht loopt, zodat de consultant
 * de voortgang ook hier ziet.
 */
export default function OpdrachtVoorClaude({ opdrachtId }) {
  const [opdracht, setOpdracht] = useState(null)
  const [resultaten, setResultaten] = useState([])
  const [melding, setMelding] = useState('')
  const [bevestiging, setBevestiging] = useState('')
  const [fout, setFout] = useState('')
  const [bezig, setBezig] = useState(false)
  const [gekopieerd, setGekopieerd] = useState('')

  async function laad() {
    const [o, r] = await Promise.all([fetchOpdracht(opdrachtId), fetchResultaten(opdrachtId)])
    setOpdracht(o)
    setResultaten(r)
  }

  useEffect(() => {
    laad().catch((err) => setFout(err.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opdrachtId])

  const loopt = opdracht && ['concept', 'bezig'].includes(opdracht.status)
  useEffect(() => {
    if (!loopt) return
    const timer = setInterval(() => laad().catch(() => {}), 5000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loopt, opdrachtId])

  async function kopieer(tekst, wat) {
    await navigator.clipboard.writeText(tekst)
    setGekopieerd(wat)
    setTimeout(() => setGekopieerd(''), 2000)
  }

  async function handleOpslaan() {
    setFout('')
    setBevestiging('')
    setBezig(true)
    try {
      const gelezen = leesClaudeResultaten(melding)
      await slaClaudeResultatenOp(opdrachtId, gelezen, OPDRACHT_VERSIE)
      setMelding('')
      setBevestiging(`Opgeslagen: ${gelezen.kandidaten.length} kandidaten, status "${gelezen.status ?? 'bezig'}".`)
      await laad()
    } catch (err) {
      setFout(`Niet opgeslagen: ${err.message}`)
    } finally {
      setBezig(false)
    }
  }

  if (!opdracht) return fout ? <p className="form-error">{fout}</p> : <p>Laden…</p>

  const opdrachtTekst = maakClaudeOpdracht(opdracht, window.location.href)
  const inPipeline = resultaten.filter((r) => r.status === 'toegevoegd').length
  const twijfel = resultaten.filter((r) => r.twijfel).length

  return (
    <>
      <section className="matcher-setup">
        <h2>{opdracht.strategie.projectnaam}</h2>
        <p>
          <strong>Status: {opdracht.status}</strong>
          {opdracht.voortgang && <> — {opdracht.voortgang}</>}
        </p>
        <p>
          {inPipeline} van {opdracht.doel_aantal} in pipeline · {twijfel} twijfelgevallen
          {opdracht.aantal_resultaten && <> · {opdracht.aantal_resultaten} resultaten in Recruiter</>}
          {opdracht.recruiter_project_id?.startsWith('https://') && (
            <>
              {' '}·{' '}
              <a href={opdracht.recruiter_project_id} target="_blank" rel="noreferrer">
                Open project in Recruiter
              </a>
            </>
          )}
        </p>
        {opdracht.foutmelding && <p className="form-error">{opdracht.foutmelding}</p>}
        {opdracht.status === 'concept' && (
          <ol>
            <li>Laat dit tabblad open.</li>
            <li>Open Claude rechts in Chrome (het Claude-icoon in de werkbalk).</li>
            <li>
              Typ <code>/{SNELKOPPELING_NAAM}</code> en druk op Enter. Claude leest de opdracht hieronder en gaat aan de
              slag; je kunt in Chrome meekijken.
            </li>
          </ol>
        )}
        <details>
          <summary>Eenmalig instellen: commando /{SNELKOPPELING_NAAM} opslaan in Claude</summary>
          <p className="matcher-dropdown-sub">
            Maak in Claude in Chrome een nieuwe snelkoppeling met de naam <code>{SNELKOPPELING_NAAM}</code> en deze tekst:
          </p>
          <pre className="matcher-textarea" style={{ whiteSpace: 'pre-wrap' }}>
            {SNELKOPPELING_TEKST}
          </pre>
          <button type="button" className="btn btn-secondary" onClick={() => kopieer(SNELKOPPELING_TEKST, 'snelkoppeling')}>
            {gekopieerd === 'snelkoppeling' ? 'Gekopieerd' : 'Kopieer tekst'}
          </button>
        </details>
      </section>

      <section className="matcher-setup">
        <h2>Resultaten van Claude</h2>
        <p className="matcher-dropdown-sub">Claude plakt hier na elke resultatenpagina een melding.</p>
        {fout && <p className="form-error">{fout}</p>}
        {bevestiging && <p>{bevestiging}</p>}
        <div className="field">
          <label htmlFor="extern-claude-melding">Resultaten van Claude</label>
          <textarea
            id="extern-claude-melding"
            className="matcher-textarea"
            rows={6}
            value={melding}
            onChange={(e) => setMelding(e.target.value)}
          />
        </div>
        <button type="button" className="btn btn-primary" disabled={!melding.trim() || bezig} onClick={handleOpslaan}>
          {bezig ? 'Bezig…' : 'Resultaten opslaan'}
        </button>

        {resultaten.length > 0 && (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Score</th>
                  <th>Kandidaat</th>
                  <th>Status</th>
                  <th>Onderbouwing</th>
                </tr>
              </thead>
              <tbody>
                {resultaten.map((r) => (
                  <tr key={r.id}>
                    <td>{r.score ?? '–'}</td>
                    <td>
                      {r.kaart.profiel_url ? (
                        <a href={r.kaart.profiel_url} target="_blank" rel="noreferrer">
                          {r.kaart.naam}
                        </a>
                      ) : (
                        r.kaart.naam
                      )}
                      <div className="matcher-dropdown-sub">
                        {[r.kaart.kopregel, r.kaart.locatie].filter(Boolean).join(' · ')}
                      </div>
                    </td>
                    <td>
                      {r.status === 'toegevoegd' ? 'In pipeline' : r.twijfel ? 'Twijfel' : 'Niet toegevoegd'}
                      {r.in_bullhorn && <div className="matcher-dropdown-sub">In Bullhorn</div>}
                    </td>
                    <td>{r.onderbouwing}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="matcher-setup">
        <h2>Opdracht voor Claude</h2>
        <button type="button" className="btn btn-secondary" onClick={() => kopieer(opdrachtTekst, 'opdracht')}>
          {gekopieerd === 'opdracht' ? 'Gekopieerd' : 'Kopieer opdracht'}
        </button>
        <pre className="matcher-textarea" style={{ whiteSpace: 'pre-wrap' }}>
          {opdrachtTekst}
        </pre>
      </section>
    </>
  )
}
