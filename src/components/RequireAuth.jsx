import { useEffect } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/AuthProvider'

/**
 * Beschermt routes die een ingelogde gebruiker vereisen.
 * - Toont een laadindicator zolang de sessie/profiel-check nog loopt,
 *   zodat het loginscherm niet even flitst voor een reeds ingelogde
 *   gebruiker (bv. na een page refresh).
 * - Stuurt niet-ingelogde gebruikers naar /login, en bewaart de
 *   oorspronkelijke locatie zodat Login daarna kan terugsturen.
 * - Een gedeactiveerd profiel (actief = false, zie set_user_actief() in
 *   het Adminpaneel) wordt hier uitgelogd en geblokkeerd — zonder deze
 *   check zou "deactiveren" puur cosmetisch zijn: de bestaande sessie zou
 *   gewoon blijven werken.
 */
export default function RequireAuth({ children }) {
  const { user, profile, loading, signOut } = useAuth()
  const location = useLocation()
  const isGedeactiveerd = !loading && user && profile && profile.actief === false

  useEffect(() => {
    if (isGedeactiveerd) {
      signOut()
    }
  }, [isGedeactiveerd, signOut])

  if (loading) {
    return (
      <div className="center-page">
        <p>Laden…</p>
      </div>
    )
  }

  if (isGedeactiveerd) {
    return (
      <div className="center-page">
        <div className="empty-state">
          <h1>Account gedeactiveerd</h1>
          <p>Je account is gedeactiveerd. Neem contact op met een beheerder.</p>
        </div>
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  return children
}
