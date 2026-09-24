// Regressietest voor de Kandidaat Matcher-scoring: draait een vaste set
// vacature/kandidaat-paren (fixtures.json) rechtstreeks tegen rankKandidaat()
// en meldt of de score binnen de verwachte range valt en of de onderbouwing
// de verwachte trefwoorden noemt. Bedoeld om vóór het deployen van een
// QHSSE_SYSTEEM_PROMPT- of CLAUDE_MODEL-wijziging te draaien (zie de
// "Claude-modelkeuze"-sectie in CLAUDE.md) — geen Supabase/HTTP nodig, roept
// de Anthropic API rechtstreeks aan via de al-exported functies uit
// ../claude.ts.
//
// Gebruik:
//   ANTHROPIC_API_KEY=... deno run --allow-net --allow-env \
//     supabase/functions/kandidaat-matcher/_evals/run-evals.ts

import { rankKandidaat, bereidVacaturetekstVoorCache, PROMPT_VERSIE, CLAUDE_MODEL } from '../claude.ts'

interface Fixture {
  naam: string
  vacaturetekst: string
  cvTekst: string
  verwachte_score_min: number
  verwachte_score_max: number
  moet_noemen: string[]
  opmerking?: string
}

const pad = new URL('./fixtures.json', import.meta.url)
const ruw = JSON.parse(await Deno.readTextFile(pad)) as { fixtures: Fixture[] }

console.log(`Kandidaat Matcher evals — model=${CLAUDE_MODEL} prompt_versie=${PROMPT_VERSIE}\n`)

let geslaagd = 0
let gefaald = 0

for (const [i, fixture] of ruw.fixtures.entries()) {
  const label = `KANDIDAAT_EVAL${String(i + 1).padStart(2, '0')}`
  const vacatureTekstVoorCache = bereidVacaturetekstVoorCache(fixture.vacaturetekst)

  try {
    const { score, onderbouwing } = await rankKandidaat(vacatureTekstVoorCache, label, { CV: fixture.cvTekst })

    const scoreOk = score >= fixture.verwachte_score_min && score <= fixture.verwachte_score_max
    const ontbrekendeTrefwoorden = fixture.moet_noemen.filter(
      (w) => !onderbouwing.toLowerCase().includes(w.toLowerCase()),
    )
    const trefwoordenOk = ontbrekendeTrefwoorden.length === 0
    const ok = scoreOk && trefwoordenOk

    if (ok) geslaagd++
    else gefaald++

    console.log(`${ok ? '✅' : '❌'} ${fixture.naam}`)
    console.log(
      `   score=${score} (verwacht ${fixture.verwachte_score_min}-${fixture.verwachte_score_max})${scoreOk ? '' : '  <-- BUITEN RANGE'}`,
    )
    if (!trefwoordenOk) {
      console.log(`   ontbrekende trefwoorden: ${ontbrekendeTrefwoorden.join(', ')}`)
    }
    console.log(`   onderbouwing: ${onderbouwing}\n`)
  } catch (err) {
    gefaald++
    console.log(`❌ ${fixture.naam}`)
    console.log(`   FOUT tijdens aanroep: ${err instanceof Error ? err.message : String(err)}\n`)
  }
}

console.log(`\n${geslaagd}/${geslaagd + gefaald} geslaagd.`)
if (gefaald > 0) {
  console.log('Niet alle fixtures slaagden — controleer bovenstaande gevallen voordat je deze promptversie deployt.')
  Deno.exit(1)
}
