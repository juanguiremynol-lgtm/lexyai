/**
 * Client-side helper that replaces direct fetches to the Andromeda Read API.
 *
 * All GET calls to the read-api MUST go through the `andromeda-proxy`
 * edge function, which enforces tenant scoping and injects the upstream
 * API key. Never call `ANDROMEDA_API_BASE` from the browser.
 */

import { supabase } from "@/integrations/supabase/client";

export interface AndromedaProxyResponse<T = unknown> {
  ok: boolean;
  status?: number;
  body?: T;
  error?: string;
}

export async function andromedaProxy<T = unknown>(
  path: string,
  query?: Record<string, string | number | undefined | null>,
): Promise<AndromedaProxyResponse<T>> {
  const cleanQuery: Record<string, string | number> = {};
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== "") cleanQuery[k] = v as string | number;
    }
  }
  const { data, error } = await supabase.functions.invoke("andromeda-proxy", {
    body: { path, query: cleanQuery },
  });
  if (error) {
    return { ok: false, error: error.message || "proxy_error" };
  }
  return (data || { ok: false, error: "empty_response" }) as AndromedaProxyResponse<T>;
}