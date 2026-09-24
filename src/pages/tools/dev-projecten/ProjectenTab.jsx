import { useEffect, useState } from 'react'
import { useAuth } from '../../../lib/AuthProvider'
import {
  fetchDevProjects,
  createDevProject,
  updateDevProjectVeld,
  deleteDevProject,
} from '../../../lib/devProjectsApi'

const PRIORITEITEN = ['laag', 'midden', 'hoog']
const STATUSSEN = ['open', 'bezig', 'klaar']

const LABELS = { laag: 'Laag', midden: 'Midden', hoog: 'Hoog', open: 'Open', bezig: 'Bezig', klaar: 'Klaar' }

// Lijst wordt gegroepeerd op status (bezig bovenaan: daar werk je nu aan),
// binnen een groep gesorteerd op prioriteit en daarna deadline.
const STATUS_GROEPEN = [
  { status: 'bezig', titel: 'Bezig' },
  { status: 'open', titel: 'Open' },
  { status: 'klaar', titel: 'Klaar' },
]
const PRIO_RANG = { hoog: 0, midden: 1, laag: 2 }

function sorteer(a, b) {
  const prio = (PRIO_RANG[a.prioriteit] ?? 3) - (PRIO_RANG[b.prioriteit] ?? 3)
  if (prio !== 0) return prio
  if (a.deadline && b.deadline) return a.deadline.localeCompare(b.deadline)
  if (a.deadline) return -1
  if (b.deadline) return 1
  return 0
}

function isVerlopen(project) {
  if (!project.deadline || project.status === 'klaar') return false
  return project.deadline < new Date().toISOString().slice(0, 10)
}

function Segmented({ opties, waarde, disabled, onChange, prefix }) {
  return (
    <div className="btn-group dev-segmented">
      {opties.map((o) => (
        <button
          key={o}
          type="button"
          className={waarde === o ? `btn-group-btn active ${prefix}-${o}` : 'btn-group-btn'}
          disabled={disabled}
          onClick={() => waarde !== o && onChange(o)}
        >
          {LABELS[o]}
        </button>
      ))}
    </div>
  )
}

function fmtAangepast(iso, naam) {
  if (!iso || !naam) return null
  const datum = new Date(iso).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })
  return `Laatst aangepast door ${naam} op ${datum}`
}

