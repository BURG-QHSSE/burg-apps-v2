import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../lib/AuthProvider'
import { submitTroubleshootItem } from '../lib/troubleshootApi'

const TYPE_OPTIES = [
  { value: 'idee', label: 'Idee' },
  { value: 'probleem', label: 'Probleem' },
]

const INTRO_GEZIEN_KEY = 'helpdesk-widget-intro-gezien'

/**
 * Floating helpdesk-widgetje — voor ALLE ingelogde gebruikers, op elke
 * pagina (gerenderd in App.jsx, buiten de tool-routes om, zie AppRoutes).
 * Meldingen komen terecht in de admin-only "Meldingen"-tab van Ontwikkeling
 * (zie src/pages/tools/dev-projecten/MeldingenTab.jsx) — de indiener zelf
 * krijgt bewust alleen een bevestiging te zien, geen statusverloop.
 *
 * De introtekst verschijnt alleen bij de allereerste keer openen per browser
 * (bijgehouden via localStorage, geen serverkant nodig hiervoor).
 */
export default function TroubleshootWidget() {
  const { user } = useAuth()
  const location = useLocation()

  const [open, setOpen] = useState(false)
  const [toonIntro, setToonIntro] = useState(false)
  const [type, setType] = useState('idee')
  const [omschrijving, setOmschrijving] = useState('')
  const [versturen, setVersturen] = useState(false)
  const [verstuurError, setVerstuurError] = useState('')
  const [verzonden, setVerzonden] = useState(false)

  function openWidget() {
    setOpen(true)
    if (!localStorage.getItem(INTRO_GEZIEN_KEY)) {
      setToonIntro(true)
      localStorage.setItem(INTRO_GEZIEN_KEY, '1')
    }
  }

  function reset() {
    setType('idee')
    setOmschrijving('')
    setVerstuurError('')
    setVerzonden(false)
  }

  function sluit() {
    setOpen(false)
    setToonIntro(false)
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
        onClick={openWidget}
        title="Idee of probleem melden"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
        </svg>
        <span>Feedback</span>
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

      {toonIntro && (
        <div className="helpdesk-widget-intro">
          <p>
            Lieve collega's, dit widgetje is gemaakt zodat jullie snel kunnen aangeven als er iets mis is in de
            BURG App, of om een geniaal idee in te dienen :)
          </p>
          <button type="button" className="helpdesk-widget-intro-sluit" onClick={() => setToonIntro(false)}>
            Begrepen
          </button>
        </div>
      )}

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
