import { useState } from 'react'
import { Link } from 'react-router-dom'
import ProjectenTab from './dev-projecten/ProjectenTab'
import MeldingenTab from './dev-projecten/MeldingenTab'

const TABS = [
  { id: 'projecten', label: 'Projecten' },
  { id: 'meldingen', label: 'Meldingen' },
]

/**
 * Ontwikkeling — admin-only tabblad (Max/Nils/Amber, zie toolRegistry.js).
 * Projecten: gedeelde project/idee-lijst (dev_projects). Meldingen: inbox
 * voor de meldingen die iedereen indient via het floating helpdesk-
 * widgetje (TroubleshootWidget.jsx, buiten deze tool om gerenderd).
 */
export default function Ontwikkeling() {
  const [activeTab, setActiveTab] = useState('projecten')

  return (
    <div className="page">
      <header className="topbar">
        <div>
          <h1>Ontwikkeling</h1>
        </div>
        <div className="topbar-actions">
          <Link to="/" className="btn btn-secondary">
            Terug naar dashboard
          </Link>
        </div>
      </header>

      <main className="page-content">
        <div className="btn-toggle-group">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={activeTab === tab.id ? 'btn-toggle active' : 'btn-toggle'}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div style={{ marginTop: 'var(--space-5)' }}>
          {activeTab === 'projecten' && <ProjectenTab />}
          {activeTab === 'meldingen' && <MeldingenTab />}
        </div>
      </main>
    </div>
  )
}
