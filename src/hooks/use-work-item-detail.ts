/**
 * useWorkItemDetail - Consolidated hook for fetching complete work item data
 * 
 * Fetches the full graph of work item data including:
 * - Core work item data (from work_items or legacy tables)
 * - Client and matter relations
 * - Actuaciones (acts)
 * - Documents
 * - Tasks and alerts
 */

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { andromedaProxy } from "@/lib/andromeda-proxy";
import type { AndromedaSyncMap } from "@/hooks/useAndromedaRadicado";

interface WorkItemDetail {
  id: string;
  owner_id: string;
  workflow_type: string;
  stage: string;
  status: string;
  cgp_phase: string | null;
  cgp_phase_source: string | null;
  source: string;
  source_reference: string | null;
  source_payload: Record<string, unknown> | null;
  client_id: string | null;
  matter_id: string | null;
  radicado: string | null;
  radicado_verified: boolean;
  tutela_code: string | null;
  authority_name: string | null;
  authority_email: string | null;
  authority_city: string | null;
  authority_department: string | null;
  demandantes: string | null;
  demandados: string | null;
  title: string | null;
  description: string | null;
  notes: string | null;
  auto_admisorio_date: string | null;
  filing_date: string | null;
  last_action_date: string | null;
  last_action_description: string | null;
  is_flagged: boolean;
  monitoring_enabled: boolean;
  monitoring_disabled_reason: string | null;
  monitoring_disabled_by: string | null;
  monitoring_disabled_at: string | null;
  monitoring_disabled_meta: Record<string, unknown> | null;
  email_linking_enabled: boolean;
  expediente_url: string | null;
  sharepoint_url: string | null;
  onedrive_url: string | null;
  acta_radicacion_url: string | null;
  auto_admisorio_url: string | null;
  scrape_status: string;
  last_synced_at: string | null;
  last_checked_at: string | null;
  last_crawled_at: string | null;
  scraped_fields: Record<string, unknown> | null;
  total_actuaciones: number;
  ponente: string | null;
  origen: string | null;
  clase_proceso: string | null;
  etapa: string | null;
  ubicacion_expediente: string | null;
  formato_expediente: string | null;
  tipo_proceso: string | null;
  fecha_radicado: string | null;
  fecha_sentencia: string | null;
  total_sujetos_procesales: number | null;
  subclase_proceso: string | null;
  corte_status: string | null;
  sentencia_ref: string | null;
  provider_sources: Record<string, unknown> | null;
  milestones_cleared_at: string | null;
  milestones_cleared_status: string | null;
  // Courthouse email resolution fields
  courthouse_directory_id: number | null;
  resolved_email: string | null;
  resolution_method: string | null;
  resolution_confidence: number | null;
  courthouse_needs_review: boolean | null;
  resolution_candidates: unknown[] | null;
  resolved_at: string | null;
  raw_courthouse_input: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  clients: { id: string; name: string } | null;
  matters: { id: string; matter_name: string; practice_area?: string; sharepoint_url?: string } | null;
  _source: string;
  // Andromeda Read API enrichment
  sync?: AndromedaSyncMap | null;
  api_work_item_id?: string | null;
}

