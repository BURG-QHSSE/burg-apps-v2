import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  fetchAllProfiles,
  fetchLastSignIns,
  changeUserRole,
  setUserActief,
  setUserNaam,
  setMijnOmgevingUitgebreid,
  createUser,
  deleteUserPermanently,
} from '../lib/adminApi'
import { fetchToolUsageCounts, fetchToolUsageByUser } from '../lib/toolUsage'
import { TOOLS } from '../lib/toolRegistry'

const ROLE_OPTIONS = ['admin', 'manager', 'hr', 'user']

function toolNaam(toolId) {
  return TOOLS.find((t) => t.id === toolId)?.naam ?? toolId
}

function voornaam(naam) {
  return (naam || '').trim().split(' ')[0].toLowerCase()
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
  // editingNaamId: welk profiel op dit moment het naam-veld open heeft staan
  // (achter een potloodje i.p.v. altijd-open — namen worden elders exact
  // gematcht, bv. Doorgroei Tracker/Proeftijd Tracker, dus een per ongeluk
  // aangepaste naam breekt die koppeling stilletjes).
  const [editingNaamId, setEditingNaamId] = useState(null)
  // naamSortAsc: sorteerrichting op voornaam in het gebruikersoverzicht (null = ongesorteerd, zoals opgehaald)
  const [naamSortAsc, setNaamSortAsc] = useState(true)

  const [usageCounts, setUsageCounts] = useState([])
  const [usageLoading, setUsageLoading] = useState(true)
  const [usageError, setUsageError] = useState(null)

  // lastSignIns: user id -> ISO-datum laatste login | null (uit admin_last_sign_ins())
  const [lastSignIns, setLastSignIns] = useState(new Map())
  // usageByUser: user id -> { count, laatstActief } (uit tool_usage, per gebruiker i.p.v. per tool)
  const [usageByUser, setUsageByUser] = useState(new Map())

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
    loadPerUserExtras()
  }, [])

  async function loadPerUserExtras() {
    try {
      const [signIns, usage] = await Promise.all([fetchLastSignIns(), fetchToolUsageByUser()])
      setLastSignIns(signIns)
      setUsageByUser(usage)
    } catch (err) {
      // Niet-kritiek voor de rest van het scherm — de kolommen tonen dan
      // gewoon "—", de rest van het Adminpaneel blijft werken.
      console.error('[AdminPanel] Kon login/gebruik per gebruiker niet laden:', err.message)
    }
  }

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

  function startNaamEdit(profileId, huidigeNaam) {
    setNaamDrafts((current) => ({ ...current, [profileId]: huidigeNaam ?? '' }))
    setRowErrors((current) => ({ ...current, [profileId]: null }))
    setEditingNaamId(profileId)
  }

  function cancelNaamEdit(profileId) {
    setNaamDrafts((current) => ({ ...current, [profileId]: undefined }))
    setRowErrors((current) => ({ ...current, [profileId]: null }))
    setEditingNaamId(null)
  }

  async function handleNaamOpslaan(profileId) {
    const previousProfile = profiles.find((p) => p.id === profileId)
    const previousNaam = previousProfile?.naam ?? ''
    const draft = (naamDrafts[profileId] ?? previousNaam).trim()

    // Niets gewijzigd: geen RPC-call nodig, gewoon het veld weer sluiten.
    if (draft === (previousNaam ?? '')) {
      setEditingNaamId(null)
      return
    }

    setProfiles((current) => current.map((p) => (p.id === profileId ? { ...p, naam: draft } : p)))
    setRowErrors((current) => ({ ...current, [profileId]: null }))
    setPendingIds((current) => ({ ...current, [profileId]: true }))

    try {
      await setUserNaam(profileId, draft)
      setEditingNaamId(null)
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
                  <th>
                    <button
                      type="button"
                      className="admin-table-sort-btn"
                      onClick={() => setNaamSortAsc((current) => !current)}
                      title="Sorteer op voornaam"
                    >
                      Naam {naamSortAsc ? '▲' : '▼'}
                    </button>
                  </th>
                  <th>E-mail</th>
                  <th>Rol</th>
                  <th>Actief</th>
                  <th>Laatste login</th>
                  <th>Laatst actief</th>
                  <th>Tool-gebruik</th>
                  <th>Kansen Swiper uitgebreid</th>
                  <th>Verwijderen</th>
                </tr>
              </thead>
              <tbody>
                {[...profiles]
                  .sort((a, b) => {
                    const cmp = voornaam(a.naam).localeCompare(voornaam(b.naam), 'nl')
                    return naamSortAsc ? cmp : -cmp
                  })
                  .map((profile) => (
                  <tr key={profile.id}>
                    <td data-label="Naam">
                      {editingNaamId === profile.id ? (
                        <div className="admin-naam-edit">
                          <div className="text-input-wrap">
                            <input
                              type="text"
                              autoFocus
                              value={naamDrafts[profile.id] ?? profile.naam ?? ''}
                              disabled={pendingIds[profile.id]}
                              onChange={(e) =>
                                setNaamDrafts((current) => ({ ...current, [profile.id]: e.target.value }))
                              }
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleNaamOpslaan(profile.id)
                                if (e.key === 'Escape') cancelNaamEdit(profile.id)
                              }}
                            />
                          </div>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            disabled={pendingIds[profile.id]}
                            onClick={() => handleNaamOpslaan(profile.id)}
                          >
                            Opslaan
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            disabled={pendingIds[profile.id]}
                            onClick={() => cancelNaamEdit(profile.id)}
                          >
                            Annuleren
                          </button>
                        </div>
                      ) : (
                        <div className="admin-naam-display">
                          <span>{profile.naam || '—'}</span>
                          <button
                            type="button"
                            className="delete-btn"
                            title="Naam wijzigen"
                            onClick={() => startNaamEdit(profile.id, profile.naam)}
                          >
                            ✎
                          </button>
                        </div>
                      )}
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
                    <td data-label="Laatste login">{fmtDatum(lastSignIns.get(profile.id))}</td>
                    <td data-label="Laatst actief">{fmtDatum(usageByUser.get(profile.id)?.laatstActief)}</td>
                    <td data-label="Tool-gebruik">{usageByUser.get(profile.id)?.count ?? 0}x</td>
                    <td data-label="Kansen Swiper uitgebreid">
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
                      <td colSpan={9} style={{ paddingTop: 0 }}>
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
