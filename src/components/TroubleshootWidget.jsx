import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../lib/AuthProvider'
import { submitTroubleshootItem } from '../lib/troubleshootApi'

const TYPE_OPTIES = [
  { value: 'idee', label: 'Idee' },
  { value: 'probleem', label: 'Probleem' },
]

/**
 * Floating helpdesk-widgetje — voor ALLE ingelogde gebruikers, op elke
 * pagina (gerenderd in App.jsx, buiten de tool-routes om, zie AppRoutes).
 * Meldingen komen terecht in de admin-only "Meldingen"-tab van Ontwikkeling
 * (zie src/pages/tools/dev-projecten/MeldingenTab.jsx) — de indiener zelf
 * krijgt bewust alleen een bevestiging te zien, geen statusverloop.
 */
export default function TroubleshootWidget() {
  const { user } = useAuth()
  const location = useLocation()

  const [open, setOpen] = useState(false)
  const [type, setType] = useState('idee')
  const [omschrijving, setOmschrijving] = useState('')
  const [versturen, setVersturen] = useState(false)
  const [verstuurError, setVerstuurError] = useState('')
  const [verzonden, setVerzonden] = useState(false)

  function reset() {
    setType('idee')
    setOmschrijving('')
    setVerstuurError('')
    setVerzonden(false)
  }

  function sluit() {
    setOpen(false)
    reset()
  }

  async function handleVerstuur(e) {
    e.preventDefault()
    if (!omschrijving.trim() || versturen) return

    setVersturen(true)
    setVerstuurError('')

    try {
      await submitTroubleshootItem({
        type,
        omschrijving: omschrijving.trim(),
        userId: user?.id,
        vanuitTool: location.pathname,
      })
      setVerzonden(true)
    } catch (err) {
      setVerstuurError(err.message)
    } finally {
      setVersturen(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        className="helpdesk-widget-btn"
        onClick={() => setOpen(true)}
        title="Idee of probleem melden"
      >
        ?
      </button>
    )
  }

  return (
    <div className="helpdesk-widget-panel">
      <div className="helpdesk-widget-header">
        <span className="helpdesk-widget-title">Melding maken</span>
        <button type="button" className="delete-btn" title="Sluiten" onClick={sluit}>
          ✕
        </button>
      </div>

      {verzonden ? (
        <p className="helpdesk-widget-bevestiging">Bedankt, je melding is verstuurd.</p>
      ) : (
        <form onSubmit={handleVerstuur}>
          <div className="btn-toggle-group">
            {TYPE_OPTIES.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={type === opt.value ? 'btn-toggle active' : 'btn-toggle'}
                onClick={() => setType(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <textarea
            className="field-textarea helpdesk-widget-textarea"
            placeholder="Waar loop je tegenaan, of wat zou helpen?"
            value={omschrijving}
            disabled={versturen}
            autoFocus
            onChange={(e) => setOmschrijving(e.target.value)}
          />

          {verstuurError && (
            <p className="form-error" role="alert">
              {verstuurError}
            </p>
          )}

          <div className="submit-row">
            <button type="submit" className="btn btn-primary" disabled={versturen || !omschrijving.trim()}>
              {versturen ? 'Versturen…' : 'Versturen'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
