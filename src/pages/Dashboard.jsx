import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/AuthProvider'
import { useTheme } from '../lib/useTheme'
import { TOOLS, TOOL_CATEGORIES, hasAccess, roleLabel } from '../lib/toolRegistry'
import { fetchMyToolUsageSummary } from '../lib/toolUsage'
import { fetchMijnGpb, telOpenstaandeGpbActies } from '../lib/gpbApi'
import { fetchNieuweVacaturesCount } from './tools/mijn-omgeving/burgJobsHelpers'
import ToolIcon from '../lib/toolIcons'
import YieldThermometer from './YieldThermometer'

function getGroet() {
  const uur = new Date().getHours()
  if (uur < 12) return 'Goedemorgen'
  if (uur < 18) return 'Goedemiddag'
  return 'Goedenavond'
}

function vandaagLabel() {
  const tekst = new Date().toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' })
  return tekst.charAt(0).toUpperCase() + tekst.slice(1)
}

/** "Vandaag 3x geopend" als er vandaag gebruik was, anders "Laatst gebruikt: gisteren/12 juli". */
function gebruikLabel(entry) {
  if (entry.vandaagCount > 0) {
    return `Vandaag ${entry.vandaagCount}x geopend`
  }

  const datum = new Date(entry.laatstGebruikt)
  const gisteren = new Date()
  gisteren.setDate(gisteren.getDate() - 1)

  if (datum.toDateString() === gisteren.toDateString()) {
    return 'Laatst gebruikt: gisteren'
  }

  return `Laatst gebruikt: ${datum.toLocaleDateString('nl-NL', { day: 'numeric', month: 'long' })}`
}

function FeaturedToolCard({ tool, entry }) {
  return (
    <Link to={tool.path} className="featured-tool-card">
      <div className="featured-tool-icon">
        <ToolIcon toolId={tool.id} size={20} />
      </div>
      <div className="featured-tool-text">
        <div className="featured-tool-name">{tool.naam}</div>
        <div className="tool-card-rule" />
        <div className="tool-card-hint">{gebruikLabel(entry)}</div>
      </div>
    </Link>
  )
}

function ToolCard({ tool, unlocked, badgeAantal }) {
  if (!unlocked) {
    return (
      <div className="tool-card tool-card-locked" aria-disabled="true">
        <div className="tool-card-icon" aria-hidden="true">
          <span className="tool-card-lock">🔒</span>
        </div>
        <div className="tool-card-text">
          <span className="tool-card-name">{tool.naam}</span>
          <div className="tool-card-rule" />
          <span className="tool-card-hint">Vereist rol: {roleLabel(tool.minimumRole)}</span>
        </div>
      </div>
    )
  }

  return (
    <Link to={tool.path} className="tool-card">
      <div className="tool-card-icon">
        <ToolIcon toolId={tool.id} size={19} />
      </div>
      <div className="tool-card-text">
        <span className="tool-card-name">
          {tool.naam}
          {badgeAantal > 0 && <span className="tool-card-badge">{badgeAantal}</span>}
        </span>
        <div className="tool-card-rule" />
        <span className="tool-card-hint">
          Openen<span className="arrow">→</span>
        </span>
      </div>
    </Link>
  )
}

export default function Dashboard() {
  const { user, profile, signOut } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const [gebruik, setGebruik] = useState([])
  const [gpbOpenstaand, setGpbOpenstaand] = useState(0)
  const [nieuweVacaturesCount, setNieuweVacaturesCount] = useState(0)

  useEffect(() => {
    let isMounted = true

    if (user?.id) {
      fetchMyToolUsageSummary(user.id).then((summary) => {
        if (isMounted) setGebruik(summary)
      })

      fetchMijnGpb()
        .then((beoordelingen) => {
          if (isMounted) setGpbOpenstaand(telOpenstaandeGpbActies(beoordelingen, user.id, profile?.role))
        })
        .catch((err) => console.error('[Dashboard] Kon GPB-teller niet laden:', err.message))
    }

    if (profile?.email) {
      fetchNieuweVacaturesCount(profile.email).then((count) => {
        if (isMounted) setNieuweVacaturesCount(count)
      })
    }

    return () => {
      isMounted = false
    }
  }, [user?.id, profile?.role, profile?.email])

  const featuredTools = gebruik
    .map((entry) => ({ entry, tool: TOOLS.find((t) => t.id === entry.toolId) }))
    .filter(({ tool }) => tool && hasAccess(profile?.role, tool.minimumRole))
    .slice(0, 2)

  return (
    <div className="page">
      <header className="topbar">
        <div>
          <h1 className="topbar-greeting-title">
            {getGroet()}
            {profile?.naam ? `, ${profile.naam.split(' ')[0]}` : ''}
          </h1>
          <p className="topbar-greeting-sub">{vandaagLabel()} — hier zijn je tools voor vandaag.</p>
        </div>
        <div className="topbar-actions">
          <button
            type="button"
            className="theme-toggle"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Schakel naar lichte modus' : 'Schakel naar donkere modus'}
            title={theme === 'dark' ? 'Lichte modus' : 'Donkere modus'}
          >
            {theme === 'dark' ? '☀' : '☾'}
          </button>
          {profile?.role === 'admin' && (
            <Link to="/admin" className="btn btn-secondary">
              Adminpaneel
            </Link>
          )}
          <Link to="/account" className="btn btn-secondary">
            Mijn account
          </Link>
          <button type="button" className="btn btn-secondary" onClick={() => signOut()}>
            Uitloggen
          </button>
        </div>
      </header>

      <main className="page-content">
        <YieldThermometer />

        {featuredTools.length > 0 && (
          <section className="tool-section">
            <p className="section-label">Voor jou · meest gebruikt</p>
            <div className="featured-grid">
              {featuredTools.map(({ tool, entry }) => (
                <FeaturedToolCard key={tool.id} tool={tool} entry={entry} />
              ))}
            </div>
          </section>
        )}

        {TOOL_CATEGORIES.map((category) => {
          const toolsInCategory = TOOLS.filter((tool) => tool.category === category.id)

          if (toolsInCategory.length === 0) return null

          return (
            <section key={category.id} className="tool-section">
              <p className="section-label">{category.label}</p>
              <div className="tool-grid">
                {toolsInCategory.map((tool) => (
                  <ToolCard
                    key={tool.id}
                    tool={tool}
                    unlocked={hasAccess(profile?.role, tool.minimumRole)}
                    badgeAantal={
                      tool.id === 'gpb-beoordelingstool'
                        ? gpbOpenstaand
                        : tool.id === 'mijn-omgeving'
                          ? nieuweVacaturesCount
                          : 0
                    }
                  />
                ))}
              </div>
            </section>
          )
        })}
      </main>
    </div>
  )
}
