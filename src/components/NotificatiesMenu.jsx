import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchOnbekekenNotificaties } from '../lib/notificatiesApi'

const TYPE_BADGE = {
  troubleshoot_nieuw: { label: 'Melding', className: 'badge-brand' },
  gpb_medewerker_invullen: { label: 'GPB', className: 'badge-blauwgrijs' },
  gpb_leidinggevende_invullen: { label: 'GPB', className: 'badge-blauwgrijs' },
  gpb_wacht_op_goedkeuring: { label: 'GPB', className: 'badge-mos' },
}

function fmtDatum(iso) {
  return new Date(iso).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })
}

/**
 * Generiek, persoonlijk notificatiepaneel in de topbar (Dashboard.jsx) —
 * voor elke ingelogde gebruiker. Toont wat voor DIE specifieke gebruiker
 * relevant is (RLS op `notificaties` beperkt dit al tot auth.uid(), dus
 * geen rolcheck hier nodig): admins zien nieuwe troubleshoot-meldingen,
 * iedereen ziet daarnaast zijn eigen openstaande GPB-acties.
 *
 * Rijen worden uitsluitend door database-triggers geschreven/opgelost
 * (zie de notificaties-sectie in supabase/schema.sql) — er is bewust geen
 * "markeer als gelezen"-knop, dat gebeurt automatisch zodra de
 * onderliggende actie (ticket afgehandeld, GPB ingevuld/goedgekeurd) is
 * afgerond.
 */
export default function NotificatiesMenu() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState([])
  const wrapRef = useRef(null)

  useEffect(() => {
    let isMounted = true

    fetchOnbekekenNotificaties()
      .then((data) => {
        if (isMounted) setItems(data)
      })
      .catch((err) => console.error('[NotificatiesMenu] Kon notificaties niet laden:', err.message))

    return () => {
      isMounted = false
    }
  }, [])

  useEffect(() => {
    if (!open) return

    function handleClickBuiten(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickBuiten)
    return () => document.removeEventListener('mousedown', handleClickBuiten)
  }, [open])

  function openNotificatie(item) {
    setOpen(false)
    if (item.link) navigate(item.link)
  }

  return (
    <div className="notificaties-wrap" ref={wrapRef}>
      <button
        type="button"
        className="notificaties-btn"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        Notificaties
        {items.length > 0 && <span className="notificaties-stip" />}
      </button>

      {open && (
        <div className="notificaties-panel">
          {items.length === 0 ? (
            <p className="notificaties-leeg">Geen nieuwe notificaties.</p>
          ) : (
            <ul className="notificaties-lijst">
              {items.map((item) => {
                const badge = TYPE_BADGE[item.type] || { label: item.type, className: 'badge-blauwgrijs' }
                return (
                  <li key={item.id}>
                    <button type="button" className="notificaties-item" onClick={() => openNotificatie(item)}>
                      <span className={`badge ${badge.className}`}>{badge.label}</span>
                      <span className="notificaties-item-tekst">
                        <strong>{item.titel}</strong> · {fmtDatum(item.created_at)}
                        {item.omschrijving && (
                          <>
                            <br />
                            {item.omschrijving}
                          </>
                        )}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
