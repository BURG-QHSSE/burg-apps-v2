import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../lib/AuthProvider'
import { burgJobsSupabase } from '../../lib/burgJobsClient'
import PresenceBlock from './mijn-omgeving/PresenceBlock'
import SwipenTab from './mijn-omgeving/SwipenTab'
import MijnVacaturesTab from './mijn-omgeving/MijnVacaturesTab'
import AdminOverzichtTab from './mijn-omgeving/AdminOverzichtTab'

// Kolommen exact zoals `loadSwipe()` in de bron (regel 745-748).
const SWIPE_COLUMNS =
  'id,job_title,company_name,job_location,job_url,data_source,date_scraped,posted_at,salary,employment_type,industry,recruiter_name,recruiter_headline,recruiter_linkedin,company_website,job_description,contact_name,contact_email,contact_phone'

/**
 * Kansen Swiper (voorheen "Mijn Omgeving") — Fase 1: Swipen + Mijn Vacatures + aanwezigheidswidget.
 * Second Check / Analytics / Monitoring zijn bewust buiten scope (zie
 * projectinstructie); de tab-switcher hieronder is opzettelijk generiek
 * gehouden (een array van tabs, niet precies 2/3 vast) zodat die later
 * toegevoegd/verwijderd kunnen worden zonder herstructurering.
 *
 * Swipen- en vacature-tab blijven permanent gemount (zichtbaarheid via een
 * `visible`-prop + CSS-klasse, net als de tab-panels in de bron), zodat de
 * wachtrij-positie en het actieve filter niet verloren gaan bij het
 * wisselen tussen tabs.
 *
 * Twee gescheiden Supabase-projecten: identiteit/rollen komen uit dit
 * v2-project (`useAuth()`), de recruitment-data komt uit het losse
 * burg-jobs-project (`burgJobsSupabase`, zie src/lib/burgJobsClient.js). Er
 * is bewust geen tweede login-sessie op dat project — matching gebeurt puur
 * op e-mailadres (`profile.email` tegen `employees.email` / `jobs.assigned_to`).
 *
 * Swipen + de aanwezigheidswidget zijn exclusief voor gebruikers met
 * `profile.mijn_omgeving_uitgebreid`. "Mijn Vacatures" blijft voor iedereen
 * zichtbaar: dat toont alleen je eigen al-toegewezen (Go-)vacatures, los
 * van wie er mag swipen.
 *
 * De swipe-wachtrij is BEWUST één gedeelde lijst: alle `pending`-vacatures
 * zijn zichtbaar voor iedere uitgebreide gebruiker, er wordt niets meer
 * per persoon vooraf toegewezen/verdeeld (dat gebeurde voorheen via
 * distributeUnassignedJobs, inmiddels verwijderd — dat gaf iedereen een
 * eigen "hapje" i.p.v. één gezamenlijke pot om uit te swipen). Twee mensen
 * kunnen in theorie dezelfde vacature tegelijk open hebben staan; wie het
 * eerst swiped werkt de rij bij, de ander ziet 'm bij de eerstvolgende
 * herlaad niet meer terug — geaccepteerd risico bij een klein team, geen
 * claim-mechanisme nodig.
 *
 * Aanwezigheid bepaalt uitsluitend waar GOEDGEKEURDE (Go) vacatures na een
 * swipe heen gaan (zie assignGoVacature in burgJobsHelpers.js) — los van
 * wie er mag swipen.
 */