async function fetchWorkItem(id: string): Promise<WorkItemDetail | null> {
  // 1. Try work_items table first
  const { data: workItemData } = await supabase
    .from("work_items")
    .select(`
      *,
      clients(id, name),
      matters(id, matter_name, practice_area, sharepoint_url)
    `)
    .eq("id", id)
    .maybeSingle();

  if (workItemData) {
    return { ...workItemData, _source: "work_items" } as unknown as WorkItemDetail;
  }

  // 2. Try legacy cgp_items table
  const { data: cgpData } = await supabase
    .from("cgp_items")
    .select(`
      *,
      client:clients(id, name),
      matter:matters(id, matter_name, practice_area, sharepoint_url)
    `)
    .eq("id", id)
    .maybeSingle();

  if (cgpData) {
    return {
      id: cgpData.id,
      owner_id: cgpData.owner_id,
      workflow_type: "CGP",
      stage: cgpData.filing_status || cgpData.process_phase || "DRAFTED",
      status: cgpData.status || "ACTIVE",
      cgp_phase: cgpData.phase === "PROCESS" ? "PROCESS" : "FILING",
      cgp_phase_source: cgpData.phase_source,
      source: "MIGRATION",
      source_reference: null,
      source_payload: null,
      client_id: cgpData.client_id,
      matter_id: cgpData.matter_id,
      radicado: cgpData.radicado,
      radicado_verified: !!cgpData.radicado,
      tutela_code: null,
      authority_name: cgpData.court_name,
      authority_email: cgpData.court_email,
      authority_city: cgpData.court_city,
      authority_department: cgpData.court_department,
      demandantes: cgpData.demandantes,
      demandados: cgpData.demandados,
      title: null,
      description: cgpData.description,
      notes: cgpData.notes,
      auto_admisorio_date: cgpData.auto_admisorio_date,
      filing_date: cgpData.sent_at,
      last_action_date: null,
      last_action_description: null,
      is_flagged: false,
      monitoring_enabled: cgpData.monitoring_enabled,
      email_linking_enabled: cgpData.email_linking_enabled,
      expediente_url: cgpData.expediente_url,
      sharepoint_url: null,
      scrape_status: cgpData.scrape_status || "NOT_ATTEMPTED",
      last_synced_at: null,
      last_checked_at: null,
      last_crawled_at: cgpData.last_crawled_at,
      scraped_fields: null,
      total_actuaciones: cgpData.total_actuaciones || 0,
      created_at: cgpData.created_at,
      updated_at: cgpData.updated_at,
      clients: cgpData.client,
      matters: cgpData.matter,
      _source: "cgp_items",
    } as WorkItemDetail;
  }

  // 3. Try legacy peticiones table
  const { data: peticionData } = await supabase
    .from("peticiones")
    .select("*, clients(id, name)")
    .eq("id", id)
    .maybeSingle();

  if (peticionData) {
    return {
      id: peticionData.id,
      owner_id: peticionData.owner_id,
      workflow_type: "PETICION",
      stage: peticionData.phase || "PETICION_RADICADA",
      status: "ACTIVE",
      cgp_phase: null,
      cgp_phase_source: null,
      source: "MIGRATION",
      source_reference: null,
      source_payload: null,
      client_id: peticionData.client_id,
      matter_id: null,
      radicado: peticionData.radicado,
      radicado_verified: !!peticionData.radicado,
      tutela_code: null,
      authority_name: peticionData.entity_name,
      authority_email: peticionData.entity_email,
      authority_city: null,
      authority_department: null,
      demandantes: null,
      demandados: null,
      title: peticionData.subject,
      description: peticionData.description,
      notes: peticionData.notes,
      auto_admisorio_date: null,
      filing_date: peticionData.filed_at,
      last_action_date: null,
      last_action_description: null,
      is_flagged: false,
      monitoring_enabled: false,
      email_linking_enabled: false,
      expediente_url: null,
      sharepoint_url: null,
      scrape_status: "NOT_ATTEMPTED",
      last_synced_at: null,
      last_checked_at: null,
      last_crawled_at: null,
      scraped_fields: null,
      total_actuaciones: 0,
      created_at: peticionData.created_at,
      updated_at: peticionData.updated_at,
      clients: peticionData.clients,
      matters: null,
      _source: "peticiones",
    } as WorkItemDetail;
  }

  // 4. Try legacy cpaca_processes table
  const { data: cpacaData } = await supabase
    .from("cpaca_processes")
    .select("*, clients(id, name)")
    .eq("id", id)
    .maybeSingle();

  if (cpacaData) {
    return {
      id: cpacaData.id,
      owner_id: cpacaData.owner_id,
      workflow_type: "CPACA",
      stage: cpacaData.phase || "PRECONTENCIOSO",
      status: "ACTIVE",
      cgp_phase: null,
      cgp_phase_source: null,
      source: "MIGRATION",
      source_reference: null,
      source_payload: null,
      client_id: cpacaData.client_id,
      matter_id: null,
      radicado: cpacaData.radicado,
      radicado_verified: !!cpacaData.radicado,
      tutela_code: null,
      authority_name: cpacaData.despacho_nombre || null,
      authority_email: cpacaData.despacho_email || null,
      authority_city: cpacaData.despacho_ciudad || null,
      authority_department: null,
      demandantes: cpacaData.demandantes,
      demandados: cpacaData.demandados,
      title: cpacaData.titulo || null,
      description: cpacaData.descripcion || null,
      notes: cpacaData.notas || null,
      auto_admisorio_date: cpacaData.fecha_auto_admisorio || null,
      filing_date: cpacaData.fecha_radicacion_demanda || null,
      last_action_date: null,
      last_action_description: null,
      is_flagged: cpacaData.is_flagged || false,
      monitoring_enabled: false,
      email_linking_enabled: false,
      expediente_url: null,
      sharepoint_url: null,
      scrape_status: "NOT_ATTEMPTED",
      last_synced_at: null,
      last_checked_at: null,
      last_crawled_at: null,
      scraped_fields: null,
      total_actuaciones: 0,
      created_at: cpacaData.created_at,
      updated_at: cpacaData.updated_at,
      clients: cpacaData.clients,
      matters: null,
      _source: "cpaca_processes",
    } as WorkItemDetail;
  }

  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchProcessEvents(id: string): Promise<any[]> {
  // Try work_item_id first
  const { data } = await supabase
    .from("process_events")
    .select("*")
    .eq("work_item_id", id)
    .order("event_date", { ascending: false });
  
  return data || [];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchActuaciones(id: string): Promise<any[]> {
  // Canonical source: work_item_acts (the legacy `actuaciones` table is no
  // longer written to by the sync pipeline — reading it caused the detail
  // view to report 0 even when acts existed).
  const { data } = await (supabase
    .from("work_item_acts") as any)
    .select("*")
    .eq("work_item_id", id)
    .eq("is_archived", false)
    .order("act_date", { ascending: false, nullsFirst: false });

  return data || [];
}

async function fetchDocuments(workItemId: string): Promise<any[]> {
  const { data } = await (supabase
    .from("documents") as any)
    .select("*")
    .eq("filing_id", workItemId)
    .order("uploaded_at", { ascending: false });
  return data || [];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchTasks(workItemId: string): Promise<any[]> {
  const { data } = await (supabase
    .from("work_item_tasks") as any)
    .select("*")
    .eq("work_item_id", workItemId)
    .order("due_at", { ascending: true });
  return data || [];
}

async function fetchHearings(workItemId: string): Promise<any[]> {
  const { data } = await (supabase
    .from("work_item_hearings") as any)
    .select("*, hearing_types(name)")
    .eq("work_item_id", workItemId)
    .order("scheduled_at", { ascending: true });
  return (data || []).map((h: any) => ({
    ...h,
    title: h.custom_name || h.hearing_types?.name || "Audiencia",
    is_virtual: h.modality === "virtual" || h.modality === "mixta",
    virtual_link: h.meeting_link,
    notes: h.notes_plain_text,
  }));
}

export function useWorkItemDetail(
  idOrOptions: string | undefined | { id?: string; radicado?: string },
) {
  // Accept either a UUID (legacy) or `{ id, radicado }`. If only radicado is
  // provided we resolve the local Supabase row by radicado first.
  let opts: { id?: string; radicado?: string };
  if (typeof idOrOptions === "string") {
    opts = { id: idOrOptions };
  } else if (idOrOptions == null) {
    opts = {};
  } else {
    opts = idOrOptions;
  }

  // Resolve UUID from radicado when needed.
  const radicadoLookup = useQuery({
    queryKey: ["work-item-id-by-radicado", opts.radicado],
    queryFn: async () => {
      if (!opts.radicado) return null;
      const { data } = await supabase
        .from("work_items")
        .select("id")
        .eq("radicado", opts.radicado)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data?.id ?? null;
    },
    enabled: !!opts.radicado && !opts.id,
    staleTime: 5 * 60_000,
  });

  const id = opts.id ?? radicadoLookup.data ?? undefined;

  // Main work item query with polymorphic resolution
  const workItemQuery = useQuery({
    queryKey: ["work-item-detail", id],
    queryFn: () => fetchWorkItem(id!),
    enabled: !!id,
  });

  const workItem = workItemQuery.data;

  // Andromeda radicado enrichment. The API is the source of truth for sync
  // status, totals and the canonical `work_item_id` in Cloud SQL.
  const radicado = opts.radicado || workItem?.radicado || null;
  const cpnuQuery = useQuery({
    queryKey: ["radicado-detail-enrichment", radicado],
    queryFn: async () => {
      const res = await andromedaProxy<any>(`/radicados/${radicado!}`);
      if (!res.ok) {
        console.error(`[useWorkItemDetail] proxy error`, res.error);
        throw new Error(`Andromeda proxy: ${res.error || "unknown"}`);
      }
      const body = res.body ?? {};
      return body?.radicado ?? body?.item ?? body ?? null;
    },
    enabled: !!radicado,
    staleTime: 30_000,
  });

  // Merge CPNU data into work item
  const enrichedWorkItem = useMemo(() => {
    if (!workItem) return null;
    if (!cpnuQuery.data) return workItem;
    const cpnu = cpnuQuery.data as Record<string, unknown>;
    const sync = (cpnu.sync ?? null) as AndromedaSyncMap | null;
    const apiWorkItemId = (cpnu.work_item_id as string | undefined) ?? null;
    const apiTotal =
      (sync?.cpnu?.total_actuaciones as number | undefined) ??
      (cpnu.total_actuaciones as number | undefined);
    const apiLastSync =
      (sync?.cpnu?.last_sync_at as string | undefined) ??
      (cpnu.last_checked_at as string | undefined);
    return {
      ...workItem,
      cpnu_status: cpnu.cpnu_status ?? workItem.scrape_status,
      ultimo_run_status: cpnu.ultimo_run_status ?? null,
      ultimo_run_has_novedad: cpnu.ultimo_run_has_novedad ?? null,
      tipo_novedad: cpnu.tipo_novedad ?? null,
      valor_anterior: cpnu.valor_anterior ?? null,
      valor_nuevo: cpnu.valor_nuevo ?? null,
      ultima_novedad_descripcion: cpnu.ultima_novedad_descripcion ?? null,
      ultima_novedad_revisada: cpnu.ultima_novedad_revisada ?? null,
      ultima_novedad_fecha: cpnu.ultima_novedad_fecha ?? null,
      last_checked_at: apiLastSync ?? workItem.last_checked_at,
      last_synced_at: apiLastSync ?? workItem.last_synced_at,
      total_actuaciones: apiTotal ?? workItem.total_actuaciones,
      sync,
      api_work_item_id: apiWorkItemId,
    } as WorkItemDetail;
  }, [workItem, cpnuQuery.data]);

  // Fetch process events (timeline)
  const processEventsQuery = useQuery({
    queryKey: ["work-item-process-events", id],
    queryFn: () => fetchProcessEvents(id!),
    enabled: !!workItem,
  });

  // Fetch actuaciones (acts)
  const actuacionesQuery = useQuery({
    queryKey: ["work-item-actuaciones", id],
    queryFn: () => fetchActuaciones(id!),
    enabled: !!workItem,
  });

  // Fetch documents
  const documentsQuery = useQuery({
    queryKey: ["work-item-documents", id],
    queryFn: () => fetchDocuments(id!),
    enabled: !!id,
  });

  // Fetch tasks
  const tasksQuery = useQuery({
    queryKey: ["work-item-tasks", id],
    queryFn: () => fetchTasks(id!),
    enabled: !!id,
  });

  // Fetch hearings
  const hearingsQuery = useQuery({
    queryKey: ["work-item-hearings", id],
    queryFn: () => fetchHearings(id!),
    enabled: !!id,
  });

  return {
    workItem: enrichedWorkItem,
    isLoading: workItemQuery.isLoading,
    error: workItemQuery.error,
    processEvents: processEventsQuery.data || [],
    actuaciones: actuacionesQuery.data || [],
    documents: documentsQuery.data || [],
    tasks: tasksQuery.data || [],
    alerts: [],
    evidenceSnapshots: [],
    hearings: hearingsQuery.data || [],
    refetch: () => {
      workItemQuery.refetch();
      cpnuQuery.refetch();
      processEventsQuery.refetch();
      actuacionesQuery.refetch();
      documentsQuery.refetch();
      tasksQuery.refetch();
      hearingsQuery.refetch();
    },
  };
}
