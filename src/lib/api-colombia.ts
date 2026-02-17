import { supabase } from "@/integrations/supabase/client";

const API_BASE = "https://api-colombia.com";

/**
 * Fetches data from api-colombia.com.
 * First tries direct fetch; if CORS blocks it, falls back to edge function proxy.
 */
export async function fetchApiColombia<T>(path: string): Promise<T> {
  // Try direct first
  try {
    const directRes = await fetch(`${API_BASE}${path}`, {
      headers: { Accept: "application/json" },
    });
    if (directRes.ok) {
      return directRes.json();
    }
  } catch {
    // CORS or network error — fall through to proxy
  }

  // Fallback: edge function proxy
  const { data: { session } } = await supabase.auth.getSession();

  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/api-colombia-proxy?path=${encodeURIComponent(path)}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  };

  if (session?.access_token) {
    headers["Authorization"] = `Bearer ${session.access_token}`;
  }

  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Error al consultar la API (${res.status})`);
  return res.json();
}
