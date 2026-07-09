/**
 * Vaste structuur uit GPB-Principes.md: 6 pijlers, elk met 3 stellingen,
 * afgestemd per afdeling en functieniveau. Elke stelling is een { tekst,
 * voorbeeld } object: tekst is de hoofdstelling, voorbeeld de cursieve
 * toelichting/verduidelijking eronder.
 *
 * Voor Corporate is 'functieniveau' geen carrièreniveau maar een selector
 * voor de drie afzonderlijke functies binnen het team (Finance, HR-Corporate
 * Recruitment Officer, Marketing & AI Officer) — zie GPB_corporate.md.
 */
export const PIJLERS = [
  'Organisatie & internationale schaalbaarheid',
  'Mensen, leiderschap & cultuur',
  'Vakmanschap, processen & kwaliteit',
  'Automatisering, efficiëntie & werkplezier',
  'Marktspecialisatie & reputatie',
  'Financiële stabiliteit & verantwoorde groei',
]

export const AFDELINGEN = ['Sales', 'Recruitment', 'Corporate']

export const NIVEAUS = {
  Sales: [
    { niveau: 1, titel: 'Associate Sales Consultant', tagline: 'Ik leer' },
    { niveau: 2, titel: 'Sales Consultant', tagline: 'Ik presteer' },
    { niveau: 3, titel: 'Senior Sales Consultant', tagline: 'Top performer' },
  ],
  Recruitment: [
    { niveau: 1, titel: 'Associate Recruitment Consultant', tagline: 'Ik leer' },
    { niveau: 2, titel: 'Recruitment Consultant', tagline: 'Ik presteer' },
    { niveau: 3, titel: 'Senior Recruitment Consultant', tagline: 'Top performer' },
  ],
  Corporate: [
    { niveau: 1, titel: 'Finance Medewerker', tagline: '' },
    { niveau: 2, titel: 'HR-Corporate Recruitment Officer', tagline: '' },
    { niveau: 3, titel: 'Marketing & AI Officer', tagline: '' },
  ],
}

/** Afdelingen waar 'functieniveau' een echt carrièreniveau is (i.p.v. een functie-selector zoals bij Corporate). */
const AFDELINGEN_MET_NIVEAUS = ['Sales', 'Recruitment']

/**
 * Leesbaar label voor een functieniveau: "Niveau X — Titel" voor afdelingen
 * met echte carrièreniveaus, en alleen "Titel" voor Corporate — daar zijn
 * het drie losse functies, geen niveaus.
 */
export function functieLabel(afdeling, functieniveau) {
  const niveau = NIVEAUS[afdeling]?.find((n) => n.niveau === functieniveau)
  if (!niveau) return `Niveau ${functieniveau}`
  return AFDELINGEN_MET_NIVEAUS.includes(afdeling) ? `Niveau ${niveau.niveau} — ${niveau.titel}` : niveau.titel
}

/** Bouwt de 6x3 stellingen-array uit platte [tekst, voorbeeld] paren, pijler na pijler. */
function bouwStellingen(...pijlerParen) {
  return pijlerParen.map((paren) => paren.map(([tekst, voorbeeld]) => ({ tekst, voorbeeld })))
}

