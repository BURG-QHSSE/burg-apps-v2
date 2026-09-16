/**
 * Centraal register van alle tools binnen BURG Apps v2 en de minimale rol
 * die nodig is om ze te mogen gebruiken. De UI-laag (dashboard, navigatie,
 * routing) leest deze lijst uit i.p.v. rollen hardcoded te verspreiden.
 */
export const TOOLS = [
  { id: 'sales-overdracht', naam: 'Sales Overdracht', minimumRole: 'user', path: '/tools/sales-overdracht', category: 'daily' },
  { id: 'fee-checker', naam: 'Fee Checker', minimumRole: 'user', path: '/tools/fee-checker', category: 'daily' },
  { id: 'definitief-honorarium', naam: 'Definitief Honorarium', minimumRole: 'user', path: '/tools/definitief-honorarium', category: 'daily' },
  { id: 'verdeling-plaatsing', naam: 'Verdeling Plaatsing', minimumRole: 'user', path: '/tools/verdeling-plaatsing', category: 'daily' },
  { id: 'mijn-omgeving', naam: 'Kansen Swiper', minimumRole: 'user', path: '/tools/mijn-omgeving', category: 'daily' },
  { id: 'proeftijd-tracker', naam: 'Proeftijd Tracker', minimumRole: 'user', path: '/tools/proeftijd-tracker', category: 'daily' },
  { id: 'bel-overzicht', naam: 'Bel Overzicht', minimumRole: 'user', path: '/tools/bel-overzicht', category: 'daily' },
  // minimumRole is hier bewust 'user' - de echte toegangscheck gebeurt in
  // canAccessTool() hieronder (admin, OF team='consultant' + de
  // call_insights_instellingen.live_voor_consultants-schakelaar staat aan).
  // Die schakelaar staat default UIT: functioneel dus nog steeds admin-only
  // totdat een admin 'm in Instellingen omzet, maar dan zonder code-deploy.
  { id: 'call-insights', naam: 'Call Insights', minimumRole: 'user', path: '/tools/call-insights', category: 'daily' },
  { id: 'doorgroei-tracker', naam: 'Doorgroei Tracker', minimumRole: 'user', path: '/tools/doorgroei-tracker', category: 'groei' },
  { id: 'gpb-beoordelingstool', naam: 'GPB Beoordelingstool', minimumRole: 'user', path: '/tools/gpb-beoordelingstool', category: 'groei' },
  { id: 'dev-projecten', naam: 'Ontwikkeling', minimumRole: 'admin', path: '/tools/dev-projecten', category: 'beheer' },
  { id: 'kandidaat-matcher', naam: 'Kandidaat Matcher', minimumRole: 'user', path: '/tools/kandidaat-matcher', category: 'daily' },
  { id: 'matcher-gebruik', naam: 'Tooling Gebruik', minimumRole: 'admin', path: '/tools/matcher-gebruik', category: 'beheer' },
]

/**
 * Labels voor de categorie-secties op het dashboard. Volgorde hier bepaalt
 * de weergavevolgorde van de secties.
 */
export const TOOL_CATEGORIES = [
  { id: 'daily', label: 'Tools' },
  { id: 'groei', label: 'Persoonlijke groei' },
  { id: 'beheer', label: 'Beheer' },
]

/**
 * Hoe hoger het getal, hoe meer rechten. Moet in lijn blijven met het
 * `user_role` enum in supabase/schema.sql ('admin', 'manager', 'user', 'hr').
 * `hr` deelt bewust hetzelfde niveau als `manager` — overal in de app
 * heeft HR dezelfde toegang als manager. Een toekomstige tool die manager/
 * user/hr wél als 3 losse groepen wil behandelen doet dat zelf, met een
 * eigen check op `profile.role`, niet via deze ladder (zie ook hoe
 * `mijn_omgeving_uitgebreid` los van deze hiërarchie staat).
 */
const ROLE_HIERARCHY = {
  admin: 3,
  manager: 2,
  hr: 2,
  user: 1,
}

/**
 * Bepaalt of een gebruiker met `userRole` toegang heeft tot iets dat
 * `minimumRole` vereist. Onbekende/ontbrekende rollen krijgen geen toegang.
 */
export function hasAccess(userRole, minimumRole) {
  const userLevel = ROLE_HIERARCHY[userRole] ?? 0
  const requiredLevel = ROLE_HIERARCHY[minimumRole] ?? Infinity
  return userLevel >= requiredLevel
}

/**
 * Bepaalt of `profile` toegang heeft tot `tool`. Is `restricted_to_tool`
 * gezet op het profiel, dan mag het profiel UITSLUITEND die ene tool zien,
 * ongeacht `role` — overschrijft de normale rol-ladder volledig.
 *
 * `context.callInsightsLive` is de waarde van
 * `call_insights_instellingen.live_voor_consultants` (zie
 * useCallInsightsLive() in callInsightsApi.js) — alleen relevant voor de
 * call-insights-tool hieronder. Ontbreekt die context (nog niet geladen)?
 * Dan is de veilige default `false`, dus de tool blijft verborgen totdat de
 * instelling daadwerkelijk is opgehaald.
 */
export function canAccessTool(profile, tool, context = {}) {
  if (profile?.restricted_to_tool) {
    return profile.restricted_to_tool === tool.id
  }
  if (tool.id === 'call-insights') {
    return profile?.role === 'admin' || (profile?.team === 'consultant' && !!context.callInsightsLive)
  }
  return hasAccess(profile?.role, tool.minimumRole)
}

const ROLE_LABELS = {
  admin: 'Admin',
  manager: 'Manager',
  hr: 'HR',
  user: 'Gebruiker',
}

/** Leesbare rol-naam voor weergave in de UI (Dashboard, Mijn account). */
export function roleLabel(role) {
  return ROLE_LABELS[role] ?? role
}
