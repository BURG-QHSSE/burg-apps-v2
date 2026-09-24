import { useEffect, useState } from 'react'
import {
  berekenVerbruik,
  fetchOpdracht,
  fetchResultaten,
  neemBerichtBesluit,
  slaClaudeResultatenOp,
} from '../../../lib/externZoekenApi'
import {
  BERICHTEN_BLOK,
  BERICHTEN_VERSTUREN,
  OPDRACHT_VERSIE,
  SNELKOPPELINGEN,
  ZOEK_BLOK,
  leesClaudeResultaten,
  maakBerichtenOpdracht,
  maakZoekOpdracht,
} from '../../../lib/externZoekenClaude'

/**
 * Eén Extern Zoeken-opdracht, uitgevoerd door Claude in Chrome. Claude leest
 * hier het blok "Zoekopdracht voor Claude" (commando /burg-extern-zoeken) of
 * "Berichtenopdracht voor Claude" (commando /burg-berichten) en plakt steeds
 * een JSON-melding in "Resultaten van Claude".
 * Deze pagina ververst zichzelf zolang de opdracht loopt, zodat de consultant
 * de voortgang ook hier ziet.
 *
 * Na het zoeken volgt de fase berichten: Claude stuurt InMails aan de
 * pipeline; bij eerder contact (< 3 maanden) wacht het bericht hier op de
 * keuze van de consultant, en een volgende run verstuurt de goedgekeurde.
 */

// Alles wat in de Recruiter-pipeline staat, ongeacht waar het bericht is.
const IN_PIPELINE = ['toegevoegd', 'bericht_klaar', 'bericht_goedgekeurd', 'bericht_afgewezen', 'verzonden', 'fout']

