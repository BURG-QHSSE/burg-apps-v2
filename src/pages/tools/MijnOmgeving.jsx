import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../lib/AuthProvider'
import { burgJobsSupabase } from '../../lib/burgJobsClient'
import PresenceBlock from './mijn-omgeving/PresenceBlock'
import SwipenTab from './mijn-omgeving/SwipenTab'
import MijnVacaturesTab from './mijn-omgeving/MijnVacaturesTab'
import { distributeUnassignedJobs, redistributePendingJobs } from './mijn-omgeving/burgJobsHelpers'

// Kolommen exact zoals `loadSwipe()` in de bron (regel 745-748).
const SWIPE_COLUMNS =
  'id,job_title,company_name,job_location,job_url,data_source,date_scraped,posted_at,salary,employment_type,industry,recruiter_name,recruiter_headline,recruiter_linkedin,company_website,job_description,contact_name,contact_email,contact_phone'

/**
 * Mijn Omgeving — Fase 1: Swipen + Mijn Vacatures + aanwezigheidswidget.
 * Second Check / Analytics / Monitoring zijn bewust buiten scope (zie
 * projectinstructie); de tab-switcher hieronder is opzettelijk generiek
 * gehouden (een array van tabs, geen aannames over precies 2 stuks) zodat
 * die later toegevoegd kunnen worden zonder herstructurering.
 *
 * Beide swipe- en vacature-tabs blijven permanent gemount (zichtbaarheid via
 * een `visible`-prop + CSS-klasse, net als de tab-panels in de bron), zodat
 * de wachtrij-positie en het actieve filter niet verloren gaan bij het
 * wisselen tussen tabs.
 *
 * Twee gescheiden Supabase-projecten: identiteit/rollen komen uit dit
 * v2-project (`useAuth()`), de recruitment-data komt uit het losse
 * burg-jobs-project (`burgJobsSupabase`, zie src/lib/burgJobsClient.js). Er
 * is bewust geen tweede login-sessie op dat project — matching gebeurt puur
 * op e-mailadres (`profile.email` tegen `employees.email` / `jobs.assigned_to`).
 */
export default function MijnOmgeving() {
  const { profile } = useAuth()
  const currentUserEmail = profile?.email ?? null

  const [activeTab, setActiveTab] = useState('swipen')

  const [employees, setEmployees] = useState([])
  const [employeesLoading, setEmployeesLoading] = useState(true)
  const [employeesError, setEmployeesError] = useState('')

  const [swipeJobs, setSwipeJobs] = useState([])
  const [swipeLoading, setSwipeLoading] = useState(true)
  const [swipeError, setSwipeError] = useState('')
  const [swipeVersion, setSwipeVersion] = useState(0)
  const [swipeRemaining, setSwipeRemaining] = useState(0)

  // Bumpt na elke Go-beslissing zodat Mijn Vacatures stil herlaadt, ook als
  // die tab niet actief is (matcht `loadMijnVacaturesBackground()` in de bron).
  const [vacaturesRefreshToken, setVacaturesRefreshToken] = useState(0)

  const [toast, setToast] = useState('')

  const showToast = useCallback((message) => {
    setToast(message)
  }, [])

  useEffect(() => {
    if (!toast) return undefined
    const timer = setTimeout(() => setToast(''), 2800)
    return () => clearTimeout(timer)
  }, [toast])

  const loadEmployees = useCallback(async () => {
    setEmployeesLoading(true)
    setEmployeesError('')
    const { data, error } = await burgJobsSupabase.from('employees').select('*').order('name')
    if (error) {
      setEmployeesError(error.message)
      setEmployees([])
      setEmployeesLoading(false)
      return []
    }
    setEmployees(data || [])
    setEmployeesLoading(false)
    return data || []
  }, [])

  const loadSwipeQueue = useCallback(async () => {
    if (!currentUserEmail) return
    setSwipeLoading(true)
    setSwipeError('')

    const { data, error } = await burgJobsSupabase
      .from('jobs')
      .select(SWIPE_COLUMNS)
      .eq('review_status', 'pending')
      .eq('assigned_to', currentUserEmail)

    if (error) {
      setSwipeError(error.message)
      setSwipeJobs([])
      setSwipeLoading(false)
      return
    }

    setSwipeJobs(data || [])
    setSwipeVersion((v) => v + 1)
    setSwipeLoading(false)
  }, [currentUserEmail])

  // Init: medewerkers laden -> onbezette pending vacatures verdelen -> swipe-
  // wachtrij laden. Exact de volgorde van `init()` in de bron (regel 622-632).
  useEffect(() => {
    if (!currentUserEmail) return undefined
    let cancelled = false

    ;(async () => {
      const emps = await loadEmployees()
      if (cancelled) return
      await distributeUnassignedJobs(emps)
      if (cancelled) return
      await loadSwipeQueue()
    })()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserEmail])

  // "Bevestig aanwezigheid": schrijft is_present per medewerker, herverdeelt
  // ALLE pending vacatures over de nu-aanwezige medewerkers, en herlaadt de
  // swipe-wachtrij — exact `confirmPresence()` in de bron (regel 680-700).
  const handleConfirmPresence = useCallback(
    async (updates) => {
      await Promise.all(
        updates.map(({ id, is_present }) => burgJobsSupabase.from('employees').update({ is_present }).eq('id', id)),
      )

      const nextEmployees = employees.map((emp) => {
        const match = updates.find((u) => u.id === emp.id)
        return match ? { ...emp, is_present: match.is_present } : emp
      })
      setEmployees(nextEmployees)

      await redistributePendingJobs(nextEmployees)
      await loadSwipeQueue()
      showToast('Aanwezigheid bijgewerkt en verdeling herberekend.')
    },
    [employees, loadSwipeQueue, showToast],
  )

  function handleWentGo() {
    setVacaturesRefreshToken((v) => v + 1)
  }

  return (
    <div className="page">
      <header className="topbar">
        <div>
          <h1>Mijn Omgeving</h1>
        </div>
        <div className="topbar-actions">
          <Link to="/" className="btn btn-secondary">
            Terug naar dashboard
          </Link>
        </div>
      </header>

      <main className="page-content">
        <PresenceBlock
          employees={employees}
          loading={employeesLoading}
          error={employeesError}
          onConfirm={handleConfirmPresence}
        />

        <div className="mo-tab-bar">
          <button
            type="button"
            className={activeTab === 'swipen' ? 'mo-tab-btn active' : 'mo-tab-btn'}
            onClick={() => setActiveTab('swipen')}
          >
            Swipen
            <span className="mo-count-pill">{swipeRemaining}</span>
          </button>
          <button
            type="button"
            className={activeTab === 'vacatures' ? 'mo-tab-btn active' : 'mo-tab-btn'}
            onClick={() => setActiveTab('vacatures')}
          >
            Mijn Vacatures
          </button>
        </div>

        <SwipenTab
          visible={activeTab === 'swipen'}
          jobs={swipeJobs}
          version={swipeVersion}
          loading={swipeLoading}
          error={swipeError}
          employees={employees}
          currentUserEmail={currentUserEmail}
          onRemainingChange={setSwipeRemaining}
          onWentGo={handleWentGo}
        />

        <MijnVacaturesTab
          visible={activeTab === 'vacatures'}
          employees={employees}
          currentUserEmail={currentUserEmail}
          refreshToken={vacaturesRefreshToken}
          onToast={showToast}
        />
      </main>

      {toast && <div className="mo-toast">{toast}</div>}
    </div>
  )
}
