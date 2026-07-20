// Edge Function: admin-users
//
// Bundelt de twee admin-acties die de Supabase admin-API (dus de
// service_role-sleutel) vereisen en die daarom nooit vanuit de browser
// rechtstreeks mogen gebeuren:
//   - action "create": een nieuw auth-account aanmaken (met wachtwoord)
//   - action "delete": een auth-account permanent verwijderen
//
// SUPABASE_URL, SUPABASE_ANON_KEY en SUPABASE_SERVICE_ROLE_KEY worden door
// het platform automatisch als env-vars meegegeven aan elke Edge Function —
// die hoeven hier niet handmatig geconfigureerd te worden.
//
// Iedere aanroep wordt eerst geverifieerd met de JWT van de aanroeper (via
// een client die alleen de anon-key + die JWT gebruikt, dus onder normale
// RLS): alleen als dat profiel role = 'admin' heeft, gaat de functie verder
// met de service-role-client. Zonder die check zou een niet-admin de
// Edge Function rechtstreeks kunnen aanroepen en zo de RLS volledig
// omzeilen, want de functie zelf draait altijd met volledige rechten.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

// Los Supabase-project (burg-jobs) waar Mijn Omgeving zijn recruitment-data
// vandaan haalt (zie src/lib/burgJobsClient.js) — moet HANDMATIG als secret
// gezet worden via `supabase secrets set`, wordt niet automatisch meegegeven
// zoals de drie env-vars hierboven. Service-role nodig omdat `employees`
// geen INSERT-policy voor anon/authenticated heeft.
const BURG_JOBS_URL = Deno.env.get('BURG_JOBS_URL')
const BURG_JOBS_SERVICE_ROLE_KEY = Deno.env.get('BURG_JOBS_SERVICE_ROLE_KEY')

// Vaste defaults voor een nieuwe employees-rij — bewust hetzelfde als de
// `determineSeniority()`-stub in de v2-client (altijd 'medior') en een
// full-time fte_hours; via het Adminpaneel is hier nu geen invoerveld voor,
// dus dit is een startpunt dat later handmatig bijgesteld kan worden.
const DEFAULT_FTE_HOURS = 40
const DEFAULT_SENIORITY_LEVELS = ['medior']

function getBurgJobsAdmin() {
  if (!BURG_JOBS_URL || !BURG_JOBS_SERVICE_ROLE_KEY) {
    console.warn('[admin-users] BURG_JOBS_URL/BURG_JOBS_SERVICE_ROLE_KEY ontbreken, employees-rij niet gewijzigd.')
    return null
  }
  return createClient(BURG_JOBS_URL, BURG_JOBS_SERVICE_ROLE_KEY)
}

/**
 * Zet best-effort (nooit blokkerend voor account-aanmaak) een rij in de
 * burg-jobs `employees`-tabel, zodat een nieuw v2-account meteen meedoet in
 * Mijn Omgeving (aanwezigheid/swipe-verdeling) zonder handmatige Supabase-
 * stap. `email` is UNIQUE in die tabel, dus een reeds bestaande medewerker
 * (upsert met ignoreDuplicates) wordt overgeslagen i.p.v. overschreven.
 */
async function addBurgJobsEmployee(email, naam) {
  const burgJobsAdmin = getBurgJobsAdmin()
  if (!burgJobsAdmin) return

  const name = naam || email.split('@')[0]

  const { error } = await burgJobsAdmin
    .from('employees')
    .upsert(
      { name, email, fte_hours: DEFAULT_FTE_HOURS, seniority_levels: DEFAULT_SENIORITY_LEVELS },
      { onConflict: 'email', ignoreDuplicates: true },
    )

  if (error) {
    console.warn('[admin-users] employees-rij aanmaken mislukt:', error.message)
  }
}