/** STELLINGEN[afdeling][niveau] = array van 6 pijlers, elk een array van 3 { tekst, voorbeeld }. */
export const STELLINGEN = {
  Sales: {
    // 1 = Associate Sales Consultant — Ik leer
    1: bouwStellingen(
      [
        [
          'Ik log klantcontacten, kansen en opvolgingen correct en tijdig in Bullhorn.',
          "Mijn registraties zijn volledig, juist en actueel — profielen kloppen en taken staan klaar, zodat collega's er direct mee verder kunnen.",
        ],
        [
          'Ik voer mijn taken uit zoals afgesproken en vraag tijdig hulp wanneer iets niet lukt.',
          'Ik werk gestructureerd en betrouwbaar in mijn basistaken, én ik signaleer het zelf en vraag actief hulp zodra ik vastloop — ik blijf niet te lang zelf zoeken.',
        ],
        [
          "Ik houd mijn werk overzichtelijk en overdraagbaar voor collega's.",
          "Collega's kunnen mijn dossiers en lopende zaken zonder extra uitleg begrijpen en overnemen — de basis voor schaalbaar werken binnen het team.",
        ],
      ],
      [
        [
          "Ik stem mijn werkzaamheden actief af met collega's en draag bij aan een fijne samenwerking.",
          'Ik communiceer open, help collega\'s waar ik kan en draag bij aan een positieve sfeer binnen het team.',
        ],
        [
          'Ik sta open voor feedback en onderneem zichtbaar actie op verbeterpunten.',
          'Ik luister, stel vragen, en laat in mijn werk concreet zien dat ik feedback heb toegepast — niet alleen dat ik ze heb gehoord.',
        ],
        [
          'Ik werk actief aan mijn ontwikkeling via mijn POP en de begeleiding van mijn leidinggevende.',
          'Ik weet wat mijn leerdoelen zijn en onderneem concrete stappen richting het niveau van Sales Consultant.',
        ],
      ],
      [
        [
          'Ik beheers de basisvaardigheden van het salesproces: leads genereren, bellen, pitchen en opvolgen.',
          'Ik voer het acquisitieproces uit zoals geleerd en vraag actief om feedback op mijn aanpak.',
        ],
        [
          'Ik verdiep mijn kennis van de QHSSE-sector en pas dit toe in mijn gesprekken met klanten.',
          'Ik lees me in op de sector en kan de dienstenlijn van BURG QHSSE helder uitleggen aan een klant aan de telefoon.',
        ],
        [
          'Ik werk mee aan offertes en contracten en controleer mijn werk voordat ik het indien bij mijn leidinggevende.',
          'Mijn aanleveringen zijn correct en volledig; ik leer zichtbaar van correcties en maak dezelfde fout niet twee keer.',
        ],
      ],
      [
        [
          'Ik gebruik Bullhorn en 3CX zoals uitgelegd, zodat mijn basisregistratie altijd op orde is.',
          'Ik benut sjablonen, herinneringen en koppelingen in de systemen om handmatig of dubbel werk te voorkomen.',
        ],
        [
          'Ik geef aan als ik iets niet begrijp in de systemen en vraag actief om uitleg.',
          'Ik wacht niet af bij onduidelijkheid in Bullhorn of 3CX, maar vraag gericht om uitleg bij een collega of leidinggevende.',
        ],
        [
          'Ik sta open voor het leren van nieuwe tools en werkwijzen.',
          'Ik pas me aan wanneer processen worden verbeterd en houd hierbij een positieve, leergierige houding.',
        ],
      ],
      [
        [
          'Ik benader potentiële klanten proactief via LinkedIn, telefoon en andere kanalen.',
          'Ik genereer kwalitatieve leads en maak een goede eerste indruk namens BURG QHSSE.',
        ],
        [
          'Ik communiceer professioneel en respectvol in al mijn klantcontacten.',
          'Ik pas mijn toon aan op de klant, blijf feitelijk en behulpzaam — ook wanneer een gesprek lastig verloopt of een klant kritisch is.',
        ],
        [
          'Ik bouw een eerste netwerk op in de markt en zorg voor een positieve uitstraling.',
          'Klanten en kandidaten die ik spreek, ervaren mij als betrouwbaar en professioneel.',
        ],
      ],
      [
        [
          'Ik werk toe naar het zelfstandig binnenhalen van functies, in lijn met de norm voor mijn niveau.',
          'Norm: gemiddeld (werkdagen − 1) functies per week, gemeten over 8 aaneengesloten weken. Richtlijn voor de score: 1–2 = structureel onder de norm, 3 = norm gehaald, 4–5 = norm structureel overtroffen.',
        ],
        [
          'Ik begrijp hoe mijn activiteiten bijdragen aan omzet en handel binnen de gestelde kaders.',
          'Ik kan uitleggen wat mijn rol is in het verdienmodel, onderhandel niet buiten mijn bevoegdheid, en vraag tijdig afstemming bij twijfel over marges of voorwaarden.',
        ],
        [
          'Ik neem commerciële kansen waar en zet deze om in concrete acties.',
          'Ik signaleer kansen actief tijdens klantcontact en onderneem zelf de eerste stappen om leads te converteren.',
        ],
      ],
    ),
    // 2 = Sales Consultant — Ik presteer
    2: bouwStellingen(
      [
        [
          'Ik houd Bullhorn volledig en consistent bij — klantdata, opvolgingen en taken zijn altijd actueel.',
          'Mijn werk is overdraagbaar en voorspelbaar voor collega\'s en leidinggevende, zonder dat hier door anderen op gestuurd moet worden.',
        ],
        [
          'Ik neem volledig eigenaarschap over mijn salesproces van A tot Z, zonder sturing van buitenaf.',
          'Ik initieer, pak op en volg zelfstandig door — ook bij complexe of langlopende trajecten — en bewaak afspraken op eigen initiatief.',
        ],
        [
          'Ik maak dag-, week- en maandplanningen en stuur deze proactief bij wanneer doelen in gevaar komen.',
          'Mijn planning is realistisch en gestructureerd; ik signaleer zelf wanneer ik achterloop en neem actie vóórdat mijn leidinggevende dit moet aankaarten.',
        ],
      ],
      [
        [
          "Ik draag actief bij aan teamresultaat door kennis te delen en collega's te ondersteunen.",
          'Ik zie het succes van het team als mede mijn verantwoordelijkheid, niet alleen mijn eigen target.',
        ],
        [
          'Ik geef en ontvang feedback constructief en gebruik dit aantoonbaar om te verbeteren.',
          "Ik neem zelf initiatief tot feedbackmomenten — zowel het geven aan collega's als het ontvangen — en laat zien wat ik ermee doe.",
        ],
        [
          'Ik werk zelfstandig aan mijn POP en onderneem concrete acties richting Senior niveau.',
          'Ik weet wat er van een Senior Sales Consultant wordt verwacht en zet gerichte stappen om daar te komen.',
        ],
      ],
      [
        [
          'Ik beheers het volledige salesproces zelfstandig — van lead tot contractafsluiting en overdracht.',
          'Mijn werk vereist minimale correctie, voldoet structureel aan de kwaliteitsnormen, en ik draag dossiers netjes over bij afronding.',
        ],
        [
          'Ik ontwikkel mij actief als QHSSE-kennisspecialist en deel relevante kennis met mijn team.',
          'Ik volg sectorontwikkelingen, vertaal dit naar waarde voor klanten, én ik deel deze kennis actief met collega\'s — bijvoorbeeld in teamoverleg.',
        ],
        [
          'Ik lever aantoonbare meerwaarde voor klanten en kandidaten door inhoudelijke expertise.',
          'Klanten zien mij als een sparringpartner die meedenkt in oplossingen, niet alleen als verkoper.',
        ],
      ],
      [
        [
          'Ik benut Bullhorn, 3CX en overige systemen volledig en voorkom structureel handmatig of dubbel werk.',
          'Ik werk efficiënt en haal maximale waarde uit alle beschikbare tooling, ook bij complexere processen.',
        ],
        [
          'Ik signaleer verbeterkansen en kom proactief met concrete ideeën om slimmer te werken.',
          'Ik draag verbetervoorstellen aan en denk actief mee over procesoptimalisatie binnen het team.',
        ],
        [
          "Ik help collega's bij het gebruik van systemen en deel mijn kennis actief.",
          'Ik draag bij aan een lerende en efficiënte werkomgeving door anderen op weg te helpen.',
        ],
      ],
      [
        [
          'Ik onderhoud en bouw aantoonbaar duurzame klantrelaties en key-accounts.',
          'Klanten ervaren mij als betrouwbaar, proactief en waardevol op de lange termijn.',
        ],
        [
          'Ik vertegenwoordig BURG QHSSE professioneel en draag dit actief uit via LinkedIn en andere kanalen.',
          'Mijn externe communicatie sluit aan bij onze normen en versterkt de reputatie van de organisatie — ook in lastige of gevoelige situaties.',
        ],
        [
          'Ik draag bij aan de positionering van BURG QHSSE in de markt door zichtbaar aanwezig te zijn.',
          'Ik heb een groeiend netwerk en word herkend als specialist binnen mijn marktsegment.',
        ],
      ],
      [
        [
          'Ik realiseer structureel mijn omzetdoelstelling.',
          'Norm: gemiddeld 1,5 plaatsing per maand, gemeten over 6 aaneengesloten maanden. Richtlijn voor de score: 1–2 = structureel onder de norm, 3 = norm gehaald, 4–5 = norm structureel overtroffen. Mijn pipeline is gevuld en voorspelbaar.',
        ],
        [
          'Ik ga bewust om met marges en commerciële kansen en maak afgewogen keuzes.',
          'Ik onderhandel binnen kaders, houd rekening met rendement en benut kansen optimaal — zonder hiervoor afstemming nodig te hebben bij standaardgevallen.',
        ],
        [
          'Ik draag bij aan financieel gezonde keuzes door te denken vanuit continuïteit en groei.',
          'Ik denk mee vanuit een ondernemersmindset en handel in lijn met de organisatiedoelen, ook buiten mijn eigen target.',
        ],
      ],
    ),
    // 3 = Senior Sales Consultant — Top performer
    3: bouwStellingen(
      [
        [
          'Ik zorg dat processen en systemen op teamniveau op orde zijn en draag bij aan structurele verbetering.',
          'Ik signaleer knelpunten in werkprocessen en pak deze projectmatig op, niet alleen voor mijn eigen werk maar voor het team.',
        ],
        [
          'Ik neem eigenaarschap over organisatiebrede vraagstukken en initieer verbeteringen zonder dat dit wordt gevraagd.',
          'Ik signaleer knelpunten en kom zelf met verbetervoorstellen, ook wanneer niemand mij hierom vraagt — ik wacht niet op een verzoek.',
        ],
        [
          'Ik draag actief bij aan schaalbaarheid door processen te documenteren en herhaalbaar te maken.',
          'Ik leg werkwijzen vast in documentatie zodat ze herhaalbaar en overdraagbaar zijn, ook wanneer ik er zelf niet bij ben.',
        ],
      ],
      [
        [
          'Ik fungeer als informeel leider en draag actief bij aan een positieve groeicultuur binnen het team.',
          "Ik inspireer collega's, geef het goede voorbeeld en help anderen concreet groeien — bijvoorbeeld door mee te lopen of te sparren.",
        ],
        [
          'Ik geef gevraagd en ongevraagd constructieve feedback en coach collega\'s actief.',
          'Ik zie het als mijn verantwoordelijkheid om bij te dragen aan de ontwikkeling van het team, ook wanneer dat niet expliciet bij mijn functie hoort.',
        ],
        [
          'Ik werk aan mijn persoonlijke leiderschapsontwikkeling en bereid me aantoonbaar voor op de rol van Managing Consultant.',
          'Ik ken de verwachtingen van een leidinggevende rol binnen BURG QHSSE en onderneem gerichte stappen om daar te komen.',
        ],
      ],
      [
        [
          'Mijn vakmanschap is een voorbeeld voor het team — ik lever structureel werk van hoge kwaliteit.',
          'Ik help de kwaliteitslat voor de organisatie omhoog te leggen, onder andere door anderen mee te nemen in mijn aanpak.',
        ],
        [
          'Ik ben een aantoonbare QHSSE-expert en draag actief bij aan de ontwikkeling van BURG QHSSE als geheel.',
          'Ik deel expertise, begeleid collega\'s inhoudelijk en denk mee over strategische kennisopbouw binnen de organisatie.',
        ],
        [
          'Ik maak het verschil voor strategische klanten en draag bij aan de inhoudelijke positionering van BURG QHSSE.',
          'Klanten zoeken mij op als expert en sparringpartner op directieniveau.',
        ],
      ],
      [
        [
          'Ik benut Bullhorn, 3CX en overige systemen optimaal en identificeer actief kansen om processen verder te automatiseren.',
          'Ik ga verder dan correct gebruik — ik zoek naar manieren om systemen slimmer in te zetten voor het hele team.',
        ],
        [
          'Ik initieer verbeterprojecten op het gebied van tooling en processen en trek deze zelfstandig.',
          'Ik kom niet alleen met ideeën, maar voer verbeteringen ook daadwerkelijk door tot resultaat.',
        ],
        [
          "Ik begeleid collega's structureel in het optimaal benutten van systemen en data.",
          'Ik fungeer als interne kennisbron op het gebied van tools en efficiëntie.',
        ],
      ],
      [
        [
          'Ik bouw en onderhoud meerdere strategische key-accounts en ben een vertrouwd gezicht in de markt.',
          'Klanten beschouwen mij als een langetermijnpartner en raadplegen mij proactief, ook buiten lopende opdrachten.',
        ],
        [
          'Ik vertegenwoordig BURG QHSSE op een niveau dat onze reputatie en positionering actief versterkt.',
          'Ik neem deel aan events, publiceer inhoudelijk op LinkedIn en ben zichtbaar als expert in de markt.',
        ],
        [
          "Ik draag actief bij aan het versterken van onze naam in nieuwe marktsegmenten of regio's.",
          'Ik signaleer nieuwe marktkansen en vertaal deze naar concrete business.',
        ],
      ],
      [
        [
          'Ik realiseer structureel de salesdoelstelling voor mijn label of BU en overtref deze aantoonbaar.',
          'Richtlijn voor de score: 3 = behaalt structureel het overeengekomen individuele target, 4 = overtreft dit target consistent, 5 = overtreft het target structureel en fungeert hierin als voorbeeld voor het team.',
        ],
        [
          'Ik denk strategisch over marges, rendement en commerciële kansen op organisatieniveau.',
          'Ik help de organisatie financieel gezonde keuzes te maken en signaleer risico\'s proactief, voordat ze een probleem worden.',
        ],
        [
          'Ik draag bij aan de financiële groei van de organisatie door nieuwe markten, klanten en kansen te ontsluiten.',
          'Mijn commerciële bijdrage heeft impact die verder gaat dan mijn eigen target.',
        ],
      ],
    ),
  },
  Recruitment: {
    // 1 = Associate Recruitment Consultant — Ik leer
    1: bouwStellingen(
      [
        [
          'Ik verwerk kandidaatdata, contactmomenten en statusupdates correct en tijdig in Bullhorn.',
          "Mijn registraties zijn volledig en consistent, zodat collega's altijd op mijn data kunnen voortbouwen.",
        ],
        [
          'Ik voer mijn recruitmenttaken uit zoals afgesproken en deel ongevraagd waar ik sta in mijn voortgang.',
          'Ik werk gestructureerd en betrouwbaar in mijn basistaken, en mijn leidinggevende hoeft niet naar de status te vragen — ik meld dit zelf.',
        ],
        [
          "Ik houd mijn kandidatenpipeline overzichtelijk en overdraagbaar voor collega's.",
          'Statusupdates en opvolgingen zijn altijd actueel en begrijpelijk voor het team, ook als ik er zelf niet bij ben.',
        ],
      ],
      [
        [
          'Ik stem mijn werkzaamheden actief af met sales consultants en collega\'s voor een soepel recruitmentproces.',
          'Ik communiceer open, help waar ik kan en draag bij aan een positieve samenwerking.',
        ],
        [
          'Ik sta open voor feedback en onderneem zichtbaar actie op verbeterpunten in mijn aanpak.',
          'Ik luister, stel vragen, en laat in mijn werk concreet zien dat ik feedback heb toegepast.',
        ],
        [
          'Ik werk actief aan mijn ontwikkeling via mijn POP en de begeleiding van mijn leidinggevende.',
          'Ik weet wat mijn leerdoelen zijn en onderneem concrete stappen richting het niveau van Recruitment Consultant.',
        ],
      ],
      [
        [
          'Ik beheers de basisstappen van de recruitmentcyclus: sourcing, intake, matching en kandidaat presenteren.',
          'Ik voer het recruitmentproces uit zoals geleerd en vraag actief om feedback op mijn aanpak.',
        ],
        [
          'Ik verdiep mijn kennis van de QHSSE-sector en pas dit toe bij het beoordelen van vacatures en kandidaten.',
          'Ik lees me in en kan de basisvereisten van een vacature helder vertalen naar geschikte kandidaten.',
        ],
        [
          'Ik lever kandidaatpresentaties af die volledig, professioneel en kwalitatief zijn.',
          'Mijn kandidaatvoorstellen zijn correct, gemotiveerd en sluiten aan bij de klantbehoefte; ik controleer mijn werk voordat ik het indien.',
        ],
      ],
      [
        [
          'Ik gebruik Bullhorn en 3CX zoals uitgelegd, zodat mijn basisregistratie altijd op orde is.',
          'Ik benut sjablonen, herinneringen en koppelingen om handmatig of dubbel werk te voorkomen.',
        ],
        [
          'Ik geef aan als ik iets niet begrijp in de systemen en vraag actief om uitleg of ondersteuning.',
          'Ik wacht niet af bij onduidelijkheid in Bullhorn of 3CX, maar vraag gericht om uitleg bij een collega of leidinggevende.',
        ],
        [
          'Ik sta open voor nieuwe tools en werkwijzen en pas me snel aan als processen worden verbeterd.',
          'Ik draag een positieve houding ten aanzien van verandering en optimalisatie.',
        ],
      ],
      [
        [
          'Ik benader kandidaten proactief via LinkedIn en Bullhorn en maak een professionele eerste indruk.',
          'Ik genereer kwalitatieve kandidaatcontacten en vertegenwoordig BURG QHSSE positief.',
        ],
        [
          'Ik communiceer professioneel met kandidaten en manage verwachtingen helder gedurende het proces.',
          'Ik ben duidelijk over status en vervolgstappen — ook wanneer ik een kandidaat moet afwijzen of een proces langer duurt dan verwacht.',
        ],
        [
          'Ik bouw een eerste kandidatennetwerk op binnen mijn specialisme.',
          'Ik onderhoud contacten actief en leg de basis voor langdurige relaties met professionals in de markt.',
        ],
      ],
      [
        [
          "Ik lever een aantoonbare bijdrage aan het teamresultaat, in lijn met de teamtarget en KPI's.",
          'Norm: minimaal 3 aaneengesloten maanden een meetbare bijdrage aan teamplaatsingen. Richtlijn voor de score: 1–2 = nauwelijks zichtbare bijdrage, 3 = bijdrage op niveau, 4–5 = bijdrage structureel boven verwachting.',
        ],
        [
          'Ik begrijp hoe mijn activiteiten bijdragen aan omzet en handel binnen de gestelde kaders.',
          'Ik kan uitleggen wat mijn rol is in het verdienmodel en neem hier verantwoordelijkheid voor in mijn dagelijks werk.',
        ],
        [
          'Ik prioriteer vacatures en kandidaten op basis van impact en urgentie.',
          'Ik besteed mijn tijd aan activiteiten die het meeste bijdragen aan het teamresultaat.',
        ],
      ],
    ),
    // 2 = Recruitment Consultant — Ik presteer
    2: bouwStellingen(
      [
        [
          'Ik houd Bullhorn volledig en consistent bij — kandidaatdata, voortgang en contactmomenten zijn altijd actueel.',
          "Mijn pipeline is altijd overdraagbaar voor collega's en leidinggevende, zonder dat ik hier apart op gewezen moet worden.",
        ],
        [
          'Ik neem volledig eigenaarschap over mijn recruitmentproces van sourcing tot plaatsing, zonder sturing van buitenaf.',
          'Ik initieer, bewaak en rond processen zelf af — ook bij complexe vacatures of langlopende trajecten — zonder dat hier op gestuurd moet worden.',
        ],
        [
          'Ik maak zelfstandig dag-, week- en maandplanningen en koppel hier verbeteracties aan.',
          'Mijn planning is realistisch en gestructureerd; ik stuur proactief bij zodra doelen in gevaar komen.',
        ],
      ],
      [
        [
          'Ik draag actief bij aan teamresultaat door kennis te delen, mee te denken bij jobpulls en collega\'s te ondersteunen.',
          'Ik zie het succes van het team als mede mijn verantwoordelijkheid, niet alleen mijn eigen plaatsingen.',
        ],
        [
          'Ik geef en ontvang feedback constructief en gebruik dit aantoonbaar om mijn aanpak te verbeteren.',
          "Ik neem zelf initiatief tot feedbackmomenten — zowel het geven aan collega's als het ontvangen — en laat zien wat ik ermee doe.",
        ],
        [
          'Ik werk zelfstandig aan mijn POP en onderneem concrete acties richting Senior Recruitment Consultant niveau.',
          'Ik weet wat er van een Senior wordt verwacht en zet gerichte stappen om daar te komen.',
        ],
      ],
      [
        [
          'Ik beheers de volledige recruitmentcyclus zelfstandig — van sourcing en intake tot aanbieding en plaatsing.',
          'Mijn werk vereist minimale correctie en voldoet structureel aan de kwaliteitsnormen, inclusief een nette overdracht bij afronding.',
        ],
        [
          'Ik ontwikkel mij actief als QHSSE-kennisspecialist binnen mijn markt en deel dit met het team.',
          'Ik ben op de hoogte van marktontwikkelingen, salarisranges en beschikbaarheid, vertaal dit naar betere matches, én deel deze kennis actief met collega\'s.',
        ],
        [
          'Ik lever kwalitatieve matches en kandidaatpresentaties die aantoonbare meerwaarde bieden voor klanten.',
          'Klanten en kandidaten ervaren mijn begeleiding als professioneel, betrouwbaar en waardevol.',
        ],
      ],
      [
        [
          'Ik benut Bullhorn, 3CX en overige systemen volledig en voorkom structureel handmatig of dubbel werk.',
          'Ik werk efficiënt en haal maximale waarde uit alle beschikbare tooling, ook bij complexere trajecten.',
        ],
        [
          'Ik signaleer verbeterkansen in recruitmentprocessen en tooling en kom proactief met concrete ideeën.',
          'Ik draag verbetervoorstellen aan en denk actief mee over slimmere werkwijzen binnen het team.',
        ],
        [
          "Ik help collega's bij het gebruik van systemen en deel mijn kennis actief binnen het team.",
          'Ik draag bij aan een lerende en efficiënte werkomgeving door anderen op weg te helpen.',
        ],
      ],
      [
        [
          'Ik bouw en onderhoud een sterk kandidatennetwerk binnen mijn QHSSE-specialisme.',
          'Ik onderhoud langdurige relaties met professionals en ben een herkenbaar gezicht in mijn markt.',
        ],
        [
          'Ik vertegenwoordig BURG QHSSE professioneel in alle kandidaat- en stakeholdercommunicatie.',
          'Mijn communicatie en aanpak versterken de reputatie van de organisatie — ook in lastige situaties, zoals een afwijzing of een verlopen procedure.',
        ],
        [
          'Ik draag bij aan de positionering van BURG QHSSE als specialist door zichtbaar aanwezig te zijn in de markt.',
          'Ik ben actief op LinkedIn en word herkend als recruiter binnen mijn vakgebied.',
        ],
      ],
      [
        [
          'Ik realiseer structureel mijn recruitmenttargets en draag aantoonbaar bij aan de teamomzet.',
          'Norm: [in te vullen — bijv. gemiddeld aantal plaatsingen per maand], gemeten over meerdere aaneengesloten maanden. Richtlijn voor de score: 1–2 = structureel onder de norm, 3 = norm gehaald, 4–5 = norm structureel overtroffen.',
        ],
        [
          'Ik ga bewust om met tijdsbesteding en prioriteer vacatures en kandidaten op basis van impact en rendement.',
          'Ik besteed mijn tijd aan activiteiten die het meeste bijdragen aan omzet en kwaliteit.',
        ],
        [
          'Ik draag bij aan financieel gezonde keuzes door te denken vanuit continuïteit en teamgroei.',
          'Ik denk mee over het behalen van teamdoelstellingen en handel in lijn met de organisatiedoelen.',
        ],
      ],
    ),
    // 3 = Senior Recruitment Consultant — Top performer
    3: bouwStellingen(
      [
        [
          'Ik waak over de kwaliteit van CRM-data en procesdiscipline binnen het team.',
          'Ik zorg dat Bullhorn-data en recruitmentprocessen op teamniveau structureel op orde en overdraagbaar zijn — los van mijn eigen pipeline.',
        ],
        [
          'Ik neem eigenaarschap over de optimalisatie van recruitmentprocessen en pak verbeteringen projectmatig op.',
          'Ik signaleer knelpunten in werkwijzen en systemen en initieer concrete verbeteringen, ook zonder dat dit gevraagd wordt.',
        ],
        [
          'Ik draag actief bij aan schaalbaarheid door recruitmentprocessen te documenteren en herhaalbaar te maken.',
          'Ik leg recruitmentprocessen vast in werkwijzen of documentatie, zodat ze herhaalbaar en overdraagbaar zijn — ook als ik er zelf niet bij ben.',
        ],
      ],
      [
        [
          'Ik ondersteun Associate en Recruitment Consultants actief in hun dagelijkse werkzaamheden en ontwikkeling.',
          "Ik fungeer als informeel leider, geef het goede voorbeeld en help collega's concreet groeien.",
        ],
        [
          'Ik geef gevraagd en ongevraagd constructieve feedback en draag bij aan een cultuur van leren en verbeteren.',
          'Ik benoem het ook wanneer iets niet goed gaat — bijvoorbeeld bij CRM-discipline of kwaliteit van werk — en zie de ontwikkeling van het team als mede mijn verantwoordelijkheid.',
        ],
        [
          'Ik werk aan mijn persoonlijke leiderschapsontwikkeling en bereid me aantoonbaar voor op de rol van Managing Consultant.',
          'Ik ken de verwachtingen van een leidinggevende rol binnen BURG QHSSE en onderneem gerichte stappen om daar te komen.',
        ],
      ],
      [
        [
          'Ik beheers complexe vacatures en schaarse profielen binnen de QHSSE-markt volledig zelfstandig.',
          'Mijn vakmanschap is een voorbeeld voor het team en ik help de kwaliteitslat omhoog te leggen.',
        ],
        [
          'Ik ben een aantoonbare marktkenner en inhoudelijk specialist binnen mijn QHSSE-discipline.',
          'Ik deel expertise actief, begeleid collega\'s inhoudelijk en denk mee over strategische kennisopbouw.',
        ],
        [
          'Ik draag actief bij aan de verdere ontwikkeling van recruitment best practices binnen BURG QHSSE.',
          'Ik initieer en deel verbeteringen in aanpak en methodiek die het hele team sterker maken.',
        ],
      ],
      [
        [
          'Ik benut Bullhorn, 3CX en overige systemen optimaal en identificeer actief kansen voor verdere automatisering.',
          'Ik ga verder dan correct gebruik — ik zoek naar manieren om recruitmentprocessen slimmer in te richten.',
        ],
        [
          'Ik initieer verbeterprojecten op het gebied van tooling en recruitmentprocessen en trek deze zelfstandig.',
          'Ik kom niet alleen met ideeën, maar voer verbeteringen ook daadwerkelijk door tot resultaat.',
        ],
        [
          "Ik begeleid collega's structureel in het optimaal benutten van systemen en data.",
          'Ik fungeer als interne kennisbron op het gebied van tools, data en efficiëntie binnen recruitment.',
        ],
      ],
      [
        [
          'Ik bouw en onderhoud langdurige relaties met key kandidaten en stakeholders in de QHSSE-markt.',
          'Ik ben een vertrouwd aanspreekpunt voor professionals in mijn specialisme en word proactief benaderd.',
        ],
        [
          'Ik vertegenwoordig BURG QHSSE op een niveau dat onze reputatie als specialist actief versterkt.',
          'Mijn zichtbaarheid en aanpak in de markt dragen bij aan de naamsbekendheid van de organisatie.',
        ],
        [
          'Ik draag actief bij aan het versterken van onze marktpositie door nieuwe netwerken en segmenten aan te boren.',
          'Ik signaleer nieuwe kansen in de arbeidsmarkt en vertaal deze naar concrete recruitmentactiviteiten.',
        ],
      ],
      [
        [
          'Ik realiseer structureel en zelfstandig mijn recruitmenttargets en overtref deze aantoonbaar.',
          'Richtlijn voor de score: 3 = behaalt structureel het overeengekomen individuele target, 4 = overtreft dit target consistent, 5 = overtreft het target structureel en fungeert hierin als voorbeeld voor het team.',
        ],
        [
          'Ik denk mee over de financiële impact van recruitmentkeuzes en prioriteer op basis van rendement.',
          'Ik help het team focussen op vacatures en kandidaten die de meeste waarde genereren.',
        ],
        [
          'Ik draag bij aan de groei van de organisatie door schaarse profielen in te vullen en nieuwe markten te ontsluiten.',
          'Mijn bijdrage aan plaatsingen en netwerk heeft impact die verder gaat dan mijn eigen target.',
        ],
      ],
    ),
  },
  Corporate: {
    // 1 = Finance Medewerker
    1: bouwStellingen(
      [
        [
          'Ik verwerk inkomende en uitgaande facturen, betalingen en boekingen correct en tijdig in het financiële systeem.',
          'Mijn verwerking is volledig en foutloos — afwijkingen signaleer ik direct en los ik niet stilzwijgend op.',
        ],
        [
          'Ik houd mijn werkoverzicht bij en zorg dat openstaande posten, betalingstermijnen en deadlines altijd actueel zijn.',
          "Collega's en leidinggevende kunnen zonder extra uitleg zien waar zaken staan en wat er nog open staat.",
        ],
        [
          'Ik werk op een gestructureerde en consistente manier, zodat mijn werkzaamheden overdraagbaar zijn.',
          'Mijn werkwijze is gedocumenteerd en herhaalbaar — ook een collega kan mijn deel van de administratie overnemen zonder dat er informatie ontbreekt.',
        ],
      ],
      [
        [
          "Ik stem mijn werkzaamheden actief af met collega's en draag bij aan een soepele samenwerking binnen Team Corporate.",
          'Ik communiceer open over deadlines, verwachtingen en knelpunten die effect hebben op het werk van anderen.',
        ],
        [
          'Ik sta open voor feedback en onderneem zichtbaar actie op verbeterpunten in mijn werk.',
          'Ik luister, stel vragen en laat in mijn werk concreet zien dat ik feedback heb toegepast — niet alleen dat ik het gehoord heb.',
        ],
        [
          'Ik werk actief aan mijn professionele ontwikkeling en stel concrete leerdoelen via mijn POP.',
          'Ik weet wat ik wil verbeteren en onderneem hier gerichte, aantoonbare stappen in.',
        ],
      ],
      [
        [
          'Ik verwerk financiële data nauwkeurig en controleer mijn werk systematisch voordat ik het aanlever.',
          'Ik lever niets aan waar twijfels over zijn — bij onzekerheid vraag ik tijdig afstemming in plaats van te gissen.',
        ],
        [
          'Ik beheers de financiële processen die bij mijn rol horen en weet wat ik wel en niet zelfstandig mag afhandelen.',
          'Ik handeel binnen de kaders van mijn functie en escaleer tijdig wanneer iets buiten mijn bevoegdheid of kennis valt.',
        ],
        [
          "Ik signaleer onregelmatigheden, afwijkingen of risico's in de administratie proactief en meld dit direct.",
          'Ik wacht niet tot een fout groter wordt — ik benoem het zodra ik het zie, bij de juiste persoon.',
        ],
      ],
      [
        [
          'Ik gebruik de financiële systemen zoals afgesproken en benut beschikbare functionaliteiten om handmatig werk te minimaliseren.',
          'Ik maak gebruik van sjablonen, koppelingen en vaste workflows om dubbele invoer en onnodige handelingen te voorkomen.',
        ],
        [
          'Ik signaleer als een proces onnodig tijdrovend of foutgevoelig is en kom met een concreet voorstel voor verbetering.',
          'Ik wacht niet op instructie, maar denk actief mee over hoe de administratie slimmer kan worden ingericht.',
        ],
        [
          'Ik sta open voor nieuwe tools en geautomatiseerde werkwijzen en pas me aan wanneer processen worden aangepast.',
          'Ik draag een positieve houding ten aanzien van digitalisering en optimalisatie binnen Team Corporate.',
        ],
      ],
      [
        [
          'Ik behandel alle financiële informatie strikt vertrouwelijk en ga professioneel om met gevoelige data.',
          'Ik deel geen financiële informatie buiten de daarvoor bestemde kanalen — ook niet informeel of tussen neus en lippen door.',
        ],
        [
          'Ik communiceer professioneel met leveranciers, interne stakeholders en andere contacten over financiële zaken.',
          'Mijn toon en aanpak zijn helder, consistent en representatief voor BURG QHSSE — ook bij discussies over facturen of betalingstermijnen.',
        ],
        [
          'Ik draag bij aan een betrouwbaar financieel imago van de organisatie door nauwkeurig en integer te werken.',
          'Leveranciers en interne stakeholders ervaren onze financiële administratie als professioneel en betrouwbaar — mijn werk draagt daar dagelijks aan bij.',
        ],
      ],
      [
        [
          'Ik lever mijn werk tijdig aan en zorg dat financiële verplichtingen worden nagekomen binnen de gestelde termijnen.',
          'Factuurverwerking, betalingsruns en reconciliaties zijn altijd tijdig afgerond — vertragingen meld ik proactief, niet achteraf.',
        ],
        [
          'Ik denk bij mijn werkzaamheden na over wat ze opleveren en wat ze kosten — ook intern.',
          'Ik besteed mijn tijd aan taken die waarde toevoegen en stel vragen wanneer een werkwijze onnodig complex, tijdrovend of kostbaar lijkt.',
        ],
        [
          'Ik draag bij aan kostenbeheersing door nauwkeurig te werken en fouten, dubbele betalingen en onnodige correctierondes actief te voorkomen.',
          'Eén fout in de administratie kan directe financiële of reputatieschade opleveren — ik neem die verantwoordelijkheid serieus.',
        ],
      ],
    ),
    // 2 = HR-Corporate Recruitment Officer
    2: bouwStellingen(
      [
        [
          'Ik houd HR-dossiers, recruitmentstatussen en procesinformatie actueel en volledig in de juiste systemen.',
          "Collega's en leidinggevende kunnen altijd op mijn data voortbouwen — er zijn geen blinde vlekken in mijn deel van het HR-systeem.",
        ],
        [
          'Ik bewaar het overzicht over lopende wervingstrajecten, onboarding- en preboardingprocessen en ondersteunende HR-taken tegelijkertijd.',
          'Ik werk gestructureerd en escaleer tijdig wanneer zaken dreigen te stagneren of met elkaar te conflicteren.',
        ],
        [
          'Ik documenteer HR-processen en wervingsworkflows zodat ze herhaalbaar en overdraagbaar zijn.',
          'Mijn werkwijze is vastgelegd en niet afhankelijk van mondelinge overdracht — ook een collega kan mijn processen overnemen.',
        ],
      ],
      [
        [
          'Ik draag actief bij aan een positieve kandidaat- en medewerkersbeleving bij BURG QHSSE.',
          'Van eerste contactmoment tot preboarding: ik zorg dat mensen zich welkom en goed geïnformeerd voelen — op elk moment in het proces.',
        ],
        [
          'Ik sta open voor feedback op mijn aanpak en gebruik dit aantoonbaar om HR- en recruitmentprocessen te verbeteren.',
          'Ik luister, stel vragen en laat concreet zien wat ik met feedback heb gedaan — ook wanneer het gaat over onze eigen HR-processen.',
        ],
        [
          'Ik werk actief aan mijn ontwikkeling als HR- en recruitmentprofessional via mijn POP.',
          'Ik weet wat mijn leerdoelen zijn en onderneem gerichte stappen om te groeien in kennis en impact binnen de functie.',
        ],
      ],
      [
        [
          'Ik beheers de volledige werving-en-selectiecyclus voor interne vacatures, van functieprofiel tot contractaanbod.',
          'Mijn trajecten zijn goed gedocumenteerd, tijdig afgerond en voldoen structureel aan de kwaliteitsnormen.',
        ],
        [
          'Ik ondersteun leidinggevenden proactief bij HR-taken zoals contractbeheer, onboarding, GPB-administratie en lopende HR-vraagstukken.',
          'Ik wacht niet tot leidinggevenden naar mij toe komen — ik anticipeer op deadlines en behoeften en zorg dat zaken op tijd geregeld zijn.',
        ],
        [
          'Ik bouw en onderhoud actief de employer branding van BURG QHSSE via de juiste kanalen.',
          'Mijn bijdrage aan employer branding is zichtbaar, consistent en aansluitend op onze doelgroep en positionering in de QHSSE-markt.',
        ],
      ],
      [
        [
          'Ik gebruik HR- en recruitmenttools zoals afgesproken en benut beschikbare functionaliteiten volledig.',
          'Ik maak gebruik van sjablonen, workflows en digitale processen om handmatig of dubbel werk te voorkomen.',
        ],
        [
          'Ik signaleer verbeterkansen in HR- en recruitmentprocessen en kom proactief met concrete voorstellen.',
          'Ik denk actief mee over hoe preboarding, onboarding, werving of HR-administratie slimmer kan worden ingericht.',
        ],
        [
          'Ik sta open voor AI-ondersteunde werkwijzen en nieuwe tools en pas ze toe wanneer ze aantoonbare meerwaarde bieden.',
          'Ik experimenteer verantwoord met nieuwe mogelijkheden en draag positief bij aan de digitalisering van Team Corporate.',
        ],
      ],
      [
        [
          'Ik vertegenwoordig BURG QHSSE professioneel in alle kandidaatcontacten en op externe kanalen.',
          'Mijn communicatie naar kandidaten is helder, tijdig en representatief — ook bij afwijzingen of vertragingen in het proces.',
        ],
        [
          'Ik draag actief bij aan een consistente en aantrekkelijke employer brand voor BURG QHSSE.',
          'Mijn uitingen op LinkedIn en andere kanalen sluiten aan op onze positionering en doelgroep.',
        ],
        [
          'Ik bouw een relevant netwerk op in de arbeidsmarkt dat aansluit op onze wervingsbehoefte.',
          'Ik onderhoud contacten actief en ben als herkenbaar gezicht namens BURG QHSSE zichtbaar in de markt.',
        ],
      ],
      [
        [
          'Ik denk bij elke wervingsinspanning na over wat het concreet oplevert — snellere plaatsing, lagere wervingskosten, betere match.',
          'Ik houd bij welke kanalen renderen en welke niet, en bespreek dit proactief met mijn leidinggevende.',
        ],
        [
          'Ik maak bewuste keuzes over de inzet van wervingskanalen op basis van kosten en bereik.',
          'Ik kies niet voor de duurste of meest voor de hand liggende oplossing, maar voor de aanpak met de beste prijs-kwaliteitverhouding.',
        ],
        [
          'Ik draag bij aan personeelsbehoud door onboarding- en preboardingprocessen kwalitatief goed uit te voeren.',
          'Een medewerker die goed start, is een investering die zich terugbetaalt — ik neem die eerste indruk serieus en meet of het werkt.',
        ],
      ],
    ),
    // 3 = Marketing & AI Officer
    3: bouwStellingen(
      [
        [
          'Ik houd marketingdata, campagneresultaten en projectstatussen actueel en inzichtelijk voor het team.',
          "Collega's en leidinggevende kunnen altijd zien wat er loopt, wat de actuele cijfers zijn en waar we staan ten opzichte van de doelen.",
        ],
        [
          'Ik documenteer mijn werkwijzen, tools en gebouwde applicaties zodat ze overdraagbaar en herhaalbaar zijn.',
          'Mijn werk is niet afhankelijk van mondelinge kennisoverdracht — ook anderen kunnen ermee verder zonder dat ik er bij hoef te zijn.',
        ],
        [
          'Ik bouw marketing- en AI-toepassingen op een manier die schaalbaarheid ondersteunt.',
          'Wat ik maak is gestructureerd, gedocumenteerd en ontworpen om mee te groeien met de organisatie.',
        ],
      ],
      [
        [
          'Ik maak data, analyses en AI-toepassingen begrijpelijk voor collega\'s zonder technische achtergrond.',
          'Ik vertaal resultaten en tools naar heldere inzichten die anderen direct kunnen gebruiken in hun werk.',
        ],
        [
          'Ik sta open voor feedback op mijn werk — zowel op de inhoud als op de toepasbaarheid — en gebruik dit om te verbeteren.',
          'Ik test mijn applicaties en analyses samen met de eindgebruikers en pas ze aan op basis van hun praktijkervaring.',
        ],
        [
          'Ik werk actief aan mijn ontwikkeling als Marketing- en AI-professional via mijn POP.',
          'Ik volg relevante ontwikkelingen op het snijvlak van marketing, data en AI en vertaal dit naar concrete toepassingen voor BURG QHSSE.',
        ],
      ],
      [
        [
          'Ik beheer en analyseer marketingdata nauwkeurig en lever betrouwbare inzichten op aan de juiste stakeholders.',
          'Mijn analyses zijn reproduceerbaar, goed gedocumenteerd en vrij van fouten of ongetoetste aannames.',
        ],
        [
          'Ik bouw functionele AI-toepassingen die een aantoonbaar werkend doel dienen voor BURG QHSSE.',
          'Wat ik bouw is stabiel, gedocumenteerd en afgestemd op de behoefte van de gebruiker — geen prototype dat niemand gebruikt.',
        ],
        [
          'Ik bewaak de kwaliteit van mijn marketinguitingen en AI-output en toets deze aan de organisatiedoelen.',
          'Ik lever geen werk aan dat niet gecontroleerd, getest of afgestemd is — ook niet onder tijdsdruk.',
        ],
      ],
      [
        [
          'Ik zet AI-tools en automatiseringsoplossingen in om repetitieve of tijdrovende marketing- en datataken te vereenvoudigen.',
          'Ik identificeer processen die geautomatiseerd kunnen worden en bouw of implementeer hier gericht oplossingen voor.',
        ],
        [
          'Ik signaleer kansen voor verdere automatisering of AI-inzet en vertaal deze naar concrete voorstellen.',
          'Ik kom niet alleen met ideeën, maar werk ze uit tot een werkbaar plan of werkend prototype.',
        ],
        [
          'Ik help collega\'s bij het begrijpen en gebruiken van AI-tools en marketingdashboards.',
          'Ik fungeer als interne kennisbron op het snijvlak van marketing en technologie binnen Team Corporate.',
        ],
      ],
      [
        [
          'Ik monitor de marketingprestaties van BURG QHSSE structureel en vertaal dit naar concrete inzichten.',
          'Ik houd bij hoe onze kanalen presteren, signaleer trends en bespreek bevindingen actief met mijn leidinggevende.',
        ],
        [
          'Ik zorg dat marketingkeuzes data-gedreven zijn en aansluiten op onze doelgroep en positionering.',
          'Ik onderbouw keuzes met cijfers — niet alleen met gevoel — en stel bij op basis van wat de data laat zien.',
        ],
        [
          'Ik draag bij aan een professionele en consistente digitale aanwezigheid van BURG QHSSE.',
          'Mijn bijdrage versterkt onze reputatie als specialist in de QHSSE-sector — zowel in content als in de technische laag daaronder.',
        ],
      ],
      [
        [
          'Ik benoem bij elk nieuw project of elke tool de verwachte baten voordat ik begin — niet achteraf.',
          'Ik maak concreet wat het oplevert (tijdsbesparing, bereik, conversie, kostenverlaging) en maak dit bespreekbaar met mijn leidinggevende vóór de uitvoering.',
        ],
        [
          'Ik maak bewuste keuzes over welke tools en platformen we inzetten, op basis van prijs en toegevoegde waarde.',
          'Ik vergelijk opties, houd rekening met licentiekosten en verdedig mijn keuze met een concreet kosten-batenplaatje.',
        ],
        [
          'Ik lever marketinginspanningen en AI-toepassingen die bijdragen aan meetbare organisatiedoelen.',
          'Mijn werk heeft aantoonbaar effect — ik meet de uitkomsten, rapporteer hierover en stuur bij wanneer het resultaat tegenvalt.',
        ],
      ],
    ),
  },
}

