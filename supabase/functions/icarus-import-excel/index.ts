import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ImportRow {
  radicado_raw: string;
  radicado_norm: string;
  despacho: string;
  distrito: string;
  juez_ponente: string;
  demandantes: string;
  demandados: string;
  last_action_date_raw: string;
  last_action_date_iso: string | null;
}

interface ImportRequest {
  file_name: string;
  file_hash: string;
  rows: ImportRow[];
}

interface RowResult {
  row_index: number;
  radicado_raw: string;
  radicado_norm: string;
  status: "IMPORTED" | "UPDATED" | "SKIPPED" | "INVALID";
  reason: string | null;
}

function jsonResponse(data: object, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(code: string, message: string, status: number = 400): Response {
  return jsonResponse({
    ok: false,
    code,
    message,
    timestamp: new Date().toISOString(),
  }, status);
}

function validateRadicado(radicadoNorm: string): { valid: boolean; error: string | null } {
  if (!radicadoNorm) {
    return { valid: false, error: "Radicado vacío" };
  }
  if (radicadoNorm.length !== 23) {
    return { valid: false, error: `Longitud incorrecta: ${radicadoNorm.length}` };
  }
  return { valid: true, error: null };
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Environment validation
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    
    if (!supabaseUrl || !supabaseServiceKey) {
      return errorResponse("MISSING_ENV", "Missing Supabase environment variables", 500);
    }

    // Auth validation
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return errorResponse("UNAUTHORIZED", "Missing Authorization header", 401);
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") || "");
    
    // Verify user
    const { data: { user }, error: authError } = await anonClient.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    
    if (authError || !user) {
      return errorResponse("UNAUTHORIZED", "Invalid or expired token", 401);
    }

    // Parse request body
    let payload: ImportRequest;
    try {
      payload = await req.json();
    } catch {
      return errorResponse("INVALID_JSON", "Could not parse request body", 400);
    }

    const { file_name, file_hash, rows } = payload;

    if (!rows || !Array.isArray(rows)) {
      return errorResponse("VALIDATION_ERROR", "rows must be an array", 400);
    }

    if (rows.length === 0) {
      return errorResponse("VALIDATION_ERROR", "No rows provided", 400);
    }

    console.log(`[icarus-import-excel] Starting import for user ${user.id}: ${rows.length} rows from ${file_name}`);

    // Create import run record
    const { data: importRun, error: runError } = await supabase
      .from("icarus_import_runs")
      .insert({
        owner_id: user.id,
        file_name: file_name || "unknown.xlsx",
        file_hash: file_hash || null,
        rows_total: rows.length,
        status: "PENDING",
      })
      .select()
      .single();

    if (runError || !importRun) {
      console.error("[icarus-import-excel] Failed to create import run:", runError);
      return errorResponse("DB_ERROR", "Failed to create import run", 500);
    }

    const runId = importRun.id;
    const results: RowResult[] = [];
    let rowsValid = 0;
    let rowsImported = 0;
    let rowsUpdated = 0;
    let rowsSkipped = 0;

    // Process each row
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const validation = validateRadicado(row.radicado_norm);

      if (!validation.valid) {
        results.push({
          row_index: i,
          radicado_raw: row.radicado_raw,
          radicado_norm: row.radicado_norm,
          status: "INVALID",
          reason: validation.error,
        });
        rowsSkipped++;
        continue;
      }

      rowsValid++;

      // Check if process already exists for this user
      const { data: existing } = await supabase
        .from("monitored_processes")
        .select("id, last_action_date")
        .eq("owner_id", user.id)
        .eq("radicado", row.radicado_norm)
        .maybeSingle();

      const processData = {
        radicado: row.radicado_norm,
        despacho_name: row.despacho || null,
        department: row.distrito || null,
        demandantes: row.demandantes || null,
        demandados: row.demandados || null,
        juez_ponente: row.juez_ponente || null,
        last_action_date: row.last_action_date_iso || null,
        last_action_date_raw: row.last_action_date_raw || null,
        source: "ICARUS_EXCEL",
        source_run_id: runId,
        source_payload: {
          radicado_raw: row.radicado_raw,
          imported_at: new Date().toISOString(),
        },
        monitoring_enabled: true,
        owner_id: user.id,
      };

      if (existing) {
        // Update existing process
        const { error: updateError } = await supabase
          .from("monitored_processes")
          .update({
            despacho_name: processData.despacho_name || undefined,
            department: processData.department || undefined,
            demandantes: processData.demandantes || undefined,
            demandados: processData.demandados || undefined,
            juez_ponente: processData.juez_ponente || undefined,
            last_action_date: processData.last_action_date || undefined,
            last_action_date_raw: processData.last_action_date_raw || undefined,
            source: processData.source,
            source_run_id: processData.source_run_id,
            source_payload: processData.source_payload,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id);

        if (updateError) {
          console.error(`[icarus-import-excel] Failed to update row ${i}:`, updateError);
          results.push({
            row_index: i,
            radicado_raw: row.radicado_raw,
            radicado_norm: row.radicado_norm,
            status: "SKIPPED",
            reason: updateError.message,
          });
          rowsSkipped++;
        } else {
          results.push({
            row_index: i,
            radicado_raw: row.radicado_raw,
            radicado_norm: row.radicado_norm,
            status: "UPDATED",
            reason: null,
          });
          rowsUpdated++;
        }
      } else {
        // Insert new process
        const { error: insertError } = await supabase
          .from("monitored_processes")
          .insert(processData);

        if (insertError) {
          console.error(`[icarus-import-excel] Failed to insert row ${i}:`, insertError);
          results.push({
            row_index: i,
            radicado_raw: row.radicado_raw,
            radicado_norm: row.radicado_norm,
            status: "SKIPPED",
            reason: insertError.message,
          });
          rowsSkipped++;
        } else {
          results.push({
            row_index: i,
            radicado_raw: row.radicado_raw,
            radicado_norm: row.radicado_norm,
            status: "IMPORTED",
            reason: null,
          });
          rowsImported++;
        }
      }

      // Log row result for diagnostics
      await supabase.from("icarus_import_rows").insert({
        run_id: runId,
        owner_id: user.id,
        row_index: i,
        radicado_raw: row.radicado_raw,
        radicado_norm: row.radicado_norm,
        status: results[results.length - 1].status,
        reason: results[results.length - 1].reason,
        source_payload: row,
      });
    }

    // Update import run with final stats
    const finalStatus = rowsSkipped === rows.length
      ? "ERROR"
      : rowsSkipped > 0
        ? "PARTIAL"
        : "SUCCESS";

    await supabase
      .from("icarus_import_runs")
      .update({
        status: finalStatus,
        rows_valid: rowsValid,
        rows_imported: rowsImported,
        rows_updated: rowsUpdated,
        rows_skipped: rowsSkipped,
      })
      .eq("id", runId);

    console.log(`[icarus-import-excel] Import complete: ${rowsImported} imported, ${rowsUpdated} updated, ${rowsSkipped} skipped`);

    return jsonResponse({
      ok: true,
      run_id: runId,
      status: finalStatus,
      rows_total: rows.length,
      rows_valid: rowsValid,
      rows_imported: rowsImported,
      rows_updated: rowsUpdated,
      rows_skipped: rowsSkipped,
      errors: results.filter(r => r.status === "INVALID" || r.status === "SKIPPED"),
    });

  } catch (error) {
    console.error("[icarus-import-excel] Unexpected error:", error);
    return errorResponse(
      "INTERNAL_ERROR",
      error instanceof Error ? error.message : "Unexpected error",
      500
    );
  }
});
