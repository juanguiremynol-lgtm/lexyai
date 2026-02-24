import { useState, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type {
  MasterSyncConfig,
  MasterSyncState,
  ItemSyncResult,
  WorkItemPreview,
} from "./types";
import { DEFAULT_CONFIG, HEAVY_ITEM_THRESHOLD } from "./types";

const DELAY_BETWEEN_BATCHES_MS = 500;

function emptyResult(item: WorkItemPreview, includePublicaciones: boolean): ItemSyncResult {
  return {
    work_item_id: item.id,
    radicado: item.radicado,
    workflow_type: item.workflow_type,
    stage: item.stage,
    act_status: "pending",
    act_ok: null,
    act_inserted: 0,
    act_skipped: 0,
    act_provider: null,
    act_latency_ms: null,
    act_error_code: null,
    act_error_message: null,
    act_provider_attempts: [],
    act_raw_response: null,
    pub_status: includePublicaciones ? "pending" : "not_applicable",
    pub_ok: null,
    pub_inserted: 0,
    pub_skipped: 0,
    pub_latency_ms: null,
    pub_error_message: null,
    pub_raw_response: null,
    started_at: null,
    completed_at: null,
    total_ms: null,
  };
}

async function syncItem(
  item: WorkItemPreview,
  idx: number,
  results: ItemSyncResult[],
  config: MasterSyncConfig,
) {
  const itemStart = Date.now();
  try {
    const actStart = Date.now();
    const actResult = await supabase.functions.invoke("sync-by-work-item", {
      body: { work_item_id: item.id, force_refresh: config.forceRefresh || false },
    });
    const actData = actResult.data;
    results[idx].act_ok = actData?.ok === true;
    results[idx].act_status = actData?.ok 
      ? (actData?.code === 'PROVIDER_EMPTY_RESULT' ? "empty" : "success") 
      : "error";
    results[idx].act_inserted = actData?.inserted_count || 0;
    results[idx].act_skipped = actData?.skipped_count || 0;
    results[idx].act_provider = actData?.provider_used || null;
    results[idx].act_latency_ms = Date.now() - actStart;
    results[idx].act_error_code = actData?.code || null;
    results[idx].act_error_message = actData?.ok
      ? null
      : actData?.message || actResult.error?.message || "Unknown";
    results[idx].act_provider_attempts = actData?.provider_attempts || [];
    results[idx].act_raw_response = actData;

    if (config.includePublicaciones) {
      const pubStart = Date.now();
      const pubResult = await supabase.functions.invoke(
        "sync-publicaciones-by-work-item",
        { body: { work_item_id: item.id } },
      );
      const pubData = pubResult.data;
      results[idx].pub_ok = pubData?.ok === true;
      // Classify pub status: check for errors array even if ok=true
      const pubErrors = pubData?.errors || [];
      const hasErrors = pubErrors.length > 0 && pubErrors.some((e: string) => e.length > 0);
      if (hasErrors && !pubData?.ok) {
        results[idx].pub_status = "partial_error";
      } else if (hasErrors && pubData?.ok) {
        results[idx].pub_status = "success"; // Some errors but ok=true means partial success
      } else {
        results[idx].pub_status = pubData?.ok ? "success" : "error";
      }
      results[idx].pub_inserted = pubData?.inserted_count || 0;
      results[idx].pub_skipped = pubData?.skipped_count || 0;
      results[idx].pub_latency_ms = Date.now() - pubStart;
      results[idx].pub_error_message = pubData?.ok
        ? null
        : pubData?.message || pubResult.error?.message || "Unknown";
      results[idx].pub_raw_response = pubData;
    }
  } catch (err: any) {
    results[idx].act_status = "error";
    results[idx].act_error_code = "INVOCATION_FAILED";
    results[idx].act_error_message = err?.message || "Edge function invocation failed";
    results[idx].act_raw_response = { error: err?.message };
    if (config.includePublicaciones) {
      results[idx].pub_status = "skipped";
    }
  }
  results[idx].completed_at = new Date().toISOString();
  results[idx].total_ms = Date.now() - itemStart;
}

export function useMasterSync() {
  const [config, setConfig] = useState<MasterSyncConfig>(DEFAULT_CONFIG);
  const [state, setState] = useState<MasterSyncState>({
    status: "idle",
    items: [],
    startedAt: null,
    completedAt: null,
    currentBatch: 0,
    totalBatches: 0,
    totalItems: 0,
    completedItems: 0,
    successCount: 0,
    errorCount: 0,
    totalActInserted: 0,
    totalPubInserted: 0,
  });
  const [preview, setPreview] = useState<WorkItemPreview[] | null>(null);
  const [geminiAnalysis, setGeminiAnalysis] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [traces, setTraces] = useState<any[] | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchPreview = useCallback(async () => {
    setState((s) => ({ ...s, status: "loading_items" }));

    let query = (supabase.from("work_items") as any)
      .select(
        "id, radicado, workflow_type, stage, monitoring_enabled, last_synced_at, last_crawled_at, scrape_status, authority_name, total_actuaciones",
      )
      .eq("organization_id", config.organizationId)
      .not("radicado", "is", null)
      .in("workflow_type", config.workflowFilter);

    if (config.scope === "MONITORING_ONLY") {
      query = query.eq("monitoring_enabled", true);
    } else if (config.scope === "FAILED_ONLY") {
      query = query.or("scrape_status.eq.FAILED,last_synced_at.is.null");
    }

    const { data, error } = await query.order("last_synced_at", {
      ascending: true,
      nullsFirst: true,
    });

    if (error) {
      console.error("[MasterSync] Preview query error:", error.message);
      setState((s) => ({ ...s, status: "idle" }));
      return;
    }

    setPreview(data || []);
    setState((s) => ({ ...s, status: "previewing" }));
  }, [config]);

  const execute = useCallback(async () => {
    if (!preview || preview.length === 0) return;

    const controller = new AbortController();
    abortRef.current = controller;

    const results: ItemSyncResult[] = preview.map((item) =>
      emptyResult(item, config.includePublicaciones),
    );

    // Split into normal and heavy items
    const normalIndices: number[] = [];
    const heavyIndices: number[] = [];
    preview.forEach((item, idx) => {
      if ((item.total_actuaciones || 0) >= HEAVY_ITEM_THRESHOLD) {
        heavyIndices.push(idx);
      } else {
        normalIndices.push(idx);
      }
    });

    const totalItems = preview.length;
    const BATCH_SIZE = config.batchSize || 3;
    const normalBatches = Math.ceil(normalIndices.length / BATCH_SIZE);
    const totalBatches = normalBatches + heavyIndices.length;

    setState({
      status: "running",
      items: [...results],
      startedAt: new Date().toISOString(),
      completedAt: null,
      currentBatch: 0,
      totalBatches,
      totalItems,
      completedItems: 0,
      successCount: 0,
      errorCount: 0,
      totalActInserted: 0,
      totalPubInserted: 0,
    });

    let batchNum = 0;

    // === Process NORMAL items in parallel batches ===
    for (let i = 0; i < normalIndices.length; i += BATCH_SIZE) {
      if (controller.signal.aborted) break;

      const batchIdxs = normalIndices.slice(i, i + BATCH_SIZE);
      batchIdxs.forEach((idx) => {
        results[idx].act_status = "running";
        results[idx].started_at = new Date().toISOString();
      });

      batchNum++;
      updateState(results, batchNum, totalBatches, totalItems);

      await Promise.allSettled(
        batchIdxs.map((idx) => syncItem(preview[idx], idx, results, config)),
      );

      updateState(results, batchNum, totalBatches, totalItems);

      if (i + BATCH_SIZE < normalIndices.length && !controller.signal.aborted) {
        await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_BATCHES_MS));
      }
    }

    // === Process HEAVY items sequentially (act then pub with separate timeouts) ===
    for (const idx of heavyIndices) {
      if (controller.signal.aborted) break;

      batchNum++;
      results[idx].act_status = "running";
      results[idx].started_at = new Date().toISOString();
      updateState(results, batchNum, totalBatches, totalItems);

      const item = preview[idx];
      const itemStart = Date.now();

      try {
        // Step 1: Actuaciones (may take 60-120s for 399+ items)
        const actStart = Date.now();
        const actResult = await supabase.functions.invoke("sync-by-work-item", {
          body: { work_item_id: item.id, force_refresh: config.forceRefresh || false },
        });
        const actData = actResult.data;
        results[idx].act_ok = actData?.ok === true;
        results[idx].act_status = actData?.ok 
          ? (actData?.code === 'PROVIDER_EMPTY_RESULT' ? "empty" : "success") 
          : "error";
        results[idx].act_inserted = actData?.inserted_count || 0;
        results[idx].act_skipped = actData?.skipped_count || 0;
        results[idx].act_provider = actData?.provider_used || null;
        results[idx].act_latency_ms = Date.now() - actStart;
        results[idx].act_error_code = actData?.code || null;
        results[idx].act_error_message = actData?.ok
          ? null
          : actData?.message || actResult.error?.message || "Unknown";
        results[idx].act_provider_attempts = actData?.provider_attempts || [];
        results[idx].act_raw_response = actData;

        // Step 2: Publicaciones (separate invocation with fresh timeout)
        if (config.includePublicaciones) {
          // Delay to let edge function cold start settle after heavy act sync
          await new Promise((resolve) => setTimeout(resolve, 1500));

          const pubStart = Date.now();
          const pubResult = await supabase.functions.invoke(
            "sync-publicaciones-by-work-item",
            { body: { work_item_id: item.id } },
          );
          const pubData = pubResult.data;
          results[idx].pub_ok = pubData?.ok === true;
          const pubErrors = pubData?.errors || [];
          const hasErrors = pubErrors.length > 0 && pubErrors.some((e: string) => e.length > 0);
          if (hasErrors && !pubData?.ok) {
            results[idx].pub_status = "partial_error";
          } else if (hasErrors && pubData?.ok) {
            results[idx].pub_status = "success";
          } else {
            results[idx].pub_status = pubData?.ok ? "success" : "error";
          }
          results[idx].pub_inserted = pubData?.inserted_count || 0;
          results[idx].pub_skipped = pubData?.skipped_count || 0;
          results[idx].pub_latency_ms = Date.now() - pubStart;
          results[idx].pub_error_message = pubData?.ok
            ? null
            : pubData?.message || pubResult.error?.message || "Unknown";
          results[idx].pub_raw_response = pubData;
        }
      } catch (err: any) {
        results[idx].act_status = "error";
        results[idx].act_error_code = "INVOCATION_FAILED";
        results[idx].act_error_message = err?.message || "Edge function invocation failed";
        results[idx].act_raw_response = { error: err?.message };
        if (config.includePublicaciones) {
          results[idx].pub_status = "skipped";
        }
      }

      results[idx].completed_at = new Date().toISOString();
      results[idx].total_ms = Date.now() - itemStart;
      updateState(results, batchNum, totalBatches, totalItems);

      if (!controller.signal.aborted) {
        await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_BATCHES_MS));
      }
    }

    setState((prev) => ({
      ...prev,
      status: controller.signal.aborted ? "cancelled" : "completed",
      completedAt: new Date().toISOString(),
      items: [...results],
    }));

    // Fetch recent sync traces
    try {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { data: traceData } = await (supabase.from("sync_traces") as any)
        .select(
          "work_item_id, step, provider, http_status, latency_ms, success, error_code, message, meta, created_at",
        )
        .eq("organization_id", config.organizationId)
        .gte("created_at", oneHourAgo)
        .order("created_at", { ascending: false })
        .limit(200);
      setTraces(traceData || []);
    } catch {
      setTraces([]);
    }
  }, [preview, config]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const analyzeWithGemini = useCallback(
    async (prompt: string) => {
      setIsAnalyzing(true);
      setGeminiAnalysis(null);
      try {
        const { data, error } = await supabase.functions.invoke("master-sync-analysis", {
          body: { prompt },
        });
        if (error) throw error;
        setGeminiAnalysis(data?.analysis || "No se pudo generar el análisis.");
      } catch (err: any) {
        console.error("[MasterSync] Gemini analysis error:", err);
        setGeminiAnalysis(`Error al generar análisis: ${err?.message || "desconocido"}`);
      } finally {
        setIsAnalyzing(false);
      }
    },
    [],
  );

  const reset = useCallback(() => {
    setState({
      status: "idle",
      items: [],
      startedAt: null,
      completedAt: null,
      currentBatch: 0,
      totalBatches: 0,
      totalItems: 0,
      completedItems: 0,
      successCount: 0,
      errorCount: 0,
      totalActInserted: 0,
      totalPubInserted: 0,
    });
    setPreview(null);
    setGeminiAnalysis(null);
    setTraces(null);
  }, []);

  function updateState(
    results: ItemSyncResult[],
    currentBatch: number,
    totalBatches: number,
    totalItems: number,
  ) {
    const completed = results.filter(
      (r) => r.act_status === "success" || r.act_status === "error" || r.act_status === "empty",
    );
    setState((prev) => ({
      ...prev,
      items: [...results],
      currentBatch,
      totalBatches,
      totalItems,
      completedItems: completed.length,
      successCount: results.filter((r) => r.act_ok === true).length,
      errorCount: results.filter((r) => r.act_status === "error").length,
      totalActInserted: results.reduce((s, r) => s + r.act_inserted, 0),
      totalPubInserted: results.reduce((s, r) => s + r.pub_inserted, 0),
    }));
  }

  return {
    config,
    setConfig,
    state,
    preview,
    geminiAnalysis,
    isAnalyzing,
    traces,
    fetchPreview,
    execute,
    cancel,
    analyzeWithGemini,
    reset,
  };
}
