import { useEffect, useState } from 'react'
import { burgJobsSupabase } from '../../../lib/burgJobsClient'
import { assignGoVacature } from './burgJobsHelpers'
import { NOGO_REASONS, SOURCE_ORDER } from './constants'

/**
 * Swipen-tab — poort van de bron (regel 738-1036), met één bewuste
 * vereenvoudiging: een enkele, gerichte kaart met Go/No-go/Skip/Undo-knoppen
 * i.p.v. een sleepbare stapel-van-kaarten (drag-gestures + fly-out-animaties
 * zijn fragiel om 1-op-1 in React te herbouwen en voegen geen functionaliteit
 * toe — alle beslislogica hieronder is wel exact overgenomen).
 *
 * Blijft altijd gemount (zichtbaarheid via CSS, zie `visible`-prop) zodat de
 * wachtrij-positie niet verloren gaat bij het wisselen naar "Mijn Vacatures"
 * en terug — net als de tab-panels in de bron, die ook altijd in de DOM
 * blijven en enkel van CSS-klasse wisselen.
 */
export default function SwipenTab({
  visible,
  jobs,
  version,
  loading,
  error,
  employees,
  currentUserEmail,
  onRemainingChange,
  onWentGo,
}) {
  const [queue, setQueue] = useState([])
  const [current, setCurrent] = useState(0)
  const [decisions, setDecisions] = useState([])
  const [descExpanded, setDescExpanded] = useState(false)
  const [nogoPopup, setNogoPopup] = useState(null) // job zolang de reden-popup open staat
  const [actionError, setActionError] = useState('')

  // Nieuwe lading (initieel, of na bevestigen aanwezigheid) reset de
  // wachtrij + index/beslissingen — exact het effect van loadSwipe() opnieuw
  // aanroepen in de bron.
  useEffect(() => {
    setQueue(sortBySource(jobs))
    setCurrent(0)
    setDecisions([])
    setDescExpanded(false)
    setNogoPopup(null)
    setActionError('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version])

  useEffect(() => {
    onRemainingChange?.(Math.max(queue.length - current, 0))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue, current])

  useEffect(() => {
    setDescExpanded(false)
  }, [current])

  const vac = current < queue.length ? queue[current] : null
  const isDone = current >= queue.length
  const popupOpen = !!nogoPopup

  async function handleGo() {
    if (!vac || popupOpen) return
    setDecisions((d) => [...d, { vac, action: 'go' }])
    setCurrent((c) => c + 1)
    setActionError('')

    const { error: goError } = await assignGoVacature(vac.id, vac.job_description || '', employees, currentUserEmail)
    if (goError) setActionError('Opslaan van de Go-beslissing is mislukt: ' + goError.message)
    onWentGo?.()
  }

  async function handleNogo() {
    if (!vac || popupOpen) return
    setDecisions((d) => [...d, { vac, action: 'nogo' }])
    setCurrent((c) => c + 1)
    setActionError('')

    const { error: nogoError } = await burgJobsSupabase
      .from('jobs')
      .update({ review_status: 'nogo', reviewed_at: new Date().toISOString() })
      .eq('id', vac.id)
    if (nogoError) setActionError('Opslaan van de No-go-beslissing is mislukt: ' + nogoError.message)

    setNogoPopup(vac)
  }

  function handleSkip() {
    if (!vac || popupOpen) return
    // Puur client-side: verplaats naar het einde van de huidige in-memory
    // wachtrij, geen db-write (exact `swDoAction('skip')` in de bron).
    setQueue((q) => {
      const copy = [...q]
      const [item] = copy.splice(current, 1)
      copy.push(item)
      return copy
    })
  }

  // Herbruikt door zowel de Undo-knop als "← Terug naar vacature" in de
  // no-go-popup (die laatste = `swBackFromNogo`, roept ook gewoon undo aan).
  async function undoLast() {
    if (decisions.length === 0) return
    const last = decisions[decisions.length - 1]
    setDecisions((d) => d.slice(0, -1))
    setCurrent((c) => c - 1)

    if (last.action === 'nogo') {
      await burgJobsSupabase
        .from('jobs')
        .update({ review_status: 'pending', reviewed_at: null, nogo_reason: null })
        .eq('id', last.vac.id)
    } else if (last.action === 'go') {
      // Let op: reviewed_at wordt hier bewust NIET teruggezet — dat doet de
      // bron ook niet (asymmetrie t.o.v. de nogo-tak, exact zo overgenomen).
      await burgJobsSupabase
        .from('jobs')
        .update({
          review_status: 'pending',
          assigned_to: currentUserEmail,
          seniority_level: null,
          seniority_reviewed_at: null,
        })
        .eq('id', last.vac.id)
    }
  }

  async function handleUndoClick() {
    if (popupOpen) return
    await undoLast()
  }

  async function handleSelectNogoReason(reason) {
    if (nogoPopup) {
      await burgJobsSupabase.from('jobs').update({ nogo_reason: reason }).eq('id', nogoPopup.id)
    }
    setNogoPopup(null)
  }

  function handleCloseNogoPopup() {
    // Sluiten via X/achtergrond bevestigt de al opgeslagen no-go zonder
    // reden — geen undo (matcht `closeNogoPopup` in de bron).
    setNogoPopup(null)
  }

  async function handleBackFromNogo() {
    // "← Terug naar vacature" maakt de zojuist gegeven no-go wél ongedaan
    // (matcht `swBackFromNogo`, die swUndo() aanroept).
    setNogoPopup(null)
    await undoLast()
  }

  return (
    <div className={visible ? 'mo-tab-panel' : 'mo-tab-panel mo-tab-panel-hidden'}>
      <div className="mo-swipe-wrap">
        {loading && <div className="idle-state">Vacatures laden…</div>}

        {!loading && error && (
          <p className="form-error" role="alert">
            Kon vacatures niet laden: {error}
          </p>
        )}

        {!loading && !error && (
          <>
            <div className="mo-swipe-stats">
              <span>
                <strong>{decisions.filter((d) => d.action === 'go').length}</strong> Go
              </span>
              <span>
                <strong>{decisions.filter((d) => d.action === 'nogo').length}</strong> No go
              </span>
              <span>
                <strong>{Math.max(queue.length - current, 0)}</strong> Over
              </span>
            </div>

            {actionError && (
              <p className="form-error" role="alert">
                {actionError}
              </p>
            )}

            {isDone && (
              <div className="idle-state mo-swipe-empty">
                Alles beoordeeld — je hebt alle aan jou toegewezen vacatures bekeken.
              </div>
            )}

            {!isDone && vac && (
              <SwipeCard vac={vac} descExpanded={descExpanded} onToggleDesc={() => setDescExpanded((v) => !v)} />
            )}

            {!isDone && (
              <div className="mo-swipe-actions">
                <button
                  type="button"
                  className="btn mo-swipe-btn-nogo"
                  onClick={handleNogo}
                  disabled={popupOpen}
                  title="No go"
                >
                  ✕ No go
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={handleUndoClick}
                  disabled={decisions.length === 0 || popupOpen}
                  title="Ongedaan maken"
                >
                  ↩ Undo
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleSkip}
                  disabled={popupOpen}
                  title="Later"
                >
                  Later
                </button>
                <button
                  type="button"
                  className="btn mo-swipe-btn-go"
                  onClick={handleGo}
                  disabled={popupOpen}
                  title="Go"
                >
                  ✓ Go
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {popupOpen && (
        <NogoReasonPopup
          job={nogoPopup}
          onSelect={handleSelectNogoReason}
          onClose={handleCloseNogoPopup}
          onBack={handleBackFromNogo}
        />
      )}
    </div>
  )
}

function sortBySource(jobs) {
  return [...jobs].sort((a, b) => {
    const oa = SOURCE_ORDER[a.data_source] ?? 99
    const ob = SOURCE_ORDER[b.data_source] ?? 99
    return oa - ob
  })
}

function formatDate(value) {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toLocaleDateString('nl-NL')
}

function SwipeCard({ vac, descExpanded, onToggleDesc }) {
  const datumGescraped = formatDate(vac.date_scraped)

  return (
    <div className="mo-swipe-card">
      <div className="mo-swipe-company">{vac.company_name || '—'}</div>
      <div className="mo-swipe-role">{vac.job_title || '—'}</div>

      {(vac.employment_type || vac.industry) && (
        <div className="mo-swipe-badges">
          {vac.employment_type && <span className="badge badge-blauwgrijs">{vac.employment_type}</span>}
          {vac.industry && <span className="badge badge-inactive">{vac.industry}</span>}
        </div>
      )}

      <div className="mo-swipe-meta">
        <div className="mo-meta-item">
          <span className="mo-meta-label">Locatie</span>
          <span className="mo-meta-value">{vac.job_location || '—'}</span>
        </div>
        {vac.salary && (
          <div className="mo-meta-item">
            <span className="mo-meta-label">Salaris</span>
            <span className="mo-meta-value mo-meta-value-mos">{vac.salary}</span>
          </div>
        )}
        {vac.data_source && (
          <div className="mo-meta-item">
            <span className="mo-meta-label">Bron</span>
            <span className="mo-meta-value">{vac.data_source}</span>
          </div>
        )}
        {datumGescraped && (
          <div className="mo-meta-item">
            <span className="mo-meta-label">Gevonden</span>
            <span className="mo-meta-value">{datumGescraped}</span>
          </div>
        )}
      </div>

      {vac.job_description && (
        <div className="mo-swipe-desc-wrap">
          <div className={descExpanded ? 'mo-swipe-desc mo-swipe-desc-expanded' : 'mo-swipe-desc'}>
            {vac.job_description}
          </div>
          <button type="button" className="mo-swipe-desc-toggle" onClick={onToggleDesc}>
            {descExpanded ? 'Lees minder ↑' : 'Lees meer ↓'}
          </button>
        </div>
      )}

      {(vac.recruiter_name || vac.contact_name || vac.contact_email || vac.contact_phone) && (
        <div className="mo-swipe-contact">
          {vac.recruiter_name ? (
            <>
              <div className="mo-contact-label">Geplaatst door</div>
              <div className="mo-contact-name">
                {vac.recruiter_name}
                {vac.recruiter_linkedin && (
                  <a className="mo-li-link" href={vac.recruiter_linkedin} target="_blank" rel="noopener noreferrer">
                    {' '}
                    in
                  </a>
                )}
              </div>
            </>
          ) : vac.contact_name ? (
            <>
              <div className="mo-contact-label">Contact</div>
              <div className="mo-contact-name">{vac.contact_name}</div>
            </>
          ) : null}

          {(vac.contact_email || vac.contact_phone) && (
            <div className="mo-swipe-contact-links">
              {vac.contact_email && (
                <a className="mo-contact-link" href={`mailto:${vac.contact_email}`}>
                  ✉ {vac.contact_email}
                </a>
              )}
              {vac.contact_phone && (
                <a className="mo-contact-link" href={`tel:${vac.contact_phone}`}>
                  ✆ {vac.contact_phone}
                </a>
              )}
            </div>
          )}
        </div>
      )}

      {(vac.job_url || vac.company_website) && (
        <div className="mo-swipe-links">
          {vac.job_url && (
            <a className="mo-contact-link" href={vac.job_url} target="_blank" rel="noopener noreferrer">
              ↗ Vacature
            </a>
          )}
          {vac.company_website && (
            <a className="mo-contact-link" href={vac.company_website} target="_blank" rel="noopener noreferrer">
              🌐 Website
            </a>
          )}
        </div>
      )}
    </div>
  )
}

function NogoReasonPopup({ job, onSelect, onClose, onBack }) {
  return (
    <>
      <div className="mo-modal-overlay" onClick={onClose} />
      <div className="mo-modal-box mo-nogo-popup">
        <div className="mo-modal-title">Waarom geen match?</div>
        <div className="mo-modal-sub">
          {job.job_title || '—'} — {job.company_name || '—'}
        </div>
        <div className="mo-nogo-reasons">
          {NOGO_REASONS.map((reason) => (
            <button type="button" key={reason} className="btn-toggle" onClick={() => onSelect(reason)}>
              {reason}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-ghost mo-nogo-back" onClick={onBack}>
          ← Terug naar vacature
        </button>
      </div>
    </>
  )
}
