// Eigen telefoonnummer->kandidaat-index (zie bullhorn_candidate_phone_index
// in schema.sql voor de volledige uitleg waarom): Bullhorn's search/Candidate
// blijkt telefoonvelden exact-match (geen wildcards) te indexeren, en de
// opgeslagen waarden zijn zelf rommelig (bv. spaties tussen elk cijfer) — een
// live substring-zoekopdracht per gesprek werkt daardoor niet. In plaats
// daarvan wordt deze tabel periodiek volledig herbouwd vanuit een paginated
// bulk-fetch, en matcht call-insights lokaal tegen deze tabel.
//
// BELANGRIJK: `mobile` (Bullhorn-label "Telefoon" — het hoofdtelefoonnummer)
// hoort hier nadrukkelijk bij. Een eerdere versie miste dit veld: de meta-
// verkenning zocht toen op "phone" als substring van de INTERNE veldnaam,
// en "mobile" bevat die substring niet — ondanks dat het label wél
// "Telefoon" is. `phone`/`phone2`/`phone3`/`workPhone` zijn secundaire
// velden (labels "Telefoon2"/"Telefoon werk" etc.) die veel minder gebruikt
// blijken te worden.
import { bullhornGet, normaliseerTelefoonnummer, type BullhornSession } from './bullhorn.ts'

const PAGINA_GROOTTE = 500
const PHONE_VELDEN = ['mobile', 'phone', 'phone2', 'phone3', 'workPhone'] as const

interface CandidateTelefoonRij {
  id: number
  mobile?: string | null
  phone?: string | null
  phone2?: string | null
  phone3?: string | null
  workPhone?: string | null
}

/**
 * Bouwt bullhorn_candidate_phone_index volledig opnieuw op. Wordt periodiek
 * (dagelijkse cron) aangeroepen, niet bij elke syncNewCalls-tick — kandidaat-
 * telefoonnummers wijzigen niet elke 15 minuten.
 */
export async function refreshPhoneIndex(
  // deno-lint-ignore no-explicit-any
  admin: any,
  session: BullhornSession,
): Promise<{ kandidatenGescand: number; nummersGeindexeerd: number }> {
  let huidigeSessie = session
  let start = 0
  let kandidatenGescand = 0
  let nummersGeindexeerd = 0
  // Gededupliceerd op (normalized_phone, bullhorn_candidate_id) - dezelfde
  // kandidaat kan hetzelfde nummer in meerdere velden hebben staan
  // (phone/phone2/phone3/workPhone), en Postgres' ON CONFLICT DO UPDATE
  // crasht als hetzelfde conflict-doel twee keer in één upsert voorkomt.
  const rijenPerSleutel = new Map<string, { normalized_phone: string; bullhorn_candidate_id: number }>()

  for (;;) {
    const { data, session: newSession } = await bullhornGet(admin, huidigeSessie, 'search/Candidate', {
      // Zelfde QHSSE-filter als BH_QUERY_FILTER in kandidaat-ranker's
      // sync_candidates.py — dit Bullhorn-instance bevat ook kandidaten
      // buiten QHSSE, die horen niet in onze matching-index (voorkomt
      // zowel onnodige data als matches met kandidaten buiten scope).
      query: 'isDeleted:false AND customText31:"QHSSE"',
      fields: 'id,mobile,phone,phone2,phone3,workPhone',
      sort: 'id',
      start: String(start),
      count: String(PAGINA_GROOTTE),
    })
    huidigeSessie = newSession
    const rows = ((data as { data?: CandidateTelefoonRij[] })?.data ?? [])
    if (rows.length === 0) break

    for (const kandidaat of rows) {
      kandidatenGescand++
      for (const veld of PHONE_VELDEN) {
        const ruw = kandidaat[veld]
        if (!ruw) continue
        const genormaliseerd = normaliseerTelefoonnummer(ruw)
        if (!genormaliseerd) continue
        rijenPerSleutel.set(`${genormaliseerd}|${kandidaat.id}`, { normalized_phone: genormaliseerd, bullhorn_candidate_id: kandidaat.id })
      }
    }

    start += rows.length
    const total = (data as { total?: number })?.total ?? 0
    if (start >= total) break
  }

  const nieuweRijen = [...rijenPerSleutel.values()]

  // Eerst leegmaken, dan in batches opnieuw vullen — simpeler dan een diff,
  // en dit draait maar 1x/dag op een tabel die alleen door deze functie
  // gelezen/geschreven wordt (geen concurrency-risico met een lezende UI).
  await admin.from('bullhorn_candidate_phone_index').delete().neq('normalized_phone', '')

  const BATCH = 1000
  for (let i = 0; i < nieuweRijen.length; i += BATCH) {
    const batch = nieuweRijen.slice(i, i + BATCH)
    const { error } = await admin.from('bullhorn_candidate_phone_index').upsert(batch, { onConflict: 'normalized_phone,bullhorn_candidate_id' })
    if (error) throw new Error(`Wegschrijven telefoon-index mislukt: ${error.message}`)
    nummersGeindexeerd += batch.length
  }

  return { kandidatenGescand, nummersGeindexeerd }
}

export interface TelefoonMatch {
  candidateId: number | null
  /** Alleen gevuld bij >1 treffer — de consultant kiest dan zelf de juiste (zie resolveCandidateMatch in index.ts). */
  ambigueKandidaatIds: number[] | null
}

/**
 * Zoekt een kandidaat op via de lokale index. Bij precies één treffer:
 * die kandidaat. Bij geen treffer: allebei null. Bij meerdere treffers:
 * `candidateId` blijft null, maar `ambigueKandidaatIds` bevat de volledige
 * lijst — i.p.v. te gokken (of stilzwijgend over te slaan) laat de UI de
 * consultant zelf kiezen.
 */
export async function zoekKandidaatViaIndex(
  // deno-lint-ignore no-explicit-any
  admin: any,
  laatste9Cijfers: string,
): Promise<TelefoonMatch> {
  const { data, error } = await admin
    .from('bullhorn_candidate_phone_index')
    .select('bullhorn_candidate_id')
    .eq('normalized_phone', laatste9Cijfers)
  if (error || !data || data.length === 0) return { candidateId: null, ambigueKandidaatIds: null }
  const uniekeIds = [...new Set(data.map((r: { bullhorn_candidate_id: number }) => r.bullhorn_candidate_id))] as number[]
  if (uniekeIds.length === 1) return { candidateId: uniekeIds[0], ambigueKandidaatIds: null }
  return { candidateId: null, ambigueKandidaatIds: uniekeIds }
}
