import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * React Router ververst bij navigatie de pagina niet echt (single-page
 * app), dus de scrollpositie van de vorige pagina blijft anders gewoon
 * staan — een tool die je opent lijkt dan halverwege te beginnen i.p.v.
 * bovenaan. Scrollt daarom bij elke route-wijziging terug naar boven.
 */
export default function ScrollToTop() {
  const { pathname } = useLocation()

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])

  return null
}
