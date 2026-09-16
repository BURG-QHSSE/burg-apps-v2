// Claude-extractie van Bullhorn-veldwijzigingen uit een 3CX-gesprekssamen-
// vatting. Draaide eerst op Haiku 4.5 (goedkoper), maar bleek bij status/
// voorkeur-dienstverband herhaaldelijk categorische uitsluitingsregels te
// negeren zodra er een opvallend detail in de tekst stond (een concreet
// bedrag, emotioneel geladen taal) — bv. DNC voorstellen bij het afwijzen
// van één vacature, of "staat open voor" (expliciet uitgesloten twijfeltaal)
// toch als wijziging lezen. Empirisch getest: Sonnet 5 hield deze regels wél
// consistent aan op dezelfde testgevallen. Prijsverschil bij onze volumes
// verwaarloosbaar (~$3-5/maand bij volledige uitrol i.p.v. ~$1,50-2,50) —
// zie sessie-overleg voor het volledige kostenplaatje.
//
// Prompt-caching (2026-09-16, bij het openzetten naar alle consultants): de
// systeemprompt (SYSTEEM_PROMPT) is 100% statisch, ongeacht consultant/
// kandidaat/gesprek — een ideale caching-kandidaat, alleen het korte
// user-bericht per gesprek varieert. syncNewCalls verwerkt gesprekken al
// sequentieel (index.ts), dus geen aparte prewarm-stap nodig zoals bij
// kandidaat-matcher (die wél parallel scoort): de eerste aanroep binnen een
// uur schrijft de cache vanzelf, elke volgende leest 'm goedkoop terug.
const CLAUDE_MODEL = 'claude-sonnet-5'
const CLAUDE_MAX_TOKENS = 500
const CLAUDE_TIMEOUT_MS = 30_000

// Sonnet 5-tarieven per token. cacheWrite/cacheRead: standaard Anthropic-
// verhoudingen (~1.25x resp. ~0.1x het basis-inputtarief), zelfde als
// kandidaat-matcher/claude.ts.
const PRIJS_PER_TOKEN_USD = {
  input: 2.0 / 1_000_000,
  output: 10.0 / 1_000_000,
  cacheWrite: 2.5 / 1_000_000,
  cacheRead: 0.2 / 1_000_000,
}

async function fetchMetTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

function claudeHeaders(): Record<string, string> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY secret ontbreekt')
  return { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }
}

function stripMarkdownCodeblock(tekst: string): string {
  let t = tekst.trim()
  if (t.startsWith('```')) {
    const newline = t.indexOf('\n')
    t = newline >= 0 ? t.slice(newline + 1) : t.slice(3)
  }
  if (t.endsWith('```')) {
    t = t.slice(0, -3).trimEnd()
  }
  return t
}

// Exacte Bullhorn-veldnamen + hun toegestane picklist-opties, live
// geverifieerd via meta/Candidate (zie project-onderzoek in dit gesprek).
// 'address' heeft bewust geen opties (vrije tekst, en we vragen alleen de
// plaatsnaam — zie index.ts voor waarom nooit een postcode gefabriceerd
// wordt: NL-postcodes zijn straat-niveau, een "generieke" postcode per
// plaatsnaam zou voor de meeste straten in die plaats gewoon fout zijn).
export const VELD_DEFINITIES: Record<string, { label: string; opties: string[] | null }> = {
  customText22: {
    label: 'Salaris range (maandsalaris)',
    opties: [
      '< 2000 EUR', '2000 - 2500 EUR', '2500 - 3000 EUR', '3000 - 3500 EUR', '3500 - 4000 EUR',
      '4000 - 4500 EUR', '4500 - 5000 EUR', '5000 - 6000 EUR', '6000 - 7000 EUR', '7000 - 8000 EUR',
      '8000 - 9000 EUR', 'EUR 9000 >', 'Onbekend', 'Geen/betreft ZZP',
    ],
  },
  customText11: {
    label: 'Uurtarief range (ZZP/interim)',
    opties: [
      'Geen/betreft loondienst', '< 70', '70 - 80', '80 - 90', '90 - 100', '100 - 110', '110 - 120', '120 - 140', '140 of meer',
    ],
  },
  address: { label: 'Woonplaats', opties: null },
  // "Loondienst, Interim" is een derde, samengestelde optie: dit veld is in
  // Bullhorn een echt multi-select (een kandidaat kan voor beide open
  // staan), zie bullhorn.ts/index.ts voor de array<->string-normalisatie.
  employmentPreference: { label: 'Voorkeur dienstverband gewenst', opties: ['Loondienst', 'Interim', 'Loondienst, Interim'] },
  status: {
    label: 'Status',
    opties: ['OTW', 'Placeable', 'Door ons geplaatst', 'Geen specialist', 'DNC', 'New Lead'],
  },
}

