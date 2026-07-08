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
  { id: 'doorgroei-tracker', naam: 'Doorgroei Tracker', minimumRole: 'user', path: '/tools/doorgroei-tracker', category: 'groei' },
]

/**
 * Labels voor de categorie-secties op het dashboard. Volgorde hier bepaalt
 * de weergavevolgorde van de secties.
 */
export const TOOL_CATEGORIES = [
  { id: 'daily', label: 'Tools' },
  { id: 'groei', label: 'Persoonlijke groei' },
]

/**
 * Hoe hoger het getal, hoe meer rechten. Moet in lijn blijven met het
 * `user_role` enum in supabase/schema.sql ('admin', 'manager', 'user').
 */
const ROLE_HIERARCHY = {
  admin: 3,
  manager: 2,
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
