import { useState } from 'react'

/**
 * Aanwezigheidswidget ("Aanwezigheid vandaag") — poort van `renderPresenceBlock`
 * / `confirmPresence` uit de bron (regel 656-700). Checkbox per medewerker
 * (voornaam + fte_hours), knop blijft disabled tot er iets wijzigt.
 * Bevestigen schrijft `is_present` per medewerker naar burg-jobs en laat de
 * ouder de herverdeling + swipe-reload doen (zie MijnOmgeving.jsx).
 *
 * Sales staat altijd direct zichtbaar, de rest (Recruitment/Corporate/
 * onbekend) klapt in onder "Overig" — op verzoek van Nils, voor overzicht
 * nu iedereen (20+ medewerkers) in één platte grid stond. `afdeling` staat
 * gewoon op de employee-rij zelf (kolom op de employees-tabel,
 * burg-jobs-project). Eerder werd dit afgeleid uit GPB-beoordelingen, maar
 * dat bleek te onbetrouwbaar: verouderd (wisselde niet mee bij een
 * teamwissel/uitdiensttreding) en onvolledig (~helft van de medewerkers had
 * nog geen GPB-beoordeling). Iemand zonder afdeling (nog niet ingevuld)
 * valt bewust onder "Overig" i.p.v. Sales.
 */
function PresenceGrid({ employees, isPresent, toggle }) {
  return (
    <div className="mo-presence-grid">
      {employees.map((emp) => (
        <label className="mo-presence-item" key={emp.id}>
          <input type="checkbox" checked={isPresent(emp)} onChange={() => toggle(emp)} />
          <span className="mo-presence-name">{(emp.name || '—').split(' ')[0]}</span>
          <span className="mo-presence-fte">{emp.fte_hours}u</span>
        </label>
      ))}
    </div>
  )
}

export default function PresenceBlock({ employees, loading, error, onConfirm }) {
  // `draft` bevat alleen de lokaal gewijzigde employee-id's (id -> boolean).
  // Leeg object/null = geen wijzigingen t.o.v. de laatst geladen staat.
  const [draft, setDraft] = useState({})
  const [saving, setSaving] = useState(false)

  function isPresent(emp) {
    return Object.prototype.hasOwnProperty.call(draft, emp.id) ? draft[emp.id] : !!emp.is_present
  }

  function toggle(emp) {
    setDraft((prev) => ({ ...prev, [emp.id]: !isPresent(emp) }))
  }

  const hasChanges = Object.keys(draft).length > 0

  async function handleConfirm() {
    if (!hasChanges || saving) return
    setSaving(true)
    const updates = employees.map((emp) => ({ id: emp.id, is_present: isPresent(emp) }))
    try {
      await onConfirm(updates)
      setDraft({})
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="idle-state">Medewerkers laden…</div>
  }

  if (error) {
    return (
      <p className="form-error" role="alert">
        Kon medewerkers niet laden: {error}
      </p>
    )
  }

  if (employees.length === 0) {
    return <div className="idle-state">Geen medewerkers gevonden.</div>
  }

  const sales = employees.filter((emp) => emp.afdeling === 'Sales')
  const overig = employees.filter((emp) => emp.afdeling !== 'Sales')

  return (
    <div className="section-card mo-presence-block">
      <p className="calc-section-label">Aanwezigheid vandaag</p>

      {sales.length > 0 && <PresenceGrid employees={sales} isPresent={isPresent} toggle={toggle} />}

      {overig.length > 0 &&
        (sales.length > 0 ? (
          <details className="meer-opties mo-presence-overig">
            <summary>Overig ({overig.length})</summary>
            <PresenceGrid employees={overig} isPresent={isPresent} toggle={toggle} />
          </details>
        ) : (
          <PresenceGrid employees={overig} isPresent={isPresent} toggle={toggle} />
        ))}

      <div className="mo-presence-actions">
        <button type="button" className="btn btn-accent" disabled={!hasChanges || saving} onClick={handleConfirm}>
          {saving ? 'Bezig…' : 'Bevestig aanwezigheid'}
        </button>
      </div>
    </div>
  )
}