function bouwSysteemPrompt(): string {
  const veldenTekst = Object.entries(VELD_DEFINITIES)
    .map(([naam, def]) => {
      const optiesTekst = def.opties ? ` — toegestane waarden: ${def.opties.map((o) => `"${o}"`).join(', ')}` : ' — vrije tekst (alleen plaatsnaam)'
      return `- ${naam} (${def.label})${optiesTekst}`
    })
    .join('\n')

  return (
    'Je analyseert de samenvatting van een telefoongesprek tussen een recruitment-consultant en een kandidaat. ' +
    'Je taak: detecteer of de kandidaat expliciet een van de volgende 5 Bullhorn-velden heeft genoemd als ' +
    'GEWIJZIGD (niet alleen bevestigd/hetzelfde gebleven) ten opzichte van de huidige waarde die je meekrijgt.\n\n' +
    `Velden:\n${veldenTekst}\n\n` +
    'ALGEMENE REGELS (gelden voor ALLE velden hieronder, niet alleen adres):\n' +
    '- Alleen een suggestie teruggeven als de samenvatting een DUIDELIJKE, EXPLICIETE, AL DOORGEVOERDE wijziging ' +
    'noemt — nooit raden of afleiden uit vage aanwijzingen. Twijfel je? Dan GEEN suggestie — een gemiste ' +
    'wijziging is veel minder erg dan een verkeerde aanpassing in Bullhorn.\n' +
    '- Twijfelende/hypothetische taal telt NOOIT als wijziging, voor geen enkel veld: "overweegt", "denkt na ' +
    'over", "staat open voor", "misschien", "zou eventueel willen" zijn GEEN reden voor een suggestie — alleen ' +
    'een reeds gebeurde of stellig aangekondigde wijziging ("ben verhuisd naar", "verdien nu", "werk sinds ' +
    'vorige maand als", "ik ga per 1 januari...") telt wel.\n' +
    '- ATTRIBUTIE-CHECK: vraag jezelf bij elk veld af "over WIE/WAT gaat deze waarde precies?" Een waarde die over ' +
    'de VACATURE, WERKGEVER, KLANT, OPDRACHT of functie gaat (bv. het aangeboden salaris, de vereiste ' +
    'contractvorm, de werklocatie van de baan) telt NOOIT mee, ook niet als het de enige concrete waarde in de ' +
    'samenvatting is. Het moet expliciet gaan over de kandidaat zelf, zijn/haar eigen situatie.\n' +
    '- Voor velden met toegestane waarden: kies altijd exact één van de gegeven opties, nooit een eigen ' +
    'formulering. Kies de best passende range/optie als een concreet bedrag genoemd wordt.\n' +
    '- Als de nieuwe waarde al gelijk is aan de huidige waarde (of een voor de hand liggende schrijf-/' +
    'transcriptievariant daarvan, bv. "Venendaal" i.p.v. "Veenendaal") is dat GEEN wijziging — negeer het, ook ' +
    'al lijkt de tekst anders.\n\n' +
    'VELD-SPECIFIEKE REGELS:\n' +
    '- "address" (woonplaats): trigger UITSLUITEND bij taal over de EIGEN woonplaats van de kandidaat ("ik woon ' +
    'in", "ben verhuisd naar", "mijn adres is nu"). Een reisafstand/forenzen-vermelding ("X min. vanuit Y", "te ' +
    'ver vanuit Y") is GEEN aankondiging van een verhuizing, alleen context — sla dat over.\n' +
    '- "customText22" (salaris range) is een MAANDSALARIS. Als de kandidaat een JAARSALARIS noemt (bv. "90k", ' +
    '"90.000 euro bruto per jaar", of een kaal bedrag boven de ~20.000 zonder "per maand" erbij — dat is in het ' +
    'Nederlands vrijwel altijd een jaarbedrag), moet je dat EERST exact door 12 delen voordat je een range kiest. ' +
    'Reken dit precies uit, schat niet op gevoel: 90.000 / 12 = 7.500 -> "7000 - 8000 EUR" (NIET "8000 - 9000 ' +
    'EUR" — dat zou fout zijn). "customText11" (uurtarief) heeft deze omrekening niet nodig, dat is al een ' +
    'uurbedrag.\n' +
    '- "customText22" wordt ALTIJD op basis van een 40-urige werkweek ingevuld. Noemt de kandidaat een bedrag bij ' +
    'een AFWIJKEND aantal uren (bv. "3500 euro op basis van 32 uur"), reken dat EERST exact door naar 40 uur ' +
    'voordat je (eventueel na de jaar->maand-omrekening hierboven) een range kiest: bedrag × (40 / genoemde uren). ' +
    'Voorbeeld: 3500 bij 32 uur -> 3500 × (40/32) = 4375 -> "4000 - 4500 EUR" (NIET "3500 - 4000 EUR" — dat is het ' +
    'ongecorrigeerde 32-uurbedrag). Wordt er geen afwijkend aantal uren genoemd, ga dan uit van 40 uur (geen ' +
    'omrekening nodig).\n' +
    '- "customText22"/"customText11": alleen het bedrag dat de KANDIDAAT zelf als zijn eigen huidige of gewenste ' +
    'salaris/tarief noemt. Een bedrag dat een vacature/opdracht biedt, of dat de consultant voorstelt, telt niet ' +
    'mee — alleen wat de kandidaat over zichzelf zegt. De ranges zijn inclusief aan de ONDERKANT en exclusief aan ' +
    'de bovenkant: een (eventueel al omgerekend) bedrag dat precies op een grens ligt hoort bij de range die ' +
    'ERMEE BEGINT, niet de range die ermee eindigt (bv. exact 5000 euro -> "5000 - 6000 EUR", NIET "4500 - 5000 ' +
    'EUR"; exact 100 euro/uur -> "100 - 110", NIET "90 - 100").\n' +
    '- "employmentPreference" (voorkeur dienstverband): alleen de EIGEN voorkeur van de kandidaat, nooit wat een ' +
    'vacature vereist. Dit veld ondersteunt BEIDE waarden tegelijk — als de kandidaat stellig aangeeft dat hij/zij ' +
    'BEIDE vormen doet of accepteert (bv. "werkt nu zowel in loondienst als als interim", "doet sinds kort ook ' +
    'interim-opdrachten naast zijn vaste baan", "accepteert beide"), gebruik dan de samengestelde waarde ' +
    '"Loondienst, Interim". Let op: dit is een aparte, stellige uitspraak over wat de kandidaat DAADWERKELIJK ' +
    'DOET/ACCEPTEERT — niet hetzelfde als de twijfelende taal uit de algemene regels hierboven (die blijft ' +
    'sowieso uitgesloten, voor dit veld net zo goed als voor elk ander veld).\n' +
    '- "status": de meeste gesprekken geven GEEN reden voor een statuswijziging — dit veld moet je het minst ' +
    'snel voorstellen.\n' +
    '  * BELANGRIJKSTE REGEL: het afwijzen van, niet doorkomen bij, of geen interesse hebben in ÉÉN specifieke ' +
    'vacature/rol is OP ZICHZELF NOOIT genoeg voor een statuswijziging, ongeacht welke status er nu al staat en ' +
    'ongeacht welke kant je op zou willen wijzigen (dus ook niet OTW->Placeable, of Door ons geplaatst-' +
    '>Placeable). Dit geldt voor bijna elk "geen match"/"gesprek eindigt zonder vervolg"/"niet uitgenodigd voor ' +
    'volgende ronde"-gesprek — dat is normaal recruitmentverkeer, geen statuswijziging. Alleen een uitspraak over ' +
    'de ALGEHELE zoeksituatie van de kandidaat (niet gekoppeld aan één specifieke vacature) telt wel, bv. "ik ben ' +
    'weer actief op zoek" of "ik zoek nu niet meer, ben tevreden waar ik zit".\n' +
    '  * "OTW": kandidaat geeft aan algeheel actief op zoek te zijn naar een andere baan (ongeacht of hij/zij al ' +
    'in een sollicitatieproces zit) — niet omdat één vacature wordt besproken, maar omdat de kandidaat dat over ' +
    'zijn/haar situatie in het algemeen zegt.\n' +
    '  * "Placeable": neutrale standaardstatus. Gebruik dit NIET als reactie op één afgewezen vacature (zie ' +
    'bovenaan) — alleen als de kandidaat aangeeft algeheel niet actief te zoeken.\n' +
    '  * "Door ons geplaatst": kandidaat is expliciet succesvol geplaatst/aangenomen via BURG.\n' +
    '  * "Geen specialist": UITSLUITEND wanneer blijkt dat de kandidaat vakinhoudelijk geen QHSSE-specialist ' +
    'is/was — nooit in het vakgebied gewerkt, of is er inmiddels helemaal niet meer werkzaam. NOOIT gebruiken ' +
    'voor een salaris-mismatch, locatie, of een andere reden waarom een specifieke match niet doorging.\n' +
    '  * "DNC": UITSLUITEND bij een EXPLICIET verzoek van de kandidaat om niet meer benaderd/gecontacteerd te ' +
    'worden (bv. "bel me niet meer", "ik wil niet meer benaderd worden").\n' +
    '  * "New Lead": wordt in de praktijk vrijwel nooit gebruikt — stel dit zo goed als nooit voor. Twijfel je ' +
    'tussen "New Lead" en "Placeable"? Kies dan "Placeable".\n\n' +
    'Geen enkele wijziging gevonden? Geef een lege array terug: []\n\n' +
    'Geef uitsluitend een JSON-array terug, zonder tekst daarbuiten, in dit exacte formaat:\n' +
    '[{"field": "<veldnaam>", "suggested_value": "<nieuwe waarde>", "quote": "<kort citaat uit de samenvatting als onderbouwing>"}]'
  )
}

