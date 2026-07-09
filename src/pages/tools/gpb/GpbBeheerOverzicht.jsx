import { useEffect, useState } from 'react'
import { fetchAllProfiles } from '../../../lib/adminApi'
import { createGpbBeoordeling, deleteGpbBeoordeling, fetchDoelen, keurGpbGoed, maakGpbDefinitief } from '../../../lib/gpbApi'
import { AFDELINGEN, NIVEAUS, STATUS_LABELS, functieLabel } from './constants'
import GpbRapport from './GpbRapport'

function fmtDatum(isoString) {
  if (!isoString) return '—'
  return new Date(isoString).toLocaleDateString('nl-NL')
}

/**
 * "Dashboard-gebruiker"-weergave uit GPB-Principes.md: HR/admin ziet alle
 * beoordelingen, maakt nieuwe aan, en keurt goed/maakt definitief. Alle
 * schrijfacties lopen via RPC's (zie supabase/schema.sql) i.p.v. directe
 * updates.
 */
export default function GpbBeheerOverzicht({ beoordelingen, onVerversen, showToast }) {
  const [profiles, setProfiles] = useState([])
  const [geselecteerdId, setGeselecteerdId] = useState(null)
  const [doelen, setDoelen] = useState([])
  const [bezig, setBezig] = useState(false)
  const [fout, setFout] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)

  const [medewerkerId, setMedewerkerId] = useState('')
  const [leidinggevendeId, setLeidinggevendeId] = useState('')
  const [afdeling, setAfdeling] = useState(AFDELINGEN[0])
  const [functieniveau, setFunctieniveau] = useState(1)
  const [periode, setPeriode] = useState('')
  const [aanmakenFout, setAanmakenFout] = useState('')
  const [aanmakenBezig, setAanmakenBezig] = useState(false)

  useEffect(() => {
    fetchAllProfiles()
      .then((data) => setProfiles([...data].sort((a, b) => a.naam.localeCompare(b.naam, 'nl'))))
      .catch((err) => console.error('[GpbBeheerOverzicht] Kon profielen niet laden:', err.message))
  }, [])

  // Alleen manager/hr/admin kunnen als leidinggevende voor een GPB worden gekozen — geen gewone users.
  const leidinggevenden = profiles.filter((p) => ['manager', 'hr', 'admin'].includes(p.role))

  useEffect(() => {
    if (!geselecteerdId) {
      setDoelen([])
      return
    }
    fetchDoelen(geselecteerdId)
      .then(setDoelen)
      .catch((err) => console.error('[GpbBeheerOverzicht] Kon doelen niet laden:', err.message))
  }, [geselecteerdId])

  async function handleAanmaken() {
    if (!medewerkerId || !leidinggevendeId || !periode.trim()) {
      setAanmakenFout('Vul medewerker, leidinggevende en periode in.')
      return
    }
    if (medewerkerId === leidinggevendeId) {
      setAanmakenFout('Medewerker en leidinggevende moeten verschillende personen zijn.')
      return
    }

    setAanmakenBezig(true)
    setAanmakenFout('')
    try {
      const medewerkerNaam = profiles.find((p) => p.id === medewerkerId)?.naam ?? ''
      await createGpbBeoordeling({ medewerkerId, medewerkerNaam, leidinggevendeId, afdeling, functieniveau, periode })
      setMedewerkerId('')
      setLeidinggevendeId('')
      setPeriode('')
      await onVerversen()
      showToast?.('Beoordeling aangemaakt.')
    } catch (err) {
      setAanmakenFout(err.message)
    } finally {
      setAanmakenBezig(false)
    }
  }

  async function handleGoedkeuren(id) {
    setBezig(true)
    setFout('')
    try {
      await keurGpbGoed(id)
      await onVerversen()
      showToast?.('Beoordeling goedgekeurd.')
    } catch (err) {
      setFout(err.message)
    } finally {
      setBezig(false)
    }
  }

  async function handleDefinitief(id) {
    setBezig(true)
    setFout('')
    try {
      await maakGpbDefinitief(id)
      await onVerversen()
      showToast?.('Beoordeling definitief gemaakt.')
    } catch (err) {
      setFout(err.message)
    } finally {
      setBezig(false)
    }
  }

  async function handleVerwijderen(id) {
    setBezig(true)
    setFout('')
    try {
      await deleteGpbBeoordeling(id)
      setConfirmDeleteId(null)
      setGeselecteerdId(null)
      await onVerversen()
      showToast?.('Beoordeling verwijderd.')
    } catch (err) {
      setFout(err.message)
    } finally {
      setBezig(false)
    }
  }

  const geselecteerd = beoordelingen.find((b) => b.id === geselecteerdId)

  if (geselecteerd) {
    const beideIngevuld = geselecteerd.medewerker_ingevuld_at && geselecteerd.leidinggevende_ingevuld_at

    return (
      <div>
        <button type="button" className="btn btn-secondary" onClick={() => setGeselecteerdId(null)}>
          ← Terug naar overzicht
        </button>

        {fout && (
          <p className="form-error" role="alert">
            {fout}
          </p>
        )}

        <GpbRapport
          beoordeling={geselecteerd}
          doelen={doelen}
          acties={
            <>
              {geselecteerd.status === 'concept' && beideIngevuld && (
                <button type="button" className="btn btn-primary" disabled={bezig} onClick={() => handleGoedkeuren(geselecteerd.id)}>
                  Goedkeuren
                </button>
              )}
              {geselecteerd.status === 'goedgekeurd' && (
                <button type="button" className="btn btn-primary" disabled={bezig} onClick={() => handleDefinitief(geselecteerd.id)}>
                  Definitief maken
                </button>
              )}
              {confirmDeleteId === geselecteerd.id ? (
                <>
                  <span className="control-label">Weet je het zeker?</span>
                  <button type="button" className="btn btn-danger" disabled={bezig} onClick={() => handleVerwijderen(geselecteerd.id)}>
                    Ja, verwijderen
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => setConfirmDeleteId(null)}>
                    Annuleren
                  </button>
                </>
              ) : (
                <button type="button" className="btn btn-danger" onClick={() => setConfirmDeleteId(geselecteerd.id)}>
                  Verwijderen
                </button>
              )}
            </>
          }
        />
      </div>
    )
  }

  return (
    <div>
      {fout && (
        <p className="form-error" role="alert">
          {fout}
        </p>
      )}

      <div className="section-card">
        <p className="calc-section-label">Nieuwe beoordeling aanmaken</p>
        <div className="form-grid-2">
          <label className="field">
            <span>Medewerker</span>
            <select value={medewerkerId} onChange={(e) => setMedewerkerId(e.target.value)} disabled={aanmakenBezig}>
              <option value="">Kies medewerker…</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.naam} ({p.email})
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Leidinggevende</span>
            <select value={leidinggevendeId} onChange={(e) => setLeidinggevendeId(e.target.value)} disabled={aanmakenBezig}>
              <option value="">Kies leidinggevende…</option>
              {leidinggevenden.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.naam} ({p.email})
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Afdeling</span>
            <select
              value={afdeling}
              onChange={(e) => {
                setAfdeling(e.target.value)
                setFunctieniveau(1)
              }}
              disabled={aanmakenBezig}
            >
              {AFDELINGEN.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{afdeling === 'Corporate' ? 'Functie' : 'Functieniveau'}</span>
            <select value={functieniveau} onChange={(e) => setFunctieniveau(Number(e.target.value))} disabled={aanmakenBezig}>
              {NIVEAUS[afdeling].map((n) => (
                <option key={n.niveau} value={n.niveau}>
                  {functieLabel(afdeling, n.niveau)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Periode</span>
            <input
              type="text"
              placeholder="bv. H1 2026"
              value={periode}
              onChange={(e) => setPeriode(e.target.value)}
              disabled={aanmakenBezig}
            />
          </label>
        </div>

        {aanmakenFout && (
          <p className="form-error" role="alert">
            {aanmakenFout}
          </p>
        )}

        <button type="button" className="btn btn-primary" onClick={handleAanmaken} disabled={aanmakenBezig}>
          {aanmakenBezig ? 'Bezig…' : 'Aanmaken'}
        </button>
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Medewerker</th>
              <th>Afdeling / functie</th>
              <th>Periode</th>
              <th>Status</th>
              <th>Medewerker ingevuld</th>
              <th>Leidinggevende ingevuld</th>
              <th>Verwijderen</th>
            </tr>
          </thead>
          <tbody>
            {beoordelingen.map((b) => (
              <tr key={b.id} className="gpb-rij-klikbaar" onClick={() => setGeselecteerdId(b.id)}>
                <td data-label="Medewerker">{b.medewerker_naam}</td>
                <td data-label="Afdeling / functie">
                  {b.afdeling} · {functieLabel(b.afdeling, b.functieniveau)}
                </td>
                <td data-label="Periode">{b.periode}</td>
                <td data-label="Status">{STATUS_LABELS[b.status]}</td>
                <td data-label="Medewerker ingevuld">{fmtDatum(b.medewerker_ingevuld_at)}</td>
                <td data-label="Leidinggevende ingevuld">{fmtDatum(b.leidinggevende_ingevuld_at)}</td>
                <td data-label="Verwijderen" onClick={(e) => e.stopPropagation()}>
                  {confirmDeleteId === b.id ? (
                    <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                      <button type="button" className="btn btn-danger" disabled={bezig} onClick={() => handleVerwijderen(b.id)}>
                        Ja
                      </button>
                      <button type="button" className="btn btn-ghost" onClick={() => setConfirmDeleteId(null)}>
                        Nee
                      </button>
                    </div>
                  ) : (
                    <button type="button" className="btn btn-danger" onClick={() => setConfirmDeleteId(b.id)}>
                      Verwijderen
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {beoordelingen.length === 0 && <div className="idle-state">Nog geen beoordelingen aangemaakt.</div>}
      </div>
    </div>
  )
}
