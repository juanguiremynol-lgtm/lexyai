import { createClient } from "npm:@supabase/supabase-js@2";

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
  client_id?: string | null;
  rows: ImportRow[];
}

interface RowResult {
  row_index: number;
  radicado_raw: string;
  radicado_norm: string;
  status: "IMPORTED" | "UPDATED" | "SKIPPED" | "INVALID";
  reason: string | null;
  process_id?: string;
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

    const { file_name, file_hash, client_id, rows } = payload;

    if (!rows || !Array.isArray(rows)) {
      return errorResponse("VALIDATION_ERROR", "rows must be an array", 400);
    }

    if (rows.length === 0) {
      return errorResponse("VALIDATION_ERROR", "No rows provided", 400);
    }

    // If client_id provided, verify it belongs to user
    if (client_id) {
      const { data: clientData, error: clientError } = await supabase
        .from("clients")
        .select("id")
        .eq("id", client_id)
        .eq("owner_id", user.id)
        .maybeSingle();
      
      if (clientError || !clientData) {
        console.warn(`[icarus-import-excel] Client ${client_id} not found or not owned by user`);
        // Don't fail, just proceed without client
      }
    }

    console.log(`[icarus-import-excel] Starting import for user ${user.id}: ${rows.length} rows from ${file_name}${client_id ? ` (client: ${client_id})` : ''}`);

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
    const importedProcessIds: string[] = [];
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

      // Check if work item already exists for this user
      const { data: existing } = await supabase
        .from("work_items")
        .select("id, last_action_date, client_id")
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
        workflow_type: 'GENERIC',
        source: 'icarus_import',
        source_run_id: runId,
        source_payload: {
          radicado_raw: row.radicado_raw,
          imported_at: new Date().toISOString(),
        },
        monitoring_enabled: true,
        owner_id: user.id,
        // Set client_id for new processes
        client_id: client_id || null,
      };

      if (existing) {
        // Update existing work item - only update client_id if not already set
        const updateData: Record<string, unknown> = {
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
        };

        // Only update client_id if work item doesn't have one and we're providing one
        if (!existing.client_id && client_id) {
          updateData.client_id = client_id;
        }

        const { error: updateError } = await supabase
          .from("monitored_processes")
          .update(updateData)
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
            process_id: existing.id,
          });
          rowsUpdated++;
        }
      } else {
        // Insert new work item
        const { data: insertedData, error: insertError } = await supabase
          .from("work_items")
          .insert(processData)
          .select("id")
          .single();

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
            process_id: insertedData?.id,
          });
          if (insertedData?.id) {
            importedProcessIds.push(insertedData.id);
          }
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

    console.log(`[icarus-import-excel] Import complete: ${rowsImported} imported, ${rowsUpdated} updated, ${rowsSkipped} skipped${client_id ? ` (linked to client ${client_id})` : ''}`);

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
      imported_process_ids: importedProcessIds,
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
