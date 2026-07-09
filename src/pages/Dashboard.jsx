import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/AuthProvider'
import { useTheme } from '../lib/useTheme'
import { TOOLS, TOOL_CATEGORIES, hasAccess } from '../lib/toolRegistry'
import { fetchMyToolUsageSummary } from '../lib/toolUsage'
import ToolIcon from '../lib/toolIcons'

const ROLE_LABELS = {
  admin: 'Admin',
  manager: 'Manager',
  hr: 'HR',
  user: 'Gebruiker',
}

function roleLabel(role) {
  return ROLE_LABELS[role] ?? role
}

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
      <div>
        <div className="featured-tool-name">{tool.naam}</div>
        <div className="tool-card-hint">{gebruikLabel(entry)}</div>
      </div>
    </Link>
  )
}

function ToolCard({ tool, unlocked }) {
  if (!unlocked) {
    return (
      <div className="tool-card tool-card-locked" aria-disabled="true">
        <span className="tool-card-lock" aria-hidden="true">
          🔒
        </span>
        <span className="tool-card-name">{tool.naam}</span>
        <span className="tool-card-hint">
          Vereist rol: {roleLabel(tool.minimumRole)}
        </span>
      </div>
    )
  }

  return (
    <Link to={tool.path} className="tool-card">
      <div className="tool-card-icon">
        <ToolIcon toolId={tool.id} size={17} />
      </div>
      <span className="tool-card-name">{tool.naam}</span>
      <span className="tool-card-hint">Openen →</span>
    </Link>
  )
}

export default function Dashboard() {
  const { user, profile, signOut } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const [gebruik, setGebruik] = useState([])

  useEffect(() => {
    let isMounted = true

    if (user?.id) {
      fetchMyToolUsageSummary(user.id).then((summary) => {
        if (isMounted) setGebruik(summary)
      })
    }

    return () => {
      isMounted = false
    }
  }, [user?.id])

  const featuredTools = gebruik
    .map((entry) => ({ entry, tool: TOOLS.find((t) => t.id === entry.toolId) }))
    .filter(({ tool }) => tool && hasAccess(profile?.role, tool.minimumRole))
    .slice(0, 2)

  return (
    <div className="page">
      <header className="topbar">
        <div>
          <h1>BURG Apps</h1>
          {profile && (
            <p className="topbar-user">
              {profile.naam} · {roleLabel(profile.role)}
            </p>
          )}
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
        <div className="dashboard-greeting">
          <h2>
            {getGroet()}
            {profile?.naam ? `, ${profile.naam.split(' ')[0]}` : ''}
          </h2>
          <p>{vandaagLabel()} — hier zijn je tools voor vandaag.</p>
        </div>

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
