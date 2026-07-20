/**
 * Gedeelde constanten/helpers voor de Doorgroei Tracker — databron is geen
 * Supabase-tabel maar een publiek, read-only Google Apps Script endpoint dat
 * een losstaande Google Sheet bedient (zie DoorgroeiTracker.jsx). Er is geen
 * schrijf-pad terug naar die Sheet vanuit deze app.
 */

export const DOORGROEI_DATA_URL =
  'https://script.google.com/macros/s/AKfycbzIicChs1q6DlRUyW-JHFm9lZHyBynl_zyAf8tczD85MJmnAHQT_LNzdkgoWZ29_IkWnQ/exec'

export const DOORGROEI_SHEET_URL =
  'https://docs.google.com/spreadsheets/d/14Q0_f7PT5kiBPD9mSidB39UJiAotzPf_CtTN2HkaA6Y/edit?gid=511344202#gid=511344202'

export function normalizeNaam(naam) {
  // String(...) i.p.v. aannemen dat naam al tekst is — een kolomverschuiving
  // in de bron-Sheet kan hier een getal leveren, en .trim() bestaat niet op
  // number.
  return String(naam ?? '').trim().toLowerCase()
}

/** Genormaliseerde namen uit de roster-tab van de Doorgroei Tracker sheet. */
export async function fetchDoorgroeiRosterNamen() {
  const res = await fetch(DOORGROEI_DATA_URL)
  if (!res.ok) throw new Error(`Server antwoordde met status ${res.status}`)

  const json = await res.json()
  const roster = Array.isArray(json.roster) ? json.roster : []
  return new Set(roster.map((entry) => normalizeNaam(entry.naam)).filter(Boolean))
}
