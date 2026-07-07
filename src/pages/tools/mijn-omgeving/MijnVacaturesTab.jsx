import { useCallback, useEffect, useRef, useState } from 'react'
import { burgJobsSupabase } from '../../../lib/burgJobsClient'
import { SALES_STATUSES } from './constants'
import DoorsturenModal from './DoorsturenModal'

// Kolommen exact zoals `loadMijnVacaturesBackground`/`loadMijnVacatures` in
// de bron (regel 1095-1126).
const SELECT_COLUMNS =
  'id, job_title, company_name, job_location, job_url, data_source, date_scraped, reviewed_at, enriched_at, company_website, company_phone, company_industry, company_linkedin, recruiter_name, recruiter_linkedin, recruiter_headline, company_address, salary, employment_type, industry, posted_at, contact_email, contact_phone, sales_status, sales_notes'

function getStatus(job) {
  return job.sales_status || 'Nieuwe kans'
}

function formatDate(value) {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toLocaleDateString('nl-NL')
}

/**
 * "Mijn Vacatures"-tab — poort van `loadMijnVacatures`/`renderMijnVacatures`/
 * `buildMvCard` uit de bron (regel 1095 e.v.). Blijft altijd gemount
 * (zichtbaarheid via `visible`-prop + CSS), zodat het geselecteerde filter
 * niet verloren gaat bij het wisselen naar Swipen en terug.
 */
export default function MijnVacaturesTab({ visible, employees, currentUserEmail, refreshToken, onToast }) {
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('all')
  const [doorsturenJob, setDoorsturenJob] = useState(null)

  const load = useCallback(
    async (silent) => {
      if (!currentUserEmail) return
      if (!silent) setLoading(true)

      const { data, error: loadError } = await burgJobsSupabase
        .from('jobs')
        .select(SELECT_COLUMNS)
        .eq('review_status', 'go')
        .eq('assigned_to', currentUserEmail)
        .order('reviewed_at', { ascending: false })

      if (loadError) {
        if (!silent) {
          setError(loadError.message)
          setLoading(false)
        }
        return
      }

      setJobs(data || [])
      setError('')
      if (!silent) setLoading(false)
    },
    [currentUserEmail],
  )

  // Initiële lading (en herlading als de ingelogde gebruiker wijzigt).
  useEffect(() => {
    load(false)
  }, [load])

  // Stille herlading na een Go-beslissing op de Swipen-tab — matcht
  // `loadMijnVacaturesBackground()` in de bron. De eerste effect-run (bij
  // mount) wordt overgeslagen: die dekt `load(false)` hierboven al af.
  const skippedFirstRefresh = useRef(false)
  useEffect(() => {
    if (!skippedFirstRefresh.current) {
      skippedFirstRefresh.current = true
      return
    }
    load(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken])

  const filtered = filter === 'all' ? jobs : jobs.filter((j) => getStatus(j) === filter)

  const counts = {}
  jobs.forEach((j) => {
    const s = getStatus(j)
    counts[s] = (counts[s] || 0) + 1
  })

  async function updateStatus(jobId, status) {
    setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, sales_status: status } : j)))
    await burgJobsSupabase.from('jobs').update({ sales_status: status }).eq('id', jobId)
    onToast?.('Status opgeslagen.')
  }

  function updateNotesLocal(jobId, value) {
    setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, sales_notes: value } : j)))
  }

  async function saveNotes(jobId, value) {
    await burgJobsSupabase.from('jobs').update({ sales_notes: value }).eq('id', jobId)
  }

  async function confirmDoorsturen(job, toEmail) {
    await burgJobsSupabase.from('jobs').update({ assigned_to: toEmail }).eq('id', job.id)
    setJobs((prev) => prev.filter((j) => j.id !== job.id))
    setDoorsturenJob(null)
    onToast?.('Vacature doorgestuurd.')
  }

  return (
    <div className={visible ? 'mo-tab-panel' : 'mo-tab-panel mo-tab-panel-hidden'}>
      {loading && <div className="idle-state">Vacatures laden…</div>}

      {!loading && error && (
        <p className="form-error" role="alert">
          Kon vacatures niet laden: {error}
        </p>
      )}

      {!loading && !error && (
        <>
          <div className="btn-toggle-group mo-mv-summary">
            <button
              type="button"
              className={filter === 'all' ? 'btn-toggle active' : 'btn-toggle'}
              onClick={() => setFilter('all')}
            >
              Alle <span className="mo-count-pill">{jobs.length}</span>
            </button>
            {SALES_STATUSES.filter((s) => counts[s]).map((s) => (
              <button
                type="button"
                key={s}
                className={filter === s ? 'btn-toggle active' : 'btn-toggle'}
                onClick={() => setFilter(s)}
              >
                {s} <span className="mo-count-pill">{counts[s]}</span>
              </button>
            ))}
          </div>

          {filtered.length === 0 && <div className="idle-state">Geen vacatures in dit filter.</div>}

          <div className="mo-vac-list">
            {filtered.map((job) => (
              <VacatureCard
                key={job.id}
                job={job}
                onUpdateStatus={updateStatus}
                onNotesChange={updateNotesLocal}
                onNotesSave={saveNotes}
                onDoorsturen={() => setDoorsturenJob(job)}
              />
            ))}
          </div>
        </>
      )}

      <DoorsturenModal
        open={!!doorsturenJob}
        job={doorsturenJob}
        employees={employees}
        currentUserEmail={currentUserEmail}
        onCancel={() => setDoorsturenJob(null)}
        onConfirm={confirmDoorsturen}
      />
    </div>
  )
}

