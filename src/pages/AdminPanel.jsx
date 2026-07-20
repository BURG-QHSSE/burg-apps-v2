import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import emailjs from '@emailjs/browser'
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
import { setYieldTeltMee, setYieldSinds } from '../lib/yieldApi'
import { fetchToolUsageCounts, fetchToolUsageByUser } from '../lib/toolUsage'
import { TOOLS } from '../lib/toolRegistry'
import { DOORGROEI_SHEET_URL, fetchDoorgroeiRosterNamen, normalizeNaam } from '../lib/doorgroeiTrackerApi'

const ROLE_OPTIONS = ['admin', 'manager', 'hr', 'user']

// Zelfde EmailJS-account als Sales Overdracht (src/pages/tools/SalesOverdracht.jsx),
// maar een eigen template — inhoud is heel anders (welkomstbericht i.p.v.
// vacature-overdracht).
const EMAILJS_PUBLIC_KEY = 'tojkMyUVtV2ZhNoN9'
const EMAILJS_SERVICE_ID = 'service_tdpa3m9'
const WELCOME_TEMPLATE_ID = 'template_6unvb8n'
const LOGIN_URL = 'https://app.burgqhsse.nl'

function vandaagIso() {
  return new Date().toISOString().slice(0, 10)
}

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
  // confirmDeleteText: invoer in het bevestigingsveld — moet exact "VERWIJDEREN" zijn
  // voordat de knop actief wordt, om een permanente verwijdering niet per ongeluk te
  // laten gebeuren met één misklik.
  const [confirmDeleteText, setConfirmDeleteText] = useState('')

  function startConfirmDelete(profileId) {
    setConfirmDeleteId(profileId)
    setConfirmDeleteText('')
  }

  function cancelConfirmDelete() {
    setConfirmDeleteId(null)
    setConfirmDeleteText('')
  }
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
  // "Meer opties" — yield-deelname bij aanmaken (zelfde velden als de
  // per-rij-toggle+datum in de tabel hieronder, zie handleYieldToggle/
  // handleYieldSindsChange).
  const [newYieldTeltMee, setNewYieldTeltMee] = useState(false)
  const [newYieldSinds, setNewYieldSinds] = useState('')
  // Welkomstmail staat los van "Meer opties" — dit is een keuze die je elke
  // keer opnieuw maakt, geen incidentele optie, dus altijd zichtbaar.
  const [sendWelkomstmail, setSendWelkomstmail] = useState(true)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState(null)
  // welkomstmailError: aparte, niet-blokkerende waarschuwing als het
  // aanmaken wel lukt maar de mail niet — de gebruiker bestaat dan al, dus
  // dit mag de flow niet laten falen.
  const [welkomstmailError, setWelkomstmailError] = useState(null)
  // laatstAangemaakteNaam: toont een reminder-banner direct na het aanmaken
  // van een gebruiker met een ingevulde naam — los van de permanente check
  // hieronder, want die weet pas na een volgende fetch of de naam ontbreekt.
  const [laatstAangemaakteNaam, setLaatstAangemaakteNaam] = useState(null)

  // doorgroeiOntbrekend: namen van actieve profielen die niet voorkomen in de
  // Doorgroei Tracker sheet-roster. null = nog niet geladen of check mislukt
  // (geen uitspraak, dus geen valse meldingen tonen) — zie de useEffect
  // hieronder die op `profiles` reageert.
  const [doorgroeiOntbrekend, setDoorgroeiOntbrekend] = useState(null)

  useEffect(() => {
    loadProfiles()
    loadUsageCounts()
    loadPerUserExtras()
  }, [])

  // Herhaalt zich telkens als de profielenlijst ververst (na aanmaken,
  // naamwijziging, (de)activeren, verwijderen) — zodat de check altijd de
  // actuele lijst gebruikt in plaats van alleen bij het eerste laden.
  useEffect(() => {
    if (profiles.length === 0) return

    fetchDoorgroeiRosterNamen()
      .then((rosterNamen) => {
        const ontbrekend = profiles
          .filter((p) => p.actief && p.naam?.trim() && !rosterNamen.has(normalizeNaam(p.naam)))
          .map((p) => p.naam)
        setDoorgroeiOntbrekend(ontbrekend)
      })
      .catch((err) => {
        // Niet-kritiek: dit is een best-effort reminder, geen kernfunctie —
        // de rest van het Adminpaneel blijft gewoon werken.
        console.error('[AdminPanel] Kon Doorgroei Tracker roster niet laden:', err.message)
        setDoorgroeiOntbrekend(null)
      })
  }, [profiles])

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

  async function handleYieldToggle(profileId, newWaarde) {
    const previousProfile = profiles.find((p) => p.id === profileId)
    const previousWaarde = previousProfile?.yield_telt_mee

    setProfiles((current) => current.map((p) => (p.id === profileId ? { ...p, yield_telt_mee: newWaarde } : p)))
    setRowErrors((current) => ({ ...current, [profileId]: null }))
    setPendingIds((current) => ({ ...current, [profileId]: true }))

    try {
      await setYieldTeltMee(profileId, newWaarde)
    } catch (err) {
      setProfiles((current) =>
        current.map((p) => (p.id === profileId ? { ...p, yield_telt_mee: previousWaarde } : p)),
      )
      setRowErrors((current) => ({ ...current, [profileId]: err.message }))
    } finally {
      setPendingIds((current) => ({ ...current, [profileId]: false }))
    }
  }

  async function handleYieldSindsChange(profileId, newDatum) {
    const previousProfile = profiles.find((p) => p.id === profileId)
    const previousDatum = previousProfile?.yield_sinds ?? null

    setProfiles((current) => current.map((p) => (p.id === profileId ? { ...p, yield_sinds: newDatum } : p)))
    setRowErrors((current) => ({ ...current, [profileId]: null }))
    setPendingIds((current) => ({ ...current, [profileId]: true }))

    try {
      await setYieldSinds(profileId, newDatum || null)
    } catch (err) {
      setProfiles((current) =>
        current.map((p) => (p.id === profileId ? { ...p, yield_sinds: previousDatum } : p)),
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
      cancelConfirmDelete()
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
    setWelkomstmailError(null)

    const aangemaakteNaam = newNaam.trim()
    const aangemaakteEmail = newEmail.trim()

    try {
      await createUser({
        email: aangemaakteEmail,
        password: newPassword,
        naam: aangemaakteNaam || undefined,
        role: newRole,
        yieldTeltMee: newYieldTeltMee,
        yieldSinds: newYieldTeltMee ? newYieldSinds || vandaagIso() : undefined,
      })

      // Account is al aangemaakt — een mislukte mail mag dat succes niet
      // tenietdoen, dus dit staat in een eigen try/catch met een losse,
      // niet-blokkerende waarschuwing i.p.v. de create-flow te laten falen.
      if (sendWelkomstmail) {
        try {
          await emailjs.send(
            EMAILJS_SERVICE_ID,
            WELCOME_TEMPLATE_ID,
            { naam: aangemaakteNaam || aangemaakteEmail, to_email: aangemaakteEmail, login_url: LOGIN_URL },
            EMAILJS_PUBLIC_KEY,
          )
        } catch (mailErr) {
          console.error('[AdminPanel] Welkomstmail versturen mislukt:', mailErr)
          setWelkomstmailError('Gebruiker is aangemaakt, maar de welkomstmail versturen is mislukt.')
        }
      }

      setNewEmail('')
      setNewPassword('')
      setNewNaam('')
      setNewRole('user')
      setNewYieldTeltMee(false)
      setNewYieldSinds('')
      if (aangemaakteNaam) setLaatstAangemaakteNaam(aangemaakteNaam)
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

          <details className="meer-opties" style={{ marginTop: 'var(--space-4)' }}>
            <summary>Meer opties</summary>
            <div className="form-grid form-grid-3" style={{ marginTop: 'var(--space-3)' }}>
              <div className="field-block">
                <label className="field-label" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  <input
                    type="checkbox"
                    checked={newYieldTeltMee}
                    onChange={(e) => {
                      const checked = e.target.checked
                      setNewYieldTeltMee(checked)
                      if (checked && !newYieldSinds) setNewYieldSinds(vandaagIso())
                    }}
                  />
                  Telt mee voor yield
                </label>
              </div>
              {newYieldTeltMee && (
                <div className="field-block">
                  <label className="field-label">Sinds</label>
                  <div className={newYieldSinds ? 'text-input-wrap has-input' : 'text-input-wrap needs-input'}>
                    <input type="date" value={newYieldSinds} onChange={(e) => setNewYieldSinds(e.target.value)} />
                  </div>
                </div>
              )}
            </div>
          </details>

          <div className="control-row" style={{ marginTop: 'var(--space-4)' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <input
                type="checkbox"
                checked={sendWelkomstmail}
                onChange={(e) => setSendWelkomstmail(e.target.checked)}
              />
              Welkomstmail versturen
            </label>
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

        {welkomstmailError && (
          <div className="required-banner" style={{ marginTop: 'var(--space-4)' }}>
            <span className="required-banner-dot"></span>
            <span>{welkomstmailError}</span>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ marginLeft: 'auto' }}
              onClick={() => setWelkomstmailError(null)}
            >
              Sluiten
            </button>
          </div>
        )}

        {laatstAangemaakteNaam && (
          <div className="required-banner" style={{ marginTop: 'var(--space-4)' }}>
            <span className="required-banner-dot"></span>
            <span>
              '{laatstAangemaakteNaam}' is aangemaakt in de app. Vergeet niet '{laatstAangemaakteNaam}' ook toe te
              voegen aan de{' '}
              <a href={DOORGROEI_SHEET_URL} target="_blank" rel="noopener noreferrer">
                Doorgroei Tracker sheet
              </a>{' '}
              (exact dezelfde schrijfwijze).
            </span>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ marginLeft: 'auto' }}
              onClick={() => setLaatstAangemaakteNaam(null)}
            >
              Sluiten
            </button>
          </div>
        )}

        {doorgroeiOntbrekend && doorgroeiOntbrekend.length > 0 && (
          <div className="required-banner" style={{ marginTop: 'var(--space-4)' }}>
            <span className="required-banner-dot"></span>
            <span>
              {doorgroeiOntbrekend.length} gebruiker{doorgroeiOntbrekend.length === 1 ? '' : 's'}{' '}
              {doorgroeiOntbrekend.length === 1 ? 'ontbreekt' : 'ontbreken'} nog in de Doorgroei Tracker sheet:{' '}
              {doorgroeiOntbrekend.join(', ')}.
            </span>
            <a
              href={DOORGROEI_SHEET_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-secondary"
              style={{ marginLeft: 'auto' }}
            >
              Open sheet
            </a>
          </div>
        )}

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
                  <th>Rol</th>
                  <th>Actief</th>
                  <th>Laatste login</th>
                  <th>Laatst actief</th>
                  <th>Tool-gebruik</th>
                  <th>Kansen Swiper uitgebreid</th>
                  <th>Telt mee voor yield</th>
                  <th>Yield sinds</th>
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
                        <div className="admin-naam-edit-wrap">
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
                          <p className="admin-naam-edit-email">{profile.email}</p>
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
                    <td data-label="Telt mee voor yield">
                      <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                        <input
                          type="checkbox"
                          checked={!!profile.yield_telt_mee}
                          disabled={pendingIds[profile.id]}
                          onChange={(e) => handleYieldToggle(profile.id, e.target.checked)}
                        />
                      </label>
                    </td>
                    <td data-label="Yield sinds">
                      <div className="text-input-wrap">
                        <input
                          type="date"
                          value={profile.yield_sinds ?? ''}
                          disabled={pendingIds[profile.id] || !profile.yield_telt_mee}
                          onChange={(e) => handleYieldSindsChange(profile.id, e.target.value)}
                        />
                      </div>
                    </td>
                    <td data-label="Verwijderen">
                      {confirmDeleteId === profile.id ? (
                        <div className="admin-confirm-delete">
                          <span style={{ fontSize: '12px' }}>Typ VERWIJDEREN om te bevestigen</span>
                          <div className="text-input-wrap">
                            <input
                              type="text"
                              autoFocus
                              value={confirmDeleteText}
                              disabled={pendingIds[profile.id]}
                              onChange={(e) => setConfirmDeleteText(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Escape') cancelConfirmDelete()
                              }}
                            />
                          </div>
                          <button
                            type="button"
                            className="btn btn-danger"
                            disabled={pendingIds[profile.id] || confirmDeleteText !== 'VERWIJDEREN'}
                            onClick={() => handleDeleteConfirmed(profile.id)}
                          >
                            Ja, permanent verwijderen
                          </button>
                          <button type="button" className="btn btn-ghost" onClick={cancelConfirmDelete}>
                            Annuleren
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-danger"
                          onClick={() => startConfirmDelete(profile.id)}
                        >
                          Verwijderen
                        </button>
                      )}
                    </td>
                    {rowErrors[profile.id] && (
                      <td colSpan={10} style={{ paddingTop: 0 }}>
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
