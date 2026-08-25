/**
 * Leest een geupload vacaturebestand (.txt/.pdf/.docx) uit tot platte tekst,
 * voor het vacaturetekst-veld in de Kandidaat Matcher. Puur client-side -
 * pdfjs-dist/mammoth worden dynamisch geimporteerd zodat ze niet in de
 * hoofdbundel terechtkomen (allebei relatief zware libraries, alleen nodig
 * als iemand daadwerkelijk een PDF/DOCX upload).
 *
 * .doc (het oude Word-formaat) wordt bewust niet ondersteund - daar bestaat
 * geen goede browser-only bibliotheek voor zonder aanzienlijke extra
 * complexiteit (vergelijkbaar met de Word-COM/textract-fallback die de
 * Bullhorn-sync server-side gebruikt, wat hier niet beschikbaar is).
 */

async function leesTxt(bestand) {
  return bestand.text()
}

async function leesPdf(bestand) {
  const pdfjsLib = await import('pdfjs-dist')
  const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

  const buffer = await bestand.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise
  const paginaTeksten = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const pagina = await pdf.getPage(i)
    const content = await pagina.getTextContent()
    paginaTeksten.push(content.items.map((item) => item.str).join(' '))
  }
  return paginaTeksten.join('\n\n').trim()
}

async function leesDocx(bestand) {
  const mammoth = await import('mammoth')
  const buffer = await bestand.arrayBuffer()
  const { value } = await mammoth.extractRawText({ arrayBuffer: buffer })
  return value.trim()
}

/**
 * Geeft de geextraheerde tekst terug, of gooit een Error met een
 * gebruiksvriendelijke Nederlandse melding als het bestandstype niet
 * ondersteund is of de extractie mislukt.
 */
export async function extraheerVacatureBestand(bestand) {
  const extensie = bestand.name.split('.').pop()?.toLowerCase()

  try {
    if (extensie === 'txt') return await leesTxt(bestand)
    if (extensie === 'pdf') return await leesPdf(bestand)
    if (extensie === 'docx') return await leesDocx(bestand)
  } catch (err) {
    throw new Error(`Kon "${bestand.name}" niet uitlezen: ${err.message}`)
  }

  throw new Error(
    `Bestandstype ".${extensie}" wordt niet ondersteund - gebruik .txt, .pdf of .docx (geen .doc).`,
  )
}