const STATUS_LABEL = {
  toegevoegd: 'In pipeline',
  bericht_klaar: BERICHTEN_VERSTUREN ? 'Wacht op jouw keuze' : 'Bericht klaargezet',
  bericht_goedgekeurd: 'Goedgekeurd, wordt verstuurd',
  bericht_afgewezen: 'Niet versturen',
  verzonden: 'Bericht verstuurd',
  fout: 'Fout bij bericht',
}
export default function OpdrachtVoorClaude({ opdrachtId }) {
  const [opdracht, setOpdracht] = useState(null)
  const [resultaten, setResultaten] = useState([])
  const [melding, setMelding] = useState('')
  const [bevestiging, setBevestiging] = useState('')
  const [fout, setFout] = useState('')
  const [bezig, setBezig] = useState(false)
  const [gekopieerd, setGekopieerd] = useState('')
  const [concepten, setConcepten] = useState({})

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

  async function handleBesluit(r, versturen) {
    setFout('')
    try {
      await neemBerichtBesluit(opdrachtId, r.id, versturen, concepten[r.id] ?? r.bericht)
      await laad()
    } catch (err) {
      setFout(err.message)
    }
  }

  if (!opdracht) return fout ? <p className="form-error">{fout}</p> : <p>Laden…</p>

  const zoekTekst = maakZoekOpdracht(opdracht, window.location.href)
  const berichtenTekst = maakBerichtenOpdracht(opdracht, window.location.href, resultaten)
  const inPipeline = resultaten.filter((r) => IN_PIPELINE.includes(r.status)).length
  const twijfel = resultaten.filter((r) => r.twijfel).length
  const verzonden = resultaten.filter((r) => r.status === 'verzonden').length
  const wachtOpKeuze = resultaten.filter((r) => r.status === 'bericht_klaar')
  const zoekenKlaar = opdracht.fase === 'berichten' || opdracht.status === 'klaar'
  // Werk voor /burg-berichten: kandidaten zonder bericht, of (als versturen aanstaat) goedgekeurde berichten.
  const berichtenTeDoen = resultaten.some(
    (r) => r.status === 'toegevoegd' || (BERICHTEN_VERSTUREN && r.status === 'bericht_goedgekeurd'),
  )
  const volgendCommando = !zoekenKlaar
    ? SNELKOPPELINGEN.zoeken.naam
    : berichtenTeDoen && opdracht.status !== 'bezig'
      ? SNELKOPPELINGEN.berichten.naam
      : null
  const verbruik = berekenVerbruik(opdracht.verbruik)

  return (
    <>
      <section className="matcher-setup">
        <h2>{opdracht.strategie.projectnaam}</h2>
        <p>
          <strong>
            {opdracht.fase === 'berichten' ? 'Berichten' : 'Zoeken'} — {opdracht.status}
          </strong>
          {opdracht.voortgang && <> — {opdracht.voortgang}</>}
        </p>
        <p>
          {inPipeline} van {opdracht.doel_aantal} in pipeline · {twijfel} twijfelgevallen
          {opdracht.fase === 'berichten' && <> · {verzonden} berichten verstuurd</>}
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
        {verbruik.map((v) => (
          <p key={v.fase}>
            Claude-verbruik ({v.fase}):{' '}
            {v.runs > 0 && (
              <>
                {v.sessieGereset ? `minstens ${v.sessie}` : v.sessie}% van de 5-uurslimiet · {v.week}% van de weeklimiet
                {' '}· {v.minuten} min{v.runs > 1 && ` (${v.runs} runs)`}
              </>
            )}
            {v.open && (
              <>
                {v.runs > 0 && ' · '}run loopt nog (gestart op {v.open.sessie_pct}% sessie / {v.open.week_pct}% week)
              </>
            )}
          </p>
        ))}
        {opdracht.foutmelding && <p className="form-error">{opdracht.foutmelding}</p>}
        {volgendCommando && opdracht.status !== 'bezig' && (
          <ol>
            <li>Laat dit tabblad open.</li>
            <li>Open Claude rechts in Chrome (het Claude-icoon in de werkbalk).</li>
            <li>
              Typ <code>/{volgendCommando}</code> en druk op Enter.{' '}
              {volgendCommando === SNELKOPPELINGEN.berichten.naam
                ? BERICHTEN_VERSTUREN
                  ? 'Claude schrijft en verstuurt de berichten.'
                  : 'Claude schrijft de berichten en zet ze hier klaar (er wordt niets verstuurd).'
                : 'Claude zoekt in Recruiter en vult de pipeline.'}{' '}
              Je kunt in Chrome meekijken.
            </li>
          </ol>
        )}
        {/* Tijdelijk: weg zodra de commando's bij iedereen zijn ingesteld. */}
        <details>
          <summary>Eenmalig instellen: commando's opslaan in Claude</summary>
          {Object.values(SNELKOPPELINGEN).map((k) => (
            <div className="field" key={k.naam}>
              <p className="matcher-dropdown-sub">
                Snelkoppeling met de naam <code>{k.naam}</code> en deze tekst:
              </p>
              <pre className="matcher-textarea" style={{ whiteSpace: 'pre-wrap' }}>
                {k.tekst}
              </pre>
              <button type="button" className="btn btn-secondary" onClick={() => kopieer(k.tekst, k.naam)}>
                {gekopieerd === k.naam ? 'Gekopieerd' : 'Kopieer tekst'}
              </button>
            </div>
          ))}
        </details>
      </section>

      {!BERICHTEN_VERSTUREN && wachtOpKeuze.length > 0 && (
        <section className="matcher-setup">
          <h2>Klaargezette berichten ({wachtOpKeuze.length})</h2>
          <p className="matcher-dropdown-sub">
            MVP: Claude heeft deze berichten alleen geschreven, er is niets verstuurd.
            {' '}{wachtOpKeuze.filter((r) => r.eerder_contact).length} kandidaten hadden de afgelopen 3 maanden al
            contact — die zouden later eerst jouw keuze vragen.
          </p>
          {wachtOpKeuze.map((r) => (
            <div className="field" key={r.id}>
              <label>
                {r.kaart.profiel_url ? (
                  <a href={r.kaart.profiel_url} target="_blank" rel="noreferrer">
                    {r.kaart.naam}
                  </a>
                ) : (
                  r.kaart.naam
                )}
                {r.kaart.kopregel && <> — {r.kaart.kopregel}</>}
              </label>
              {r.eerder_contact && <p className="form-error">Eerder contact: {r.eerder_contact}</p>}
              <p className="matcher-dropdown-sub">Onderwerp: {r.onderwerp}</p>
              <pre className="matcher-textarea" style={{ whiteSpace: 'pre-wrap' }}>
                {r.bericht}
              </pre>
            </div>
          ))}
        </section>
      )}

      {BERICHTEN_VERSTUREN && wachtOpKeuze.length > 0 && (
        <section className="matcher-setup">
          <h2>Wacht op jouw keuze ({wachtOpKeuze.length})</h2>
          <p className="matcher-dropdown-sub">
            Deze kandidaten hebben de afgelopen 3 maanden al een bericht gehad. Claude heeft een bericht klaargezet maar
            nog niet verstuurd. Na je keuzes start je Claude opnieuw met <code>/{SNELKOPPELINGEN.berichten.naam}</code>; dan worden
            alleen de goedgekeurde berichten verstuurd.
          </p>
          {wachtOpKeuze.map((r) => (
            <div className="field" key={r.id}>
              <label htmlFor={`bericht-${r.id}`}>
                {r.kaart.profiel_url ? (
                  <a href={r.kaart.profiel_url} target="_blank" rel="noreferrer">
                    {r.kaart.naam}
                  </a>
                ) : (
                  r.kaart.naam
                )}{' '}
                — {r.eerder_contact}
              </label>
              <p className="matcher-dropdown-sub">Onderwerp: {r.onderwerp}</p>
              <textarea
                id={`bericht-${r.id}`}
                className="matcher-textarea"
                rows={7}
                value={concepten[r.id] ?? r.bericht ?? ''}
                onChange={(e) => setConcepten((c) => ({ ...c, [r.id]: e.target.value }))}
              />
              <div className="matcher-upload-row">
                <button type="button" className="btn btn-primary" onClick={() => handleBesluit(r, true)}>
                  Versturen
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => handleBesluit(r, false)}>
                  Niet versturen
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

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
                      {STATUS_LABEL[r.status] ?? (r.twijfel ? 'Twijfel' : 'Niet toegevoegd')}
                      {r.eerder_contact && <div className="matcher-dropdown-sub">{r.eerder_contact}</div>}
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
        <h2>{ZOEK_BLOK}</h2>
        <pre className="matcher-textarea" style={{ whiteSpace: 'pre-wrap' }}>
          {zoekTekst}
        </pre>
      </section>

      {zoekenKlaar && (
        <section className="matcher-setup">
          <h2>{BERICHTEN_BLOK}</h2>
          <pre className="matcher-textarea" style={{ whiteSpace: 'pre-wrap' }}>
            {berichtenTeDoen ? berichtenTekst : 'Er zijn geen kandidaten die nog een bericht nodig hebben — niets te doen.'}
          </pre>
        </section>
      )}
    </>
  )
}