function ProjectCard({ project, onUpdateVeld, onDelete, pending, rowError, confirmDeleteId, setConfirmDeleteId }) {
  // Lokale drafts voor tekst-/getalvelden: voorkomt een save-call (+ volledige
  // herlaad van de lijst) per toetsaanslag, alleen onBlur wordt daadwerkelijk
  // opgeslagen — zelfde reden als de naam-edit-flow in AdminPanel.jsx. Voor
  // de getalvelden is dit ook functioneel nodig: bij opslaan op elke
  // toetsaanslag overschrijft de reload halverwege het typen van bv. "3.5"
  // de input terug naar de net bevestigde "3", en verdwijnt de rest.
  const [titelDraft, setTitelDraft] = useState(project.titel)
  const [notitiesDraft, setNotitiesDraft] = useState(project.notities ?? '')
  const [urenDraft, setUrenDraft] = useState(project.uren_per_week ?? '')
  const [bespaardDraft, setBespaardDraft] = useState(project.tijd_bespaard_minuten ?? '')

  useEffect(() => setTitelDraft(project.titel), [project.titel])
  useEffect(() => setNotitiesDraft(project.notities ?? ''), [project.notities])
  useEffect(() => setUrenDraft(project.uren_per_week ?? ''), [project.uren_per_week])
  useEffect(() => setBespaardDraft(project.tijd_bespaard_minuten ?? ''), [project.tijd_bespaard_minuten])

  const urenLabel = fmtAangepast(project.uren_per_week_aangepast_at, project.uren_per_week_aangepast_door?.naam)
  const bespaardLabel = fmtAangepast(project.tijd_bespaard_aangepast_at, project.tijd_bespaard_aangepast_door?.naam)

  return (
    <div className={`section-card dev-project-card dev-prio-${project.prioriteit} dev-status-${project.status}`}>
      <div className="dev-project-header">
        <div className="text-input-wrap dev-project-titel-wrap">
          <input
            type="text"
            value={titelDraft}
            disabled={pending}
            onChange={(e) => setTitelDraft(e.target.value)}
            onBlur={() => {
              const trimmed = titelDraft.trim()
              if (trimmed && trimmed !== project.titel) onUpdateVeld(project.id, 'titel', trimmed)
              else setTitelDraft(project.titel)
            }}
          />
        </div>
        {confirmDeleteId === project.id ? (
          <div className="dev-project-confirm-delete">
            <span>Zeker?</span>
            <button type="button" className="btn btn-danger" disabled={pending} onClick={() => onDelete(project.id)}>
              Ja
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setConfirmDeleteId(null)}>
              Nee
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="delete-btn"
            title="Project verwijderen"
            onClick={() => setConfirmDeleteId(project.id)}
          >
            ✕
          </button>
        )}
      </div>

      <textarea
        className="field-textarea"
        placeholder="Notities…"
        value={notitiesDraft}
        disabled={pending}
        onChange={(e) => setNotitiesDraft(e.target.value)}
        onBlur={() => {
          if (notitiesDraft !== (project.notities ?? '')) onUpdateVeld(project.id, 'notities', notitiesDraft || null)
        }}
      />

      <div className="form-grid form-grid-3">
        <div className="field-block">
          <label className="field-label">Prioriteit</label>
          <Segmented
            opties={PRIORITEITEN}
            waarde={project.prioriteit}
            disabled={pending}
            prefix="dev-prio-btn"
            onChange={(p) => onUpdateVeld(project.id, 'prioriteit', p)}
          />
        </div>
        <div className="field-block">
          <label className="field-label">Status</label>
          <Segmented
            opties={STATUSSEN}
            waarde={project.status}
            disabled={pending}
            prefix="dev-status-btn"
            onChange={(s) => onUpdateVeld(project.id, 'status', s)}
          />
        </div>
        <div className="field-block">
          <label className="field-label">Deadline</label>
          <div className="text-input-wrap">
            <input
              type="date"
              value={project.deadline ?? ''}
              disabled={pending}
              onChange={(e) => onUpdateVeld(project.id, 'deadline', e.target.value || null)}
            />
          </div>
          {isVerlopen(project) && <p className="dev-project-meta dev-project-verlopen">Deadline verstreken</p>}
        </div>
      </div>

      <div className="form-grid form-grid-2">
        <div className="field-block">
          <label className="field-label">Uren per week</label>
          <div className="text-input-wrap">
            <input
              type="number"
              min="0"
              step="0.5"
              value={urenDraft}
              disabled={pending}
              onChange={(e) => setUrenDraft(e.target.value)}
              onBlur={() => {
                const waarde = urenDraft === '' ? null : Number(urenDraft)
                if (waarde !== (project.uren_per_week ?? null)) onUpdateVeld(project.id, 'uren_per_week', waarde)
              }}
            />
          </div>
          {urenLabel && <p className="dev-project-meta">{urenLabel}</p>}
        </div>
        <div className="field-block">
          <label className="field-label">Tijd bespaard per gebruik (minuten)</label>
          <div className="text-input-wrap">
            <input
              type="number"
              min="0"
              step="1"
              value={bespaardDraft}
              disabled={pending}
              onChange={(e) => setBespaardDraft(e.target.value)}
              onBlur={() => {
                const waarde = bespaardDraft === '' ? null : Number(bespaardDraft)
                if (waarde !== (project.tijd_bespaard_minuten ?? null))
                  onUpdateVeld(project.id, 'tijd_bespaard_minuten', waarde)
              }}
            />
          </div>
          {bespaardLabel && <p className="dev-project-meta">{bespaardLabel}</p>}
        </div>
      </div>

      {rowError && (
        <p className="form-error form-error-inline" role="alert">
          {rowError}
        </p>
      )}
    </div>
  )
}

