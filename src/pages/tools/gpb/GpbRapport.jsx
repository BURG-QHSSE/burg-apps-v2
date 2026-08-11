import { PIJLERS, STELLINGEN, scoreBetekenis, functieLabel, berekenEindscore, fmtScore, STATUS_LABELS } from './constants'

function gemiddelde(waarden) {
  return waarden.reduce((a, b) => a + b, 0) / waarden.length
}

/**
 * Vergelijkingsweergave + volledig rapport in één component (zie
 * GPB-Principes.md: dit zijn twee weergaven van dezelfde vastgelegde data).
 * Scores van de leidinggevende zijn leidend voor de eindscore — de
 * zelfevaluatie van de medewerker is ter vergelijking zichtbaar.
 */
export default function GpbRapport({ beoordeling, doelen, acties }) {
  const medewerkerAntwoorden = beoordeling.medewerker_antwoorden
  const leidinggevendeAntwoorden = beoordeling.leidinggevende_antwoorden

  const pijlerGemiddeldes = PIJLERS.map((_, i) => ({
    medewerker: medewerkerAntwoorden ? gemiddelde(medewerkerAntwoorden[i].scores) : null,
    leidinggevende: leidinggevendeAntwoorden ? gemiddelde(leidinggevendeAntwoorden[i].scores) : null,
  }))

  // Zelfde stellingen-tekst als in GpbInvulForm — zonder deze zie je in het
  // rapport alleen een los cijfer + toelichting, niet welke stelling erbij
  // hoort. Bij het bespreken van het rapport (functioneringsgesprek) is dat
  // net de context die nodig is.
  const stellingenPerPijler =
    STELLINGEN[beoordeling.afdeling]?.[beoordeling.functieniveau] ??
    PIJLERS.map(() => [{ tekst: '—', voorbeeld: '' }, { tekst: '—', voorbeeld: '' }, { tekst: '—', voorbeeld: '' }])

  const eindscore = berekenEindscore(beoordeling)

  return (
    <div className="gpb-rapport">
      <div className="gpb-rapport-header">
        <div>
          <h2>{beoordeling.medewerker_naam}</h2>
          <p className="page-intro">
            {beoordeling.afdeling} · {functieLabel(beoordeling.afdeling, beoordeling.functieniveau)} · {beoordeling.periode}
          </p>
        </div>
        <span className={`badge badge-${beoordeling.status === 'definitief' ? 'mos' : 'blauwgrijs'}`}>
          {STATUS_LABELS[beoordeling.status]}
        </span>
      </div>

      {eindscore !== null && (
        <div className="section-card gpb-eindscore-card">
          <span className="metric-card-label">Eindscore (leidinggevende leidend)</span>
          <span className="metric-card-value">{fmtScore(eindscore)}</span>
        </div>
      )}

      {PIJLERS.map((pijlerNaam, i) => (
        <div className="section-card gpb-pijler-card" key={pijlerNaam}>
          <p className="calc-section-label">
            Pijler {i + 1}: {pijlerNaam} — gem. medewerker {fmtScore(pijlerGemiddeldes[i].medewerker)} · gem.
            leidinggevende {fmtScore(pijlerGemiddeldes[i].leidinggevende)}
          </p>

          {stellingenPerPijler[i].map((stelling, j) => (
            <div className="gpb-stelling" key={j}>
              <p className="gpb-stelling-tekst">{stelling.tekst}</p>
              {stelling.voorbeeld && <p className="gpb-stelling-voorbeeld">{stelling.voorbeeld}</p>}

              <div className="gpb-vergelijk-grid">
                <div>
                  <p className="control-label">Zelfevaluatie</p>
                  {medewerkerAntwoorden ? (
                    <div className="gpb-vergelijk-item">
                      <span className="badge badge-blauwgrijs">
                        {medewerkerAntwoorden[i].scores[j]} · {scoreBetekenis(medewerkerAntwoorden[i].scores[j])}
                      </span>
                      <p>{medewerkerAntwoorden[i].toelichtingen[j]}</p>
                    </div>
                  ) : (
                    <p className="idle-state">Nog niet ingevuld.</p>
                  )}
                </div>

                <div>
                  <p className="control-label">Leidinggevende</p>
                  {leidinggevendeAntwoorden ? (
                    <div className="gpb-vergelijk-item">
                      <span className="badge badge-mos">
                        {leidinggevendeAntwoorden[i].scores[j]} · {scoreBetekenis(leidinggevendeAntwoorden[i].scores[j])}
                      </span>
                      <p>{leidinggevendeAntwoorden[i].toelichtingen[j]}</p>
                    </div>
                  ) : beoordeling.leidinggevende_ingevuld_at ? (
                    <p className="idle-state">Ingevuld — zichtbaar na goedkeuring door HR.</p>
                  ) : (
                    <p className="idle-state">Nog niet ingevuld.</p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      ))}

      <div className="section-card">
        <p className="calc-section-label">Persoonlijke doelen</p>
        {doelen.length === 0 ? (
          <p className="idle-state">Nog geen doelen vastgelegd.</p>
        ) : (
          doelen.map((doel) => (
            <div className="gpb-doel-item" key={doel.id}>
              <span>{doel.omschrijving}</span>
              <span className="tool-card-hint">
                Pijler {doel.pijler} · deadline {new Date(doel.deadline).toLocaleDateString('nl-NL')}
              </span>
            </div>
          ))
        )}
      </div>

      <div className="gpb-rapport-acties gpb-print-hide">
        {acties}
        <button type="button" className="btn btn-secondary" onClick={() => window.print()}>
          Afdrukken / opslaan als PDF
        </button>
      </div>
    </div>
  )
}
