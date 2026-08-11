import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchNieuweTroubleshootItems } from '../lib/troubleshootApi'
import { toolNaamVoorPad } from '../pages/tools/dev-projecten/MeldingenTab'

function fmtDatum(iso) {
  return new Date(iso).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })
}

/**
 * Notificatieknop in de topbar (admin-only, zie Dashboard.jsx) — toont de
 * nog niet opgepakte troubleshoot-meldingen ('nieuw'). Klikken op een
 * melding stuurt naar de Meldingen-tab van Ontwikkeling; de status zelf
 * wijzigen kan alleen daar (dit paneel is puur "wat is er binnengekomen").
 */
export default function NotificatiesMenu() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState([])
  const wrapRef = useRef(null)

  useEffect(() => {
    let isMounted = true

    fetchNieuweTroubleshootItems()
      .then((data) => {
        if (isMounted) setItems(data)
      })
      .catch((err) => console.error('[NotificatiesMenu] Kon meldingen niet laden:', err.message))

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

  function openMelding() {
    setOpen(false)
    navigate('/tools/dev-projecten?tab=meldingen')
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
            <p className="notificaties-leeg">Geen nieuwe meldingen.</p>
          ) : (
            <ul className="notificaties-lijst">
              {items.map((item) => (
                <li key={item.id}>
                  <button type="button" className="notificaties-item" onClick={openMelding}>
                    <span className={item.type === 'probleem' ? 'badge badge-brand' : 'badge badge-blauwgrijs'}>
                      {item.type === 'probleem' ? 'Probleem' : 'Idee'}
                    </span>
                    <span className="notificaties-item-tekst">
                      <strong>{item.ingediend_door?.naam || 'Onbekend'}</strong> · {toolNaamVoorPad(item.vanuit_tool)} ·{' '}
                      {fmtDatum(item.created_at)}
                      <br />
                      {item.omschrijving}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
