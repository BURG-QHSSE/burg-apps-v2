import { useEffect, useState } from 'react'

/**
 * "Vacature doorsturen" modal — poort van `openDoorsturen`/`confirmDoorsturen`
 * uit de bron. Lijst toont alle ANDERE medewerkers (huidige gebruiker
 * uitgesloten), ongeacht aanwezigheid vandaag (matcht de bron: geen
 * aanwezigheidsfilter op deze select).
 */
export default function DoorsturenModal({ open, job, employees, currentUserEmail, onCancel, onConfirm }) {
  const opties = employees.filter((e) => e.email !== currentUserEmail)
  const [target, setTarget] = useState(opties[0]?.email ?? '')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) setTarget(opties[0]?.email ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, job?.id])

  if (!open || !job) return null

  async function handleConfirm() {
    if (!target || saving) return
    setSaving(true)
    try {
      await onConfirm(job, target)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="mo-modal-overlay" onClick={onCancel} />
      <div className="mo-modal-box">
        <div className="mo-modal-title">Vacature doorsturen</div>
        <div className="mo-modal-sub">
          {job.job_title || '—'} — {job.company_name || '—'}
        </div>
        <select className="field-select" value={target} onChange={(e) => setTarget(e.target.value)}>
          {opties.length === 0 && <option value="">Geen andere medewerkers beschikbaar</option>}
          {opties.map((emp) => (
            <option key={emp.id} value={emp.email}>
              {emp.name}
            </option>
          ))}
        </select>
        <div className="mo-modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Annuleren
          </button>
          <button type="button" className="btn btn-primary" disabled={!target || saving} onClick={handleConfirm}>
            {saving ? 'Bezig…' : 'Doorsturen'}
          </button>
        </div>
      </div>
    </>
  )
}