const SYSTEEM_PROMPT = bouwSysteemPrompt()

export interface VeldSuggestie {
  field: string
  suggested_value: string
  quote: string
}

interface HuidigeVelden {
  customText22: string | null
  customText11: string | null
  city: string | null
  employmentPreference: string | null
  status: string | null
}

export interface DetectieResultaat {
  suggesties: VeldSuggestie[]
  kostenUsd: number
}

/**
 * Detecteert veldwijzigingen in een gesprekssamenvatting. Bij een parse- of
 * API-fout: lege array (geen suggestie is veiliger dan een gok), nooit
 * crashen — één mislukte extractie mag de rest van een sync-batch niet
 * blokkeren. kostenUsd wordt ook bij een lege/mislukte extractie zo goed
 * mogelijk teruggegeven (0 als de aanroep zelf al mislukte, anders de
 * werkelijke usage) — de aanroeper (index.ts) telt dit op bij het
 * dagelijkse kostenplafond, ongeacht of er suggesties uitkwamen.
 */
export async function detecteerVeldwijzigingen(summary: string, huidigeVelden: HuidigeVelden): Promise<DetectieResultaat> {
  const huidigeVeldenTekst = [
    `customText22 (Salaris range): ${huidigeVelden.customText22 ?? 'onbekend'}`,
    `customText11 (Uurtarief range): ${huidigeVelden.customText11 ?? 'onbekend'}`,
    `address (huidige plaatsnaam): ${huidigeVelden.city ?? 'onbekend'}`,
    `employmentPreference: ${huidigeVelden.employmentPreference ?? 'onbekend'}`,
    `status: ${huidigeVelden.status ?? 'onbekend'}`,
  ].join('\n')

  let response: Response
  try {
    response = await fetchMetTimeout(
      'https://api.anthropic.com/v1/messages',
      {
        method: 'POST',
        headers: claudeHeaders(),
        body: JSON.stringify({
          model: CLAUDE_MODEL,
          max_tokens: CLAUDE_MAX_TOKENS,
          // Sonnet 5 draait adaptive thinking AAN als je thinking weglaat
          // (anders dan Haiku 4.5) — voor deze simpele classificatie-taak
          // niet nodig, en zonder dit stond het thinking-blok als
          // content[0], waardoor de code hieronder (die content[0].text
          // pakte) altijd een lege string las. Expliciet uitzetten i.p.v.
          // alleen de parsing robuuster maken, om ook de tokens/latency van
          // ongebruikt redeneren te besparen.
          thinking: { type: 'disabled' },
          // cache_control i.p.v. een platte string: SYSTEEM_PROMPT verandert
          // nooit, zie de uitleg bovenaan dit bestand.
          system: [{ type: 'text', text: SYSTEEM_PROMPT, cache_control: { type: 'ephemeral', ttl: '1h' } }],
          messages: [
            {
              role: 'user',
              content: `HUIDIGE WAARDEN IN BULLHORN:\n${huidigeVeldenTekst}\n\nGESPREKSSAMENVATTING:\n${summary}`,
            },
          ],
        }),
      },
      CLAUDE_TIMEOUT_MS,
    )
  } catch (err) {
    console.error('[call-insights] Claude-aanroep gaf een netwerkfout:', err)
    return { suggesties: [], kostenUsd: 0 }
  }

  if (!response.ok) {
    console.error(`[call-insights] Claude-aanroep mislukt: ${response.status} ${await response.text()}`)
    return { suggesties: [], kostenUsd: 0 }
  }

  const data = await response.json()
  const kostenUsd = schatKostenUsd(data?.usage)
  // Zoek het eerste blok van type "text" i.p.v. blindelings content[0] te
  // pakken — bij thinking-modellen (of andere toekomstige blok-types) staat
  // tekst niet per se op index 0.
  // deno-lint-ignore no-explicit-any
  const tekstBlok = (data?.content as any[] | undefined)?.find((blok) => blok?.type === 'text')
  const raw: string = tekstBlok?.text?.trim() ?? ''
  const tekst = stripMarkdownCodeblock(raw)
  const start = tekst.indexOf('[')
  if (start < 0) {
    console.error(`[call-insights] Geen JSON-array in Claude-response: ${raw.slice(0, 300)}`)
    return { suggesties: [], kostenUsd }
  }

  try {
    const parsed = JSON.parse(tekst.slice(start))
    if (!Array.isArray(parsed)) return { suggesties: [], kostenUsd }
    const suggesties = parsed
      .filter((item) => item && typeof item.field === 'string' && Object.keys(VELD_DEFINITIES).includes(item.field) && item.suggested_value)
      .map((item) => ({
        field: String(item.field),
        suggested_value: String(item.suggested_value),
        quote: String(item.quote ?? ''),
      }))
    return { suggesties, kostenUsd }
  } catch (err) {
    console.error(`[call-insights] JSON-parsefout in Claude-response: ${raw.slice(0, 300)}`, err)
    return { suggesties: [], kostenUsd }
  }
}

function schatKostenUsd(usage: {
  input_tokens?: number
  output_tokens?: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
} | undefined): number {
  if (!usage) return 0
  return (
    (usage.input_tokens ?? 0) * PRIJS_PER_TOKEN_USD.input +
    (usage.output_tokens ?? 0) * PRIJS_PER_TOKEN_USD.output +
    (usage.cache_creation_input_tokens ?? 0) * PRIJS_PER_TOKEN_USD.cacheWrite +
    (usage.cache_read_input_tokens ?? 0) * PRIJS_PER_TOKEN_USD.cacheRead
  )
}