export default function MijnOmgeving() {
  const { profile } = useAuth()
  const currentUserEmail = profile?.email ?? null
  const isUitgebreid = profile?.mijn_omgeving_uitgebreid ?? false
  const isAdmin = profile?.role === 'admin'

  const tabs = []
  if (isUitgebreid) tabs.push('swipen')
  tabs.push('vacatures')
  if (isAdmin) tabs.push('overzicht')

  const [activeTab, setActiveTab] = useState(() => (isUitgebreid ? 'swipen' : 'vacatures'))
  const swipenVisible = isUitgebreid && activeTab === 'swipen'
  const vacaturesVisible = activeTab === 'vacatures'
  const overzichtVisible = isAdmin && activeTab === 'overzicht'

  const [employees, setEmployees] = useState([])
  const [employeesLoading, setEmployeesLoading] = useState(true)
  const [employeesError, setEmployeesError] = useState('')

  const [swipeJobs, setSwipeJobs] = useState([])
  const [swipeLoading, setSwipeLoading] = useState(true)
  const [swipeError, setSwipeError] = useState('')
  const [swipeVersion, setSwipeVersion] = useState(0)
  const [swipeRemaining, setSwipeRemaining] = useState(0)
  const [vacaturesNieuwCount, setVacaturesNieuwCount] = useState(0)

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
    setSwipeLoading(true)
    setSwipeError('')

    // Gedeelde lijst: geen filter op assigned_to, iedere uitgebreide
    // gebruiker ziet dezelfde pending-vacatures.
    const { data, error } = await burgJobsSupabase.from('jobs').select(SWIPE_COLUMNS).eq('review_status', 'pending')

    if (error) {
      setSwipeError(error.message)
      setSwipeJobs([])
      setSwipeLoading(false)
      return
    }

    setSwipeJobs(data || [])
    setSwipeVersion((v) => v + 1)
    setSwipeLoading(false)
  }, [])

  // Init: medewerkers laden (nodig voor Doorsturen/Presence/Overzicht, ook
  // voor niet-uitgebreide gebruikers) -> voor uitgebreide gebruikers ook de
  // gedeelde swipe-wachtrij laden.
  useEffect(() => {
    if (!currentUserEmail) return undefined
    let cancelled = false

    ;(async () => {
      await loadEmployees()
      if (cancelled || !isUitgebreid) return
      await loadSwipeQueue()
    })()

    return () => {
      cancelled = true
    }
  }, [currentUserEmail, isUitgebreid, loadEmployees, loadSwipeQueue])

  // Live presence-sync: als een collega elders zijn aanwezigheid wijzigt,
  // updatet dit scherm zonder herladen — poort van het 'employees-presence-
  // watch' channel uit de bron (regel 606-613).
  useEffect(() => {
    const channel = burgJobsSupabase
      .channel('employees-presence-watch')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'employees' }, (payload) => {
        setEmployees((prev) =>
          prev.map((emp) => (emp.id === payload.new.id ? { ...emp, is_present: payload.new.is_present } : emp)),
        )
      })
      .subscribe()

    return () => {
      burgJobsSupabase.removeChannel(channel)
    }
  }, [])

  // "Bevestig aanwezigheid": schrijft alleen is_present per medewerker.
  // Dit bepaalt uitsluitend waar toekomstige GOEDGEKEURDE (Go) vacatures
  // heen gaan (assignGoVacature) — het raakt nooit de swipe-wachtrij, die is
  // sowieso gedeeld en onafhankelijk van aanwezigheid.
  const handleConfirmPresence = useCallback(
    async (updates) => {
      await Promise.all(
        updates.map(({ id, is_present }) => burgJobsSupabase.from('employees').update({ is_present }).eq('id', id)),
      )

      setEmployees((prev) =>
        prev.map((emp) => {
          const match = updates.find((u) => u.id === emp.id)
          return match ? { ...emp, is_present: match.is_present } : emp
        }),
      )

      showToast('Aanwezigheid bijgewerkt.')
    },
    [showToast],
  )

  function handleWentGo() {
    setVacaturesRefreshToken((v) => v + 1)
  }

  return (
    <div className="page">
      <header className="topbar">
        <div>
          <h1>Kansen Swiper</h1>
        </div>
        <div className="topbar-actions">
          <Link to="/" className="btn btn-secondary">
            Terug naar dashboard
          </Link>
        </div>
      </header>

      <main className="page-content">
        {isUitgebreid && (
          <PresenceBlock
            employees={employees}
            loading={employeesLoading}
            error={employeesError}
            onConfirm={handleConfirmPresence}
          />
        )}

        {tabs.length > 1 && (
          <div className="mo-tab-bar">
            {tabs.includes('swipen') && (
              <button
                type="button"
                className={activeTab === 'swipen' ? 'mo-tab-btn active' : 'mo-tab-btn'}
                onClick={() => setActiveTab('swipen')}
              >
                Swipen
                <span className="mo-count-pill">{swipeRemaining}</span>
              </button>
            )}
            {tabs.includes('vacatures') && (
              <button
                type="button"
                className={activeTab === 'vacatures' ? 'mo-tab-btn active' : 'mo-tab-btn'}
                onClick={() => setActiveTab('vacatures')}
              >
                Mijn Vacatures
                <span className="mo-count-pill">{vacaturesNieuwCount}</span>
              </button>
            )}
            {tabs.includes('overzicht') && (
              <button
                type="button"
                className={activeTab === 'overzicht' ? 'mo-tab-btn active' : 'mo-tab-btn'}
                onClick={() => setActiveTab('overzicht')}
              >
                Overzicht
              </button>
            )}
          </div>
        )}

        {isUitgebreid && (
          <SwipenTab
            visible={swipenVisible}
            jobs={swipeJobs}
            version={swipeVersion}
            loading={swipeLoading}
            error={swipeError}
            employees={employees}
            currentUserEmail={currentUserEmail}
            onRemainingChange={setSwipeRemaining}
            onWentGo={handleWentGo}
          />
        )}

        <MijnVacaturesTab
          visible={vacaturesVisible}
          employees={employees}
          currentUserEmail={currentUserEmail}
          refreshToken={vacaturesRefreshToken}
          onToast={showToast}
          onNieuwCountChange={setVacaturesNieuwCount}
        />

        {isAdmin && (
          <AdminOverzichtTab
            visible={overzichtVisible}
            employees={employees}
            employeesLoading={employeesLoading}
            employeesError={employeesError}
          />
        )}
      </main>

      {toast && <div className="mo-toast">{toast}</div>}
    </div>
  )
}
