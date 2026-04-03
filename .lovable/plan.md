

# Plan: Proxy CPNU sync calls through a backend function

## Problem

The CPNU API calls from the browser fail with `TypeError: Failed to fetch` — this is a **CORS issue**. The Google Cloud Run service at `cpnu-read-api-486431576619.us-central1.run.app` does not include the necessary `Access-Control-Allow-Origin` headers for the Lovable preview domain, so the browser blocks the preflight `OPTIONS` request.

## Solution

Route CPNU sync calls through a Supabase Edge Function that acts as a proxy. The edge function runs server-side, so CORS does not apply.

## Changes

### 1. New Edge Function: `supabase/functions/cpnu-sync/index.ts`

- Accepts POST with body `{ action: "pausar"|"reactivar"|"cerrar"|"eliminar", workItemId: string, razon?: string }`
- Maps action to the correct PATCH endpoint on `CPNU_API_BASE`
- Forwards the request server-side and returns the result
- No JWT verification needed (fire-and-forget from authenticated UI)

### 2. Update `src/lib/services/cpnu-sync-service.ts`

- Replace direct `fetch` to CPNU API with a call to the edge function
- Use `supabase.functions.invoke("cpnu-sync", { body: { action, workItemId, razon } })`
- Keep the same public API (`syncCpnuPausar`, `syncCpnuReactivar`, etc.)

### 3. No other files change

The callers (`WorkItemMonitoringControls`, `WorkItemMonitoringToggle`, `OverviewTab`, `work-item-delete-service`) already call the sync functions correctly — only the transport layer changes.

