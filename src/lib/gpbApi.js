import { supabase } from './supabaseClient'

/**
 * Haalt de beoordelingen op die voor de ingelogde gebruiker relevant zijn:
 * RLS regelt vanzelf wat er terugkomt — als medewerker je eigen rij(en), als
 * leidinggevende je toegewezen team, als hr/admin alles. De aanroeper splitst
 * zelf op basis van medewerker_id/leidinggevende_id welke rij bij welke rol
 * hoort (zie GpbBeoordelingstool.jsx).
 *
 * Leest bewust van gpb_beoordelingen_view i.p.v. de tabel zelf: die view
 * verbergt leidinggevende_antwoorden voor de medewerker zelf zolang status
 * 'concept' is (nog geen HR-goedkeuring) — RLS is alleen rij-niveau, dus
 * zonder deze view zou de medewerker die kolom gewoon in de ruwe response
 * krijgen zodra de leidinggevende heeft ingevuld.
 */
export async function fetchMijnGpb() {
  const { data, error } = await supabase
    .from('gpb_beoordelingen_view')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(error.message)
  }

  return data
}

export async function fetchDoelen(beoordelingId) {
  const { data, error } = await supabase
    .from('gpb_doelen')
    .select('*')
    .eq('beoordeling_id', beoordelingId)
    .order('pijler')

  if (error) {
    throw new Error(error.message)
  }

  return data
}

export async function createGpbBeoordeling({ medewerkerId, medewerkerNaam, leidinggevendeId, afdeling, functieniveau, periode }) {
  const { data, error } = await supabase.rpc('create_gpb_beoordeling', {
    p_medewerker_id: medewerkerId,
    p_medewerker_naam: medewerkerNaam,
    p_leidinggevende_id: leidinggevendeId,
    p_afdeling: afdeling,
    p_functieniveau: functieniveau,
    p_periode: periode,
  })

  if (error) {
    throw new Error(error.message)
  }

  return data
}

/** Alleen HR/admin (afgedwongen via RLS) — verwijdert ook de gekoppelde doelen (cascade). */
export async function deleteGpbBeoordeling(beoordelingId) {
  const { error } = await supabase.from('gpb_beoordelingen').delete().eq('id', beoordelingId)

  if (error) {
    throw new Error(error.message)
  }
}

export async function submitGpbMedewerker(beoordelingId, antwoorden, doelen) {
  const { error } = await supabase.rpc('submit_gpb_medewerker', {
    p_beoordeling_id: beoordelingId,
    p_antwoorden: antwoorden,
    p_doelen: doelen,
  })

  if (error) {
    throw new Error(error.message)
  }
}

export async function submitGpbLeidinggevende(beoordelingId, antwoorden) {
  const { error } = await supabase.rpc('submit_gpb_leidinggevende', {
    p_beoordeling_id: beoordelingId,
    p_antwoorden: antwoorden,
  })

  if (error) {
    throw new Error(error.message)
  }
}

export async function keurGpbGoed(beoordelingId) {
  const { error } = await supabase.rpc('keur_gpb_goed', { p_beoordeling_id: beoordelingId })

  if (error) {
    throw new Error(error.message)
  }
}

export async function maakGpbDefinitief(beoordelingId) {
  const { error } = await supabase.rpc('maak_gpb_definitief', { p_beoordeling_id: beoordelingId })

  if (error) {
    throw new Error(error.message)
  }
}

/**
 * Aantal openstaande acties voor de ingelogde gebruiker — gebruikt voor het
 * teller-badge op de dashboard-tegel, en voor de "Team"-tabtelling in de
 * tool zelf. Zelfde rolverdeling als GpbBeoordelingstool.jsx: hr/admin telt
 * concept-beoordelingen die klaarstaan voor goedkeuring, iedereen anders
 * telt zijn eigen nog-in-te-vullen zelfevaluatie + toegewezen teamleden waar
 * hij/zij als leidinggevende nog niet heeft ingevuld. Medewerker en
 * leidinggevende vullen onafhankelijk van elkaar in (zie
 * submit_gpb_leidinggevende), dus dat laatste telt mee ongeacht of de
 * medewerker zelf al heeft ingevuld.
 */
export function telOpenstaandeGpbActies(beoordelingen, userId, role) {
  if (role === 'hr' || role === 'admin') {
    return beoordelingen.filter(
      (b) => b.status === 'concept' && b.medewerker_ingevuld_at && b.leidinggevende_ingevuld_at,
    ).length
  }

  let aantal = 0

  // .filter() i.p.v. .find(): een medewerker kan meerdere beoordelingen
  // hebben over verschillende periodes heen, niet alleen de meest recente.
  aantal += beoordelingen.filter(
    (b) => b.medewerker_id === userId && !b.medewerker_ingevuld_at,
  ).length

  aantal += beoordelingen.filter(
    (b) => b.leidinggevende_id === userId && !b.leidinggevende_ingevuld_at,
  ).length

  return aantal
}
