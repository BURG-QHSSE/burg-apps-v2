/**
 * Vaste lijsten en instellingen voor Mijn Omgeving, 1-op-1 overgenomen uit
 * de bron (`mijn-omgeving.html`) zodat bestaande data (sales_status,
 * nogo_reason) geldig blijft en de n8n-webhook blijft werken.
 */

// Volgorde exact zoals in de bron — nieuwe/onbekende bronnen komen achteraan.
export const SALES_STATUSES = [
  'On hold',
  'Nieuwe kans',
  'Toegevoegd aan Bullhorn',
  'Gemaild',
  'Lopend contact',
  'Hot',
  'Jobpull',
  'Closed won',
  'Closed loss',
]

export const NOGO_REASONS = [
  'Verkeerde sector',
  'Te operationeel',
  'Intermediair / uitzendbureau',
  'Te junior / stage',
  'Buiten werkgebied',
  'Dubbeling / al bekend',
  'Overig',
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
