import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  fetchAllProfiles,
  changeUserRole,
  setUserActief,
  setUserNaam,
  setMijnOmgevingUitgebreid,
  createUser,
  deleteUserPermanently,
} from '../lib/adminApi'
import { fetchToolUsageCounts } from '../lib/toolUsage'
import { TOOLS } from '../lib/toolRegistry'

const ROLE_OPTIONS = ['admin', 'manager', 'user']

function toolNaam(toolId) {
  return TOOLS.find((t) => t.id === toolId)?.naam ?? toolId
}

function fmtDatum(isoString) {
  if (!isoString) return '—'
  return new Date(isoString).toLocaleString('nl-NL', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function AdminPanel() {
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  // rowErrors: { [profileId]: string }
  const [rowErrors, setRowErrors] = useState({})
  // pendingIds: profielen waarvan een actie (rol/actief/verwijderen) nog onderweg is
  const [pendingIds, setPendingIds] = useState({})
  // confirmDeleteId: welk profiel op dit moment de "weet je het zeker?"-stap toont
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  // naamDrafts: { [profileId]: string } — lokale invoerwaarde tijdens het bewerken
  const [naamDrafts, setNaamDrafts] = useState({})

  const [usageCounts, setUsageCounts] = useState([])
  const [usageLoading, setUsageLoading] = useState(true)
  const [usageError, setUsageError] = useState(null)

  // Nieuwe-gebruiker formulier
  const [newEmail, setNewEmail] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newNaam, setNewNaam] = useState('')
  const [newRole, setNewRole] = useState('user')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState(null)

  useEffect(() => {
    loadProfiles()
    loadUsageCounts()
  }, [])

  async function loadUsageCounts() {
    setUsageLoading(true)
    setUsageError(null)
    try {
      const data = await fetchToolUsageCounts()
      setUsageCounts(data)
    } catch (err) {
      setUsageError(err.message)
    } finally {
      setUsageLoading(false)
    }
  }

  async function loadProfiles() {
    setLoading(true)
    setLoadError(null)
    try {
      const data = await fetchAllProfiles()
      setProfiles(data)
    } catch (err) {
      setLoadError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleRoleChange(profileId, newRoleValue) {
    const previousProfile = profiles.find((p) => p.id === profileId)
    const previousRole = previousProfile?.role

    // Optimistisch bijwerken zodat de dropdown meteen reageert.
    setProfiles((current) =>
      current.map((p) => (p.id === profileId ? { ...p, role: newRoleValue } : p)),
    )
    setRowErrors((current) => ({ ...current, [profileId]: null }))
    setPendingIds((current) => ({ ...current, [profileId]: true }))

    try {
      await changeUserRole(profileId, newRoleValue)
      // Succes: lokale state is al bijgewerkt. Voor de zekerheid opnieuw
      // ophalen zodat ook eventuele server-side neveneffecten zichtbaar zijn.
      await loadProfiles()
    } catch (err) {
      // Terugdraaien naar de vorige waarde en foutmelding tonen bij deze rij.
      setProfiles((current) =>
        current.map((p) => (p.id === profileId ? { ...p, role: previousRole } : p)),
      )
      setRowErrors((current) => ({ ...current, [profileId]: err.message }))
    } finally {
      setPendingIds((current) => ({ ...current, [profileId]: false }))
    }
  }

  async function handleActiefToggle(profileId, newActief) {
    const previousProfile = profiles.find((p) => p.id === profileId)
    const previousActief = previousProfile?.actief

    setProfiles((current) =>
      current.map((p) => (p.id === profileId ? { ...p, actief: newActief } : p)),
    )
    setRowErrors((current) => ({ ...current, [profileId]: null }))
    setPendingIds((current) => ({ ...current, [profileId]: true }))

    try {
      await setUserActief(profileId, newActief)
      await loadProfiles()
    } catch (err) {
      setProfiles((current) =>
        current.map((p) => (p.id === profileId ? { ...p, actief: previousActief } : p)),
      )
      setRowErrors((current) => ({ ...current, [profileId]: err.message }))
    } finally {
      setPendingIds((current) => ({ ...current, [profileId]: false }))
    }
  }

  async function handleNaamBlur(profileId) {
    const previousProfile = profiles.find((p) => p.id === profileId)
    const previousNaam = previousProfile?.naam ?? ''
    const draft = (naamDrafts[profileId] ?? previousNaam).trim()

    // Niets gewijzigd: geen RPC-call nodig.
    if (draft === (previousNaam ?? '')) return

    setProfiles((current) => current.map((p) => (p.id === profileId ? { ...p, naam: draft } : p)))
    setRowErrors((current) => ({ ...current, [profileId]: null }))
    setPendingIds((current) => ({ ...current, [profileId]: true }))

    try {
      await setUserNaam(profileId, draft)
    } catch (err) {
      setProfiles((current) =>
        current.map((p) => (p.id === profileId ? { ...p, naam: previousNaam } : p)),
      )
      setNaamDrafts((current) => ({ ...current, [profileId]: previousNaam }))
      setRowErrors((current) => ({ ...current, [profileId]: err.message }))
    } finally {
      setPendingIds((current) => ({ ...current, [profileId]: false }))
    }
  }

  async function handleUitgebreidToggle(profileId, newWaarde) {
    const previousProfile = profiles.find((p) => p.id === profileId)
    const previousWaarde = previousProfile?.mijn_omgeving_uitgebreid

    setProfiles((current) =>
      current.map((p) => (p.id === profileId ? { ...p, mijn_omgeving_uitgebreid: newWaarde } : p)),
    )
    setRowErrors((current) => ({ ...current, [profileId]: null }))
    setPendingIds((current) => ({ ...current, [profileId]: true }))

    try {
      await setMijnOmgevingUitgebreid(profileId, newWaarde)
    } catch (err) {
      setProfiles((current) =>
        current.map((p) =>
          p.id === profileId ? { ...p, mijn_omgeving_uitgebreid: previousWaarde } : p,
        ),
      )
      setRowErrors((current) => ({ ...current, [profileId]: err.message }))
    } finally {
      setPendingIds((current) => ({ ...current, [profileId]: false }))
    }
  }

  async function handleDeleteConfirmed(profileId) {
    setRowErrors((current) => ({ ...current, [profileId]: null }))
    setPendingIds((current) => ({ ...current, [profileId]: true }))

    try {
      await deleteUserPermanently(profileId)
      setConfirmDeleteId(null)
      await loadProfiles()
    } catch (err) {
      setRowErrors((current) => ({ ...current, [profileId]: err.message }))
    } finally {
      setPendingIds((current) => ({ ...current, [profileId]: false }))
    }
  }

  async function handleCreateUser(e) {
    e.preventDefault()
    setCreating(true)
    setCreateError(null)

    try {
      await createUser({
        email: newEmail.trim(),
        password: newPassword,
        naam: newNaam.trim() || undefined,
        role: newRole,
      })
      setNewEmail('')
      setNewPassword('')
      setNewNaam('')
      setNewRole('user')
      await loadProfiles()
    } catch (err) {
      setCreateError(err.message)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="page">
      <header className="topbar">
        <div>
          <h1>Adminpaneel</h1>
          <p className="topbar-user">Gebruikersbeheer</p>
        </div>
        <div className="topbar-actions">
          <Link to="/" className="btn btn-secondary">
            Terug naar dashboard
          </Link>
        </div>
      </header>

      <main className="page-content">
        <h2>Nieuwe gebruiker</h2>
        <form className="section-card" onSubmit={handleCreateUser}>
          <div className="form-grid form-grid-3">
            <div className="field-block">
              <label className="field-label">E-mailadres</label>
              <div className="text-input-wrap">
                <input
                  type="email"
                  required
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="naam@burgqhsse.nl"
                />
              </div>
            </div>
            <div className="field-block">
              <label className="field-label">Wachtwoord</label>
              <div className="text-input-wrap">
                <input
                  type="password"
                  required
                  minLength={6}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Minimaal 6 tekens"
                />
              </div>
            </div>
            <div className="field-block">
              <label className="field-label">Naam (optioneel)</label>
              <div className="text-input-wrap">
                <input type="text" value={newNaam} onChange={(e) => setNewNaam(e.target.value)} />
              </div>
            </div>
          </div>

          <div className="form-grid form-grid-3" style={{ marginTop: 'var(--space-3)' }}>
            <div className="field-block">
              <label className="field-label">Rol</label>
              <select className="field-select has-input" value={newRole} onChange={(e) => setNewRole(e.target.value)}>
                {ROLE_OPTIONS.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="submit-row" style={{ marginTop: 'var(--space-4)' }}>
            <button type="submit" className="btn btn-primary" disabled={creating}>
              {creating ? 'Bezig met aanmaken…' : 'Gebruiker toevoegen'}
            </button>
          </div>

          {createError && (
            <p className="form-error" role="alert">
              {createError}
            </p>
          )}
        </form>

        <h2 style={{ marginTop: 'var(--space-8)' }}>Gebruikers</h2>

        {loading && <p>Gebruikers laden…</p>}

        {loadError && (
          <p className="form-error" role="alert">
            Kon gebruikers niet laden: {loadError}
          </p>
        )}

        {!loading && !loadError && (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Naam</th>
                  <th>E-mail</th>
                  <th>Rol</th>
                  <th>Actief</th>
                  <th>Mijn Omgeving uitgebreid</th>
                  <th>Verwijderen</th>
                </tr>
              </thead>
              <tbody>
                {profiles.map((profile) => (
                  <tr key={profile.id}>
                    <td data-label="Naam">
                      <div className="text-input-wrap">
                        <input
                          type="text"
                          value={naamDrafts[profile.id] ?? profile.naam ?? ''}
                          disabled={pendingIds[profile.id]}
                          onChange={(e) =>
                            setNaamDrafts((current) => ({ ...current, [profile.id]: e.target.value }))
                          }
                          onBlur={() => handleNaamBlur(profile.id)}
                        />
                      </div>
                    </td>
                    <td data-label="E-mail">{profile.email}</td>
                    <td data-label="Rol">
                      <select
                        value={profile.role}
                        disabled={pendingIds[profile.id]}
                        onChange={(event) => handleRoleChange(profile.id, event.target.value)}
                      >
                        {ROLE_OPTIONS.map((role) => (
                          <option key={role} value={role}>
                            {role}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td data-label="Actief">
                      <button
                        type="button"
                        className={profile.actief ? 'badge badge-active' : 'badge badge-inactive'}
                        style={{ border: 'none', cursor: 'pointer' }}
                        disabled={pendingIds[profile.id]}
                        onClick={() => handleActiefToggle(profile.id, !profile.actief)}
                      >
                        {profile.actief ? 'Actief' : 'Inactief'}
                      </button>
                    </td>
                    <td data-label="Mijn Omgeving uitgebreid">
                      <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                        <input
                          type="checkbox"
                          checked={!!profile.mijn_omgeving_uitgebreid}
                          disabled={pendingIds[profile.id]}
                          onChange={(e) => handleUitgebreidToggle(profile.id, e.target.checked)}
                        />
                      </label>
                    </td>
                    <td data-label="Verwijderen">
                      {confirmDeleteId === profile.id ? (
                        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                          <span style={{ fontSize: '12px' }}>Weet je het zeker?</span>
                          <button
                            type="button"
                            className="btn btn-danger"
                            disabled={pendingIds[profile.id]}
                            onClick={() => handleDeleteConfirmed(profile.id)}
                          >
                            Ja, permanent verwijderen
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => setConfirmDeleteId(null)}
                          >
                            Annuleren
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-danger"
                          onClick={() => setConfirmDeleteId(profile.id)}
                        >
                          Verwijderen
                        </button>
                      )}
                    </td>
                    {rowErrors[profile.id] && (
                      <td colSpan={6} style={{ paddingTop: 0 }}>
                        <p className="form-error form-error-inline" role="alert">
                          {rowErrors[profile.id]}
                        </p>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <h2 style={{ marginTop: 'var(--space-8)' }}>App Counter</h2>

        {usageLoading && <p>Gebruik laden…</p>}

        {usageError && (
          <p className="form-error" role="alert">
            Kon tool-gebruik niet laden: {usageError}
          </p>
        )}

        {!usageLoading && !usageError && (
          <div className="admin-table-wrap">
            {usageCounts.length === 0 ? (
              <div className="idle-state">Nog geen tool-gebruik gelogd.</div>
            ) : (
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Tool</th>
                    <th>Keer geopend</th>
                    <th>Laatst gebruikt</th>
                  </tr>
                </thead>
                <tbody>
                  {usageCounts.map((row) => (
                    <tr key={row.toolId}>
                      <td data-label="Tool">{toolNaam(row.toolId)}</td>
                      <td data-label="Keer geopend">{row.count}</td>
                      <td data-label="Laatst gebruikt">{fmtDatum(row.laatstGebruikt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
