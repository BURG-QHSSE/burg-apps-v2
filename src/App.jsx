import { useEffect } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/AuthProvider'
import { TOOLS } from './lib/toolRegistry'
import { logToolUsage } from './lib/toolUsage'
import RoleGate from './components/RoleGate'
import RequireAuth from './components/RequireAuth'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import AdminPanel from './pages/AdminPanel'
import GeenToegang from './pages/GeenToegang'
import ToolPlaceholder from './pages/ToolPlaceholder'
import FeeChecker from './pages/tools/FeeChecker'
import DefinitiefHonorarium from './pages/tools/DefinitiefHonorarium'
import VerdelingPlaatsing from './pages/tools/VerdelingPlaatsing'
import SalesOverdracht from './pages/tools/SalesOverdracht'
import DoorgroeiTracker from './pages/tools/DoorgroeiTracker'
import MijnOmgeving from './pages/tools/MijnOmgeving'
import './App.css'
import './pages.css'

// Mapping van tool-id naar het daadwerkelijke component. Tools zonder
// entry hier vallen terug op ToolPlaceholder (nog te bouwen).
const TOOL_COMPONENTS = {
  'sales-overdracht': SalesOverdracht,
  'fee-checker': FeeChecker,
  'definitief-honorarium': DefinitiefHonorarium,
  'verdeling-plaatsing': VerdelingPlaatsing,
  'doorgroei-tracker': DoorgroeiTracker,
  'mijn-omgeving': MijnOmgeving,
}

/**
 * Logt één keer per mount dat deze tool geopend is (voor App Counter,
 * zichtbaar in het Adminpaneel). Faalt de log-poging, dan gebeurt er
 * niets zichtbaars voor de gebruiker — zie logToolUsage().
 */
function ToolUsageTracker({ toolId, userId, children }) {
  useEffect(() => {
    logToolUsage(toolId, userId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toolId, userId])

  return children
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  )
}

function AppRoutes() {
  const { profile, user } = useAuth()
  const userRole = profile?.role

  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route
        path="/"
        element={
          <RequireAuth>
            <Dashboard />
          </RequireAuth>
        }
      />

      <Route
        path="/admin"
        element={
          <RequireAuth>
            <RoleGate minimumRole="admin" userRole={userRole} fallback={<GeenToegang />}>
              <AdminPanel />
            </RoleGate>
          </RequireAuth>
        }
      />

      {TOOLS.map((tool) => {
        const ToolComponent = TOOL_COMPONENTS[tool.id] ?? ToolPlaceholder
        const toolElement =
          ToolComponent === ToolPlaceholder ? (
            <ToolPlaceholder naam={tool.naam} />
          ) : (
            <ToolComponent />
          )

        return (
          <Route
            key={tool.id}
            path={tool.path}
            element={
              <RequireAuth>
                <RoleGate
                  minimumRole={tool.minimumRole}
                  userRole={userRole}
                  fallback={<GeenToegang />}
                >
                  <ToolUsageTracker toolId={tool.id} userId={user?.id}>
                    {toolElement}
                  </ToolUsageTracker>
                </RoleGate>
              </RequireAuth>
            }
          />
        )
      })}

      <Route
        path="*"
        element={
          <RequireAuth>
            <GeenToegang />
          </RequireAuth>
        }
      />
    </Routes>
  )
}

export default App