export default function ProjectenTab() {
  const { user } = useAuth()

  const [projecten, setProjecten] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [rowErrors, setRowErrors] = useState({})
  const [pendingIds, setPendingIds] = useState({})
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [toonKlaar, setToonKlaar] = useState(false)

  const [nieuweTitel, setNieuweTitel] = useState('')
  const [creating, setCreating] = useState(false)

  async function load() {
    try {
      const data = await fetchDevProjects()
      setProjecten(data)
      setLoadError('')
    } catch (err) {
      setLoadError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function handleCreate(e) {
    e.preventDefault()
    const titel = nieuweTitel.trim()
    if (!titel) return

    setCreating(true)
    try {
      await createDevProject(titel, user?.id)
      setNieuweTitel('')
      await load()
    } catch (err) {
      setLoadError(err.message)
    } finally {
      setCreating(false)
    }
  }

  async function handleUpdateVeld(id, veld, waarde) {
    const previous = projecten.find((p) => p.id === id)
    setProjecten((current) => current.map((p) => (p.id === id ? { ...p, [veld]: waarde } : p)))
    setRowErrors((current) => ({ ...current, [id]: null }))
    setPendingIds((current) => ({ ...current, [id]: true }))

    try {
      await updateDevProjectVeld(id, veld, waarde, user?.id)
      await load()
    } catch (err) {
      setProjecten((current) => current.map((p) => (p.id === id ? previous : p)))
      setRowErrors((current) => ({ ...current, [id]: err.message }))
    } finally {
      setPendingIds((current) => ({ ...current, [id]: false }))
    }
  }

  async function handleDelete(id) {
    setPendingIds((current) => ({ ...current, [id]: true }))
    try {
      await deleteDevProject(id)
      setConfirmDeleteId(null)
      await load()
    } catch (err) {
      setRowErrors((current) => ({ ...current, [id]: err.message }))
      setPendingIds((current) => ({ ...current, [id]: false }))
    }
  }

  return (
    <div>
      <form className="dev-project-new-form" onSubmit={handleCreate}>
        <div className="text-input-wrap dev-project-new-input">
          <input
            type="text"
            placeholder="Titel van nieuw project of idee…"
            value={nieuweTitel}
            disabled={creating}
            onChange={(e) => setNieuweTitel(e.target.value)}
          />
        </div>
        <button type="submit" className="btn btn-primary" disabled={creating || !nieuweTitel.trim()}>
          + Project toevoegen
        </button>
      </form>

      {loading && <p>Projecten laden…</p>}

      {!loading && loadError && (
        <p className="form-error" role="alert">
          Kon projecten niet laden: {loadError}
        </p>
      )}

      {!loading && !loadError && projecten.length === 0 && (
        <div className="idle-state">Nog geen projecten. Voeg er één toe om te beginnen.</div>
      )}

      {!loading && !loadError && projecten.length > 0 && (
        <div className="dev-groepen">
          {STATUS_GROEPEN.map(({ status, titel }) => {
            const groep = projecten.filter((p) => p.status === status).sort(sorteer)
            const ingeklapt = status === 'klaar' && !toonKlaar
            return (
              <section key={status} className={`dev-groep dev-groep-${status}`}>
                <h2 className="dev-groep-titel">
                  {status === 'klaar' ? (
                    <button type="button" className="dev-groep-toggle" onClick={() => setToonKlaar((v) => !v)}>
                      {ingeklapt ? '▸' : '▾'} {titel}
                    </button>
                  ) : (
                    titel
                  )}
                  <span className="dev-groep-aantal">{groep.length}</span>
                </h2>
                {!ingeklapt && groep.length === 0 && <p className="dev-groep-leeg">Niets {titel.toLowerCase()}.</p>}
                {!ingeklapt && groep.length > 0 && (
                  <div className="dev-project-list">
                    {groep.map((project) => (
                      <ProjectCard
                        key={project.id}
                        project={project}
                        onUpdateVeld={handleUpdateVeld}
                        onDelete={handleDelete}
                        pending={!!pendingIds[project.id]}
                        rowError={rowErrors[project.id]}
                        confirmDeleteId={confirmDeleteId}
                        setConfirmDeleteId={setConfirmDeleteId}
                      />
                    ))}
                  </div>
                )}
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