function VacatureCard({ job, onUpdateStatus, onNotesChange, onNotesSave, onDoorsturen }) {
  const [notesStatus, setNotesStatus] = useState('idle') // idle | saving | saved
  const timerRef = useRef(null)

  useEffect(() => () => clearTimeout(timerRef.current), [])

  function handleNotesInput(e) {
    const value = e.target.value
    onNotesChange(job.id, value)
    setNotesStatus('saving')
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(async () => {
      await onNotesSave(job.id, value)
      setNotesStatus('saved')
      setTimeout(() => setNotesStatus('idle'), 2000)
    }, 1000)
  }

  const posted = formatDate(job.posted_at)
  const scraped = formatDate(job.date_scraped) || formatDate(job.reviewed_at)
  const status = getStatus(job)

  let enrichBadge
  if (job.enriched_at) {
    enrichBadge = <span className="badge badge-mos">Verrijkt</span>
  } else if (job.recruiter_linkedin) {
    enrichBadge = <span className="badge badge-blauwgrijs">Wacht op verrijking</span>
  } else {
    enrichBadge = <span className="badge badge-inactive">Geen Apollo beschikbaar</span>
  }

  return (
    <div className="mo-vac-card">
      <div className="mo-vac-header">
        <div>
          <div className="mo-vac-title">{job.job_title || '—'}</div>
          <div className="mo-vac-company">
            {job.company_name || '—'}
            {job.company_linkedin && (
              <a className="mo-li-link" href={job.company_linkedin} target="_blank" rel="noopener noreferrer">
                {' '}
                in
              </a>
            )}
          </div>
        </div>
        <span className="badge badge-mos">Go</span>
      </div>

      <div className="mo-vac-meta">
        {job.job_location && <span className="mo-meta-chip">📍 {job.job_location}</span>}
        {job.data_source && <span className="mo-meta-chip">🔍 {job.data_source}</span>}
        {posted ? (
          <span className="mo-meta-chip">📅 Geplaatst op: {posted}</span>
        ) : scraped ? (
          <span className="mo-meta-chip">📅 {scraped}</span>
        ) : null}
        {job.job_url && (
          <a className="mo-meta-chip" href={job.job_url} target="_blank" rel="noopener noreferrer">
            ↗ Bekijk vacature
          </a>
        )}
      </div>

      {(job.salary || job.employment_type || job.industry) && (
        <div className="mo-vac-badges">
          {job.salary && <span className="badge badge-mos">💶 {job.salary}</span>}
          {job.employment_type && <span className="badge badge-blauwgrijs">{job.employment_type}</span>}
          {job.industry && <span className="badge badge-inactive">{job.industry}</span>}
        </div>
      )}

      <div className="mo-contact-section">
        <p className="calc-section-label">Contactinformatie</p>
        <div className="mo-contact-grid">
          {job.recruiter_name && (
            <div className="mo-contact-block">
              <div className="mo-contact-label">Contactpersoon</div>
              <div className="mo-contact-name">
                {job.recruiter_name}
                {job.recruiter_linkedin && (
                  <a className="mo-li-link" href={job.recruiter_linkedin} target="_blank" rel="noopener noreferrer">
                    {' '}
                    in
                  </a>
                )}
              </div>
              {job.recruiter_headline && <div className="mo-contact-sub">{job.recruiter_headline}</div>}
            </div>
          )}

          {(job.company_website || job.company_address) && (
            <div className="mo-contact-block">
              <div className="mo-contact-label">Bedrijf</div>
              {job.company_website && (
                <a className="mo-contact-link" href={job.company_website} target="_blank" rel="noopener noreferrer">
                  🌐 {job.company_website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                </a>
              )}
              {job.company_address && <div className="mo-contact-sub">📍 {job.company_address}</div>}
            </div>
          )}

          <div className="mo-contact-block">
            <div className="mo-contact-label">Contact (Apollo)</div>
            {job.contact_email ? (
              <a className="mo-contact-link" href={`mailto:${job.contact_email}`}>
                ✉ {job.contact_email}
              </a>
            ) : (
              <span className="mo-contact-placeholder">✉ nog niet verrijkt</span>
            )}
            {job.contact_phone ? (
              <a className="mo-contact-link" href={`tel:${job.contact_phone}`}>
                ✆ {job.contact_phone}
              </a>
            ) : (
              <span className="mo-contact-placeholder">✆ nog niet verrijkt</span>
            )}
          </div>
        </div>
      </div>

      <div className="mo-enrich-row">
        {enrichBadge}
        {job.enriched_at && (job.company_industry || job.company_phone) && (
          <span className="mo-enrich-details">
            {job.company_industry ? `🏭 ${job.company_industry}` : ''}
            {job.company_industry && job.company_phone ? ' · ' : ''}
            {job.company_phone ? `✆ ${job.company_phone}` : ''}
          </span>
        )}
      </div>

      <div className="mo-sales-section">
        <p className="calc-section-label">Sales opvolging</p>
        <div className="control-row">
          <span className="control-label">Status</span>
          <div className="btn-group">
            {SALES_STATUSES.map((s) => (
              <button
                type="button"
                key={s}
                className={status === s ? 'btn-group-btn active' : 'btn-group-btn'}
                onClick={() => onUpdateStatus(job.id, s)}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
        <div className="control-row">
          <span className="control-label">Notities</span>
          <textarea
            className="field-textarea"
            placeholder="Voeg notities toe…"
            value={job.sales_notes || ''}
            onChange={handleNotesInput}
          />
          <span
            className={
              notesStatus === 'idle' ? 'mo-save-indicator' : `mo-save-indicator mo-save-indicator-${notesStatus}`
            }
          >
            {notesStatus === 'saving' ? 'Opslaan…' : notesStatus === 'saved' ? 'Opgeslagen' : ''}
          </span>
        </div>
      </div>

      <div className="mo-vac-actions">
        <button type="button" className="btn btn-secondary" onClick={onDoorsturen}>
          Doorsturen →
        </button>
      </div>
    </div>
  )
}