/** 1 t/m 5 met halve stappen — 9 mogelijke waarden, zie GPB-Principes.md. */
export const SCORE_OPTIES = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5]

export function scoreBetekenis(score) {
  if (score >= 4.5) return 'Uitzonderlijk'
  if (score >= 3.5) return 'Goed'
  if (score === 3) return 'Op niveau'
  if (score >= 2) return 'Ontwikkelpunt'
  return 'Onder niveau'
}

export function eindscoreKwalificatie(eindscore) {
  if (eindscore >= 4) return 'Promotie bespreekbaar'
  if (eindscore >= 3.5) return 'Richting promotie'
  return 'Op of onder niveau'
}

function gemiddelde(waarden) {
  return waarden.reduce((a, b) => a + b, 0) / waarden.length
}

/**
 * Eindscore o.b.v. de leidinggevende-antwoorden (leidend, zie GpbRapport) —
 * null zolang die niet (zichtbaar) zijn ingevuld. Voor de medewerker zelf
 * is dit ook null zolang status 'concept' is, dankzij de maskering in
 * gpb_beoordelingen_view — dus deze functie geeft vanzelf pas een getal
 * terug zodra het ook echt getoond mag worden.
 */
export function berekenEindscore(beoordeling) {
  const antwoorden = beoordeling.leidinggevende_antwoorden
  if (!antwoorden) return null
  return gemiddelde(antwoorden.map((pijler) => gemiddelde(pijler.scores)))
}

/** Rondt af op 1 decimaal in nl-notatie — '—' voor null/undefined/NaN. */
export function fmtScore(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  return (Math.round(n * 10) / 10).toLocaleString('nl-NL')
}

export const STATUS_LABELS = {
  concept: 'Concept',
  goedgekeurd: 'Goedgekeurd',
  definitief: 'Definitief',
}
