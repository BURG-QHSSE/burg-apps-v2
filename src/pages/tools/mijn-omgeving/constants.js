/**
 * Vaste lijsten en instellingen voor Kansen Swiper, 1-op-1 overgenomen uit
 * de bron (`mijn-omgeving.html`) zodat bestaande data (sales_status,
 * nogo_reason) geldig blijft en de n8n-webhook blijft werken.
 */

// Bewust beperkt tot deze 2 (afwijkend van v1): bestaande vacatures met een
// andere sales_status (bv. 'Hot') behouden die waarde in de database, maar
// die optie is hier niet meer kiesbaar.
export const SALES_STATUSES = ['Toegevoegd aan Bullhorn', 'Al bekend']

// Elke reden is een { label, info } object — info is een optionele toelichting
// die als tooltip bij een ⓘ-icoontje verschijnt (zie NogoReasonPopup). Het
// opgeslagen nogo_reason blijft gewoon de label-tekst, dus bestaande rijen
// met een oudere labelnaam (bv. "Intermediair / uitzendbureau") blijven
// geldig — die optie is alleen niet meer kiesbaar.
export const NOGO_REASONS = [
  { label: 'Verkeerde sector', info: 'Bijvoorbeeld Finance' },
  { label: 'Buiten werkgebied', info: 'Geografisch niet ons werkgebied' },
  { label: 'Concurrent' },
  { label: 'Te junior / stage' },
  { label: 'Al bekend' },
  { label: 'Overig' },
  { label: 'Voor nu nog niet relevant', info: 'Bijvoorbeeld Cyber Security, Overheden' },
]

// Webhook die Apollo-enrichment triggert na een Go-beslissing (zie
// Workflow 2 "Apollo Enrichment" in de project-CLAUDE.md).
export const GO_WEBHOOK_URL = 'https://mvl1009.app.n8n.cloud/webhook/d9c398f5-d635-4fd2-b4ce-231b3bc087fe'

// Sorteervolgorde van de swipe-wachtrij, exact zoals in de bron.
// Onbekende/lege bronnen krijgen impliciet 99 (zie SwipenTab) en komen laatst.
export const SOURCE_ORDER = {
  linkedin: 0,
  bedrijfswebsite: 1,
  indeed: 2,
  'werkzoeken.nl': 3,
}
