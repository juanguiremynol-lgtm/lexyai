import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// New Rama Judicial API (with advanced search enabled)
const RENDER_API_BASE = "https://rama-judicial-api.onrender.com";
const TIMEOUT_MS = 45000; // 45 second timeout

serve(async (req) => {
  // Permitir preflight de CORS
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/scraper-proxy/, "");

  try {
    // Handle GET requests (for /buscar and /resultado endpoints)
    if (req.method === "GET") {
      const targetUrl = `${RENDER_API_BASE}${path}${url.search}`;
      console.log(`🔍 Proxy GET: ${targetUrl}`);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

      try {
        const fetchRes = await fetch(targetUrl, {
          method: "GET",
          headers: { "Accept": "application/json" },
          signal: controller.signal,
        });
        clearTimeout(timeout);

        const data = await fetchRes.text();
        return new Response(data, {
          status: fetchRes.status,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      } catch (fetchError) {
        clearTimeout(timeout);
        const errorMessage = fetchError instanceof Error ? fetchError.message : String(fetchError);
        
        if (errorMessage.includes("abort")) {
          return new Response(JSON.stringify({ 
            success: false, 
            error: "TIMEOUT",
            mensaje: "La consulta tardó más de 45 segundos"
          }), {
            status: 504,
            headers: { "Content-Type": "application/json", ...corsHeaders },
          });
        }
        throw fetchError;
      }
    }

    // Handle POST requests (legacy compatibility)
    if (req.method === "POST") {
      const body = await req.json();
      const targetUrl = `${RENDER_API_BASE}/buscar?numero_radicacion=${body.radicado || body.numero_radicacion || ""}`;
      console.log(`🔍 Proxy POST → GET: ${targetUrl}`);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

      try {
        const fetchRes = await fetch(targetUrl, {
          method: "GET",
          headers: { "Accept": "application/json" },
          signal: controller.signal,
        });
        clearTimeout(timeout);

        const data = await fetchRes.text();
        return new Response(data, {
          status: fetchRes.status,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      } catch (fetchError) {
        clearTimeout(timeout);
        const errorMessage = fetchError instanceof Error ? fetchError.message : String(fetchError);
        
        if (errorMessage.includes("abort")) {
          return new Response(JSON.stringify({ 
            success: false, 
            error: "TIMEOUT",
            mensaje: "La consulta tardó más de 45 segundos"
          }), {
            status: 504,
            headers: { "Content-Type": "application/json", ...corsHeaders },
          });
        }
        throw fetchError;
      }
    }

    return new Response(JSON.stringify({ error: "Método no permitido" }), {
      status: 405,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });

  } catch (e) {
    console.error("Error en scraper-proxy:", e);
    return new Response(JSON.stringify({ 
      success: false,
      error: "NETWORK_ERROR", 
      mensaje: "Error consultando Rama Judicial API",
      detalles: String(e) 
    }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
});
