import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

serve(async (req) => {
  // Permitir preflight de CORS
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Método no permitido" }), {
      status: 405,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
      },
    });
  }

  // Obtener el cuerpo recibido y reenviarlo al backend en Render
  const body = await req.json();

  // URL de la API en Render
  const renderApiUrl = "https://scraper-rama-judicial.onrender.com/api/consulta";

  try {
    const fetchRes = await fetch(renderApiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await fetchRes.text();

    return new Response(data, {
      status: fetchRes.status,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
      },
    });
  } catch (e) {
    console.error("Error consultando backend:", e);
    return new Response(
      JSON.stringify({ error: "Error consultando backend", detalles: String(e) }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      }
    );
  }
});
