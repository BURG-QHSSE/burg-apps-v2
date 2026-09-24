import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Edge Function: extern-zoeken
//
// Externe search via LinkedIn Recruiter (tegenhanger van de Kandidaat
// Matcher, die intern in Bullhorn zoekt). Het klikwerk in Recruiter doet de
// BURG Chrome-extensie in de browser van de consultant; deze functie levert
// het denkwerk.
//
// Acties (body.action):
//   - "strategie": vacaturetekst → zoekopdracht voor Recruiter (boolean voor
//     functietitels en trefwoorden, postcode + straal (postcode uit
//     Bullhorn: vacature-adres, anders bedrijfsadres), vaardigheden, jaren ervaring,
//     uit te sluiten bedrijven) + ideaalprofiel en harde eisen voor het
//     scoren later. De consultant controleert/past dit aan in BURG Apps
//     vóór de extensie ermee gaat zoeken.
//
// Zelfde beveiligingspatroon als kandidaat-matcher/index.ts: eerst de JWT van
// de aanroeper verifiëren en de rol checken onder normale RLS.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { maakStrategie, CLAUDE_MODEL } from './claude.ts'
import { getVacatureLocatie, type VacatureLocatie } from './bullhorn.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

// Voorlopig admin-only, zelfde drempel als toolRegistry.js's minimumRole
// voor 'extern-zoeken' zolang de tool in de testfase zit.
const TOEGESTANE_ROLLEN = ['admin']

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return jsonResponse({ error: 'Ontbrekende Authorization header' }, 401)
    }

    const callerClient = createClient(SUPABASE_URL!, ANON_KEY!, {
      global: { headers: { Authorization: authHeader } },
    })

    const { data: userData, error: userError } = await callerClient.auth.getUser()
    if (userError || !userData?.user) {
      return jsonResponse({ error: 'Ongeldige sessie' }, 401)
    }

    const { data: callerProfile, error: profileError } = await callerClient
      .from('profiles')
      .select('role')
      .eq('id', userData.user.id)
      .single()

    if (profileError || !TOEGESTANE_ROLLEN.includes(callerProfile?.role)) {
      return jsonResponse({ error: 'Onvoldoende rechten om deze actie uit te voeren' }, 403)
    }

    const body = await req.json()

    if (body.action === 'strategie') {
      const vacaturetekst = String(body.vacaturetekst ?? '').trim()
      const vacatureId = String(body.vacatureId ?? '').trim()
      if (!vacaturetekst) {
        return jsonResponse({ error: 'vacaturetekst is verplicht' }, 400)
      }
      // Postcode uit Bullhorn (vacature-adres, anders bedrijfsadres) gaat voor
      // op wat Claude uit de tekst haalt. Mislukt Bullhorn, dan blijft de
      // tekst-postcode staan en vult de consultant zo nodig zelf aan.
      const locatieVerzoek: Promise<VacatureLocatie | null> = /^\d+$/.test(vacatureId)
        ? getVacatureLocatie(createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!), Number(vacatureId)).catch((err) => {
            console.error('[extern-zoeken] Bullhorn-locatie ophalen mislukt:', err)
            return null
          })
        : Promise.resolve(null)
      const [{ strategie, kostenUsd }, locatie] = await Promise.all([
        maakStrategie(vacaturetekst, vacatureId),
        locatieVerzoek,
      ])
      if (locatie?.postcode) {
        strategie.postcode = locatie.postcode
        if (locatie.plaats) strategie.vestigingsplaats = locatie.plaats
        strategie.postcode_bron = locatie.bron!
      } else {
        strategie.postcode_bron = strategie.postcode?.trim() ? 'tekst' : null
      }
      return jsonResponse({ strategie, kostenUsd, model: CLAUDE_MODEL })
    }

    return jsonResponse({ error: `Onbekende actie: ${body.action}` }, 400)
  } catch (err) {
    console.error('[extern-zoeken]', err)
    return jsonResponse({ error: err instanceof Error ? err.message : 'Onbekende fout' }, 500)
  }
})