/**
 * Tegenhanger van addBurgJobsEmployee: verwijdert best-effort de employees-
 * rij bij permanente account-verwijdering, zodat de aanwezigheidskaart in
 * Mijn Omgeving in sync blijft met de actieve gebruikers in het Adminpaneel.
 * Alleen aangeroepen bij "delete" (permanent), niet bij het (de)activeren
 * van een account — een gedeactiveerd account blijft gewoon een medewerker.
 */
async function removeBurgJobsEmployee(email) {
  const burgJobsAdmin = getBurgJobsAdmin()
  if (!burgJobsAdmin) return

  const { error } = await burgJobsAdmin.from('employees').delete().eq('email', email)

  if (error) {
    console.warn('[admin-users] employees-rij verwijderen mislukt:', error.message)
  }
}

// Zonder deze headers blokkeert de browser het verzoek al bij de
// CORS-preflight (OPTIONS), vóórdat de functie ooit wordt bereikt —
// supabase-js meldt dat dan als een generieke "Failed to send a request
// to the Edge Function", zonder verdere details.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResponse(body, status = 200) {
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

    // Client met de JWT van de aanroeper — normale RLS is hier van
    // toepassing, dus dit levert alleen het eigen profiel op.
    const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
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

    if (profileError || callerProfile?.role !== 'admin') {
      return jsonResponse({ error: 'Alleen admins mogen deze actie uitvoeren' }, 403)
    }

    const body = await req.json()
    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

    if (body.action === 'create') {
      const { email, password, naam, role, yieldTeltMee, yieldSinds } = body

      if (!email || !password) {
        return jsonResponse({ error: 'E-mail en wachtwoord zijn verplicht' }, 400)
      }

      const { data: created, error: createError } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      })

      if (createError) {
        return jsonResponse({ error: createError.message }, 400)
      }

      // handle_new_user() trigger heeft de profiles-rij al aangemaakt met
      // rol 'user'. Rol/naam hier direct bijwerken via de service-role-
      // client — change_user_role() kan hier niet gebruikt worden omdat
      // die RPC auth.uid() van de AANROEPER verwacht, en die context is er
      // niet via de service-role-client. De admin-check is hierboven al
      // gedaan, dus een directe update is hier veilig.
      const updates = {}
      if (role && role !== 'user') updates.role = role
      if (naam) updates.naam = naam
      if (yieldTeltMee) updates.yield_telt_mee = true
      if (yieldSinds) updates.yield_sinds = yieldSinds

      if (Object.keys(updates).length > 0) {
        await adminClient.from('profiles').update(updates).eq('id', created.user.id)
      }

      await addBurgJobsEmployee(email, naam)

      return jsonResponse({ success: true, userId: created.user.id })
    }

    if (body.action === 'delete') {
      const { targetId } = body

      if (!targetId) {
        return jsonResponse({ error: 'targetId is verplicht' }, 400)
      }

      if (targetId === userData.user.id) {
        return jsonResponse({ error: 'Je kunt jezelf niet verwijderen' }, 400)
      }

      const { data: targetProfile } = await adminClient
        .from('profiles')
        .select('role, email')
        .eq('id', targetId)
        .single()

      if (targetProfile?.role === 'admin') {
        const { data: admins } = await adminClient.from('profiles').select('id').eq('role', 'admin')
        if ((admins?.length ?? 0) <= 1) {
          return jsonResponse({ error: 'Kan de laatste admin niet verwijderen' }, 400)
        }
      }

      const { error: deleteError } = await adminClient.auth.admin.deleteUser(targetId)
      if (deleteError) {
        return jsonResponse({ error: deleteError.message }, 400)
      }

      if (targetProfile?.email) {
        await removeBurgJobsEmployee(targetProfile.email)
      }

      return jsonResponse({ success: true })
    }

    return jsonResponse({ error: 'Onbekende actie' }, 400)
  } catch (err) {
    return jsonResponse({ error: err?.message ?? 'Onbekende fout' }, 500)
  }
})
