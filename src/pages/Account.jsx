import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/AuthProvider'

/** Laat een ingelogde gebruiker zelf zijn/haar wachtwoord wijzigen. */
export default function Account() {
  const { user, profile, updatePassword } = useAuth()

  const [password, setPassword] = useState('')
  const [passwordHerhaald, setPasswordHerhaald] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    setError(null)
    setSuccess(false)

    if (password.length < 6) {
      setError('Wachtwoord moet minimaal 6 tekens lang zijn.')
      return
    }
    if (password !== passwordHerhaald) {
      setError('Wachtwoorden komen niet overeen.')
      return
    }

    setSubmitting(true)
    const { error: updateError } = await updatePassword(password)
    setSubmitting(false)

    if (updateError) {
      setError(updateError.message)
      return
    }

    setPassword('')
    setPasswordHerhaald('')
    setSuccess(true)
  }

  return (
    <div className="page">
      <header className="topbar">
        <div>
          <h1>Mijn account</h1>
          {profile && (
            <p className="topbar-user">
              {profile.naam} · {user?.email}
            </p>
          )}
        </div>
        <div className="topbar-actions">
          <Link to="/" className="btn btn-secondary">
            Terug naar dashboard
          </Link>
        </div>
      </header>

      <main className="page-content">
        <form className="section-card account-card" onSubmit={handleSubmit}>
          <h2>Wachtwoord wijzigen</h2>

          <label className="field">
            <span>Nieuw wachtwoord</span>
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              disabled={submitting}
            />
          </label>

          <label className="field">
            <span>Herhaal nieuw wachtwoord</span>
            <input
              type="password"
              autoComplete="new-password"
              value={passwordHerhaald}
              onChange={(event) => setPasswordHerhaald(event.target.value)}
              required
              disabled={submitting}
            />
          </label>

          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {success && <p className="form-success">Wachtwoord aangepast.</p>}

          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'Bezig met opslaan…' : 'Wachtwoord opslaan'}
          </button>
        </form>
      </main>
    </div>
  )
}
