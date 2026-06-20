import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import {
  fetchFromCpnu,
  fetchFromSamai,
  fetchFromSamaiEstados,
  fetchFromPublicaciones,
  fetchFromTutelas,
} from '../_shared/providerAdapters/index.ts';

// Admin-gated diagnostic: run one provider adapter for one radicado.
// Returns adapter result (status, counts, http status, error) for verification.
// Body: { provider: 'cpnu'|'samai'|'samai_estados'|'publicaciones'|'tutelas', radicado: string }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const authHeader = req.headers.get('Authorization') || '';

  // Auth: caller must be SUPER_ADMIN
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData } = await userClient.auth.getUser();
  if (!userData?.user) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
  const admin = createClient(supabaseUrl, serviceKey);
  const { data: roleRow } = await admin
    .from('user_roles')
    .select('role')
    .eq('user_id', userData.user.id)
    .eq('role', 'SUPER_ADMIN')
    .maybeSingle();
  if (!roleRow) {
    return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  let body: { provider?: string; radicado?: string };
  try { body = await req.json(); } catch { body = {}; }

  const provider = String(body.provider || '').toLowerCase();
  const radicado = String(body.radicado || '').trim();
  if (!provider || !radicado) {
    return new Response(JSON.stringify({ error: 'provider and radicado required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const opts = { radicado, mode: 'monitoring' as const, timeoutMs: 60_000 };
  let result;
  try {
    switch (provider) {
      case 'cpnu': result = await fetchFromCpnu(opts); break;
      case 'samai': result = await fetchFromSamai(opts); break;
      case 'samai_estados': result = await fetchFromSamaiEstados(opts); break;
      case 'publicaciones': result = await fetchFromPublicaciones(opts); break;
      case 'tutelas': result = await fetchFromTutelas(opts); break;
      default:
        return new Response(JSON.stringify({ error: `unknown provider: ${provider}` }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
  } catch (err) {
    return new Response(JSON.stringify({ error: 'adapter threw', message: err instanceof Error ? err.message : String(err) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify({
    provider: result.provider,
    status: result.status,
    httpStatus: result.httpStatus,
    actuaciones_count: result.actuaciones?.length || 0,
    publicaciones_count: result.publicaciones?.length || 0,
    durationMs: result.durationMs,
    errorMessage: result.errorMessage || null,
    metadata: result.metadata,
    sample_actuacion: result.actuaciones?.[0] || null,
    sample_publicacion: result.publicaciones?.[0] || null,
  }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});