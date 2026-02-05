/**
 * useWorkItemDetail - Consolidated hook for fetching complete work item data
 * 
 * Fetches the full graph of work item data including:
 * - Core work item data (from work_items or legacy tables)
 * - Client and matter relations
 * - Process events (timeline)
 * - Actuaciones (acts)
 * - Documents
 * - Tasks and alerts
 * - Deadlines
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { WorkItem } from "@/types/work-item";

async function fetchWorkItem(id: string): Promise<(WorkItem & { _source: string }) | null> {
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
    return { ...workItemData, _source: "work_items" } as WorkItem & { _source: string };
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
      last_checked_at: null,
      last_crawled_at: cgpData.last_crawled_at,
      scraped_fields: null,
      total_actuaciones: cgpData.total_actuaciones || 0,
      legacy_filing_id: cgpData.legacy_filing_id,
      legacy_process_id: cgpData.legacy_process_id,
      legacy_cgp_item_id: cgpData.id,
      legacy_peticion_id: null,
      legacy_cpaca_id: null,
      legacy_admin_process_id: null,
      created_at: cgpData.created_at,
      updated_at: cgpData.updated_at,
      clients: cgpData.client,
      matters: cgpData.matter,
      _source: "cgp_items",
    } as WorkItem & { _source: string };
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
      last_checked_at: null,
      last_crawled_at: null,
      scraped_fields: null,
      total_actuaciones: 0,
      legacy_filing_id: null,
      legacy_process_id: null,
      legacy_cgp_item_id: null,
      legacy_peticion_id: peticionData.id,
      legacy_cpaca_id: null,
      legacy_admin_process_id: null,
      created_at: peticionData.created_at,
      updated_at: peticionData.updated_at,
      clients: peticionData.clients,
      matters: null,
      deadline_at: peticionData.deadline_at,
      _source: "peticiones",
    } as WorkItem & { _source: string };
  }

  // 4. Try legacy monitored_processes table
  const { data: processData } = await supabase
    .from("monitored_processes")
    .select("*, clients(id, name)")
    .eq("id", id)
    .maybeSingle();

  if (processData) {
    const isAdmin = processData.process_type === "ADMINISTRATIVE";
    return {
      id: processData.id,
      owner_id: processData.owner_id,
      workflow_type: isAdmin ? "GOV_PROCEDURE" : "CGP",
      stage: processData.admin_phase || processData.phase || "AUTO_ADMISORIO",
      status: processData.monitoring_enabled ? "ACTIVE" : "INACTIVE",
      cgp_phase: isAdmin ? null : "PROCESS",
      cgp_phase_source: null,
      source: "MIGRATION",
      source_reference: null,
      source_payload: null,
      client_id: processData.client_id,
      matter_id: null,
      radicado: processData.radicado,
      radicado_verified: processData.cpnu_confirmed,
      tutela_code: null,
      authority_name: processData.despacho_name || processData.autoridad,
      authority_email: processData.correo_autoridad,
      authority_city: processData.municipality,
      authority_department: processData.department,
      demandantes: processData.demandantes,
      demandados: processData.demandados,
      title: null,
      description: null,
      notes: processData.notes,
      auto_admisorio_date: null,
      filing_date: null,
      last_action_date: processData.last_action_date || null,
      last_action_description: null,
      is_flagged: false,
      monitoring_enabled: processData.monitoring_enabled,
      email_linking_enabled: false,
      expediente_url: null,
      sharepoint_url: null,
      scrape_status: processData.cpnu_confirmed ? "SUCCESS" : "NOT_ATTEMPTED",
      last_checked_at: processData.last_checked_at,
      last_crawled_at: processData.last_checked_at,
      scraped_fields: null,
      total_actuaciones: processData.total_actuaciones || 0,
      legacy_filing_id: null,
      legacy_process_id: processData.id,
      legacy_cgp_item_id: null,
      legacy_peticion_id: null,
      legacy_cpaca_id: null,
      legacy_admin_process_id: isAdmin ? processData.id : null,
      created_at: processData.created_at,
      updated_at: processData.updated_at,
      clients: processData.clients,
      matters: null,
      _source: "monitored_processes",
    } as WorkItem & { _source: string };
  }

  // 5. Try legacy cpaca_processes table
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
      last_checked_at: null,
      last_crawled_at: null,
      scraped_fields: null,
      total_actuaciones: 0,
      legacy_filing_id: null,
      legacy_process_id: null,
      legacy_cgp_item_id: null,
      legacy_peticion_id: null,
      legacy_cpaca_id: cpacaData.id,
      legacy_admin_process_id: null,
      created_at: cpacaData.created_at,
      updated_at: cpacaData.updated_at,
      clients: cpacaData.clients,
      matters: null,
      _source: "cpaca_processes",
    } as WorkItem & { _source: string };
  }

  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchProcessEvents(id: string, legacyFilingId: string | null, legacyProcessId: string | null): Promise<any[]> {
  // Try work_item_id first - use explicit any to avoid deep type instantiation
  const baseQuery = supabase.from("process_events").select("*") as any;
  const result1 = await baseQuery.eq("work_item_id", id);
  const sorted1 = result1.data ? [...result1.data].sort((a: any, b: any) => 
    new Date(b.event_date || 0).getTime() - new Date(a.event_date || 0).getTime()
  ) : [];

  if (sorted1.length) {
    return sorted1;
  }
  
  if (legacyFilingId) {
    const query2 = supabase.from("process_events").select("*") as any;
    const result2 = await query2.eq("filing_id", legacyFilingId);
    return result2.data ? [...result2.data].sort((a: any, b: any) => 
      new Date(b.event_date || 0).getTime() - new Date(a.event_date || 0).getTime()
    ) : [];
  }
  
  if (legacyProcessId) {
    const query3 = supabase.from("process_events").select("*") as any;
    const result3 = await query3.eq("process_id", legacyProcessId);
    return result3.data ? [...result3.data].sort((a: any, b: any) => 
      new Date(b.event_date || 0).getTime() - new Date(a.event_date || 0).getTime()
    ) : [];
  }

  return [];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchActuaciones(id: string, legacyFilingId: string | null, legacyProcessId: string | null): Promise<any[]> {
  // Try work_item_id first
  const baseQuery = supabase.from("actuaciones").select("*") as any;
  const result1 = await baseQuery.eq("work_item_id", id);
  const sorted1 = result1.data ? [...result1.data].sort((a: any, b: any) => 
    new Date(b.act_date || 0).getTime() - new Date(a.act_date || 0).getTime()
  ) : [];

  if (sorted1.length) {
    return sorted1;
  }
  
  // Fallback to legacy IDs
  if (legacyProcessId) {
    const query = supabase.from("actuaciones").select("*") as any;
    const result = await query.eq("monitored_process_id", legacyProcessId);
    return result.data ? [...result.data].sort((a: any, b: any) => 
      new Date(b.act_date || 0).getTime() - new Date(a.act_date || 0).getTime()
    ) : [];
  }
  if (legacyFilingId) {
    const query = supabase.from("actuaciones").select("*") as any;
    const result = await query.eq("filing_id", legacyFilingId);
    return result.data ? [...result.data].sort((a: any, b: any) => 
      new Date(b.act_date || 0).getTime() - new Date(a.act_date || 0).getTime()
    ) : [];
  }
  return [];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchDocuments(legacyFilingId: string | null): Promise<any[]> {
  if (legacyFilingId) {
    const { data } = await supabase
      .from("documents")
      .select("*")
      .eq("filing_id", legacyFilingId)
      .order("uploaded_at", { ascending: false });
    return data || [];
  }
  return [];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchTasks(legacyFilingId: string | null): Promise<any[]> {
  if (legacyFilingId) {
    const { data } = await supabase
      .from("tasks")
      .select("*")
      .eq("filing_id", legacyFilingId)
      .order("due_at", { ascending: true });
    return data || [];
  }
  return [];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAlerts(legacyFilingId: string | null): Promise<any[]> {
  if (legacyFilingId) {
    const { data } = await supabase
      .from("alerts")
      .select("*")
      .eq("filing_id", legacyFilingId)
      .order("created_at", { ascending: false });
    return data || [];
  }
  return [];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchEvidence(legacyProcessId: string | null): Promise<any[]> {
  if (legacyProcessId) {
    const { data } = await supabase
      .from("evidence_snapshots")
      .select("*")
      .eq("monitored_process_id", legacyProcessId)
      .order("created_at", { ascending: false });
    return data || [];
  }
  return [];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchHearings(legacyFilingId: string | null, legacyProcessId: string | null): Promise<any[]> {
  if (legacyFilingId) {
    const query = supabase.from("hearings").select("*") as any;
    const result = await query.eq("filing_id", legacyFilingId);
    return result.data ? [...result.data].sort((a: any, b: any) => 
      new Date(a.scheduled_at || 0).getTime() - new Date(b.scheduled_at || 0).getTime()
    ) : [];
  }
  if (legacyProcessId) {
    const query = supabase.from("hearings").select("*") as any;
    const result = await query.eq("process_id", legacyProcessId);
    return result.data ? [...result.data].sort((a: any, b: any) => 
      new Date(a.scheduled_at || 0).getTime() - new Date(b.scheduled_at || 0).getTime()
    ) : [];
  }
  return [];
}

export function useWorkItemDetail(id: string | undefined) {
  // Main work item query with polymorphic resolution
  const workItemQuery = useQuery({
    queryKey: ["work-item-detail", id],
    queryFn: () => fetchWorkItem(id!),
    enabled: !!id,
  });

  const workItem = workItemQuery.data;
  const legacyFilingId = workItem?.legacy_filing_id ?? null;
  const legacyProcessId = workItem?.legacy_process_id ?? null;

  // Fetch process events (timeline)
  const processEventsQuery = useQuery({
    queryKey: ["work-item-process-events", id, legacyFilingId, legacyProcessId],
    queryFn: () => fetchProcessEvents(id!, legacyFilingId, legacyProcessId),
    enabled: !!workItem,
  });

  // Fetch actuaciones (acts) - now uses work_item_id primarily
  const actuacionesQuery = useQuery({
    queryKey: ["work-item-actuaciones", id, legacyFilingId, legacyProcessId],
    queryFn: () => fetchActuaciones(id!, legacyFilingId, legacyProcessId),
    enabled: !!workItem,
  });

  // Fetch documents
  const documentsQuery = useQuery({
    queryKey: ["work-item-documents", id, legacyFilingId],
    queryFn: () => fetchDocuments(legacyFilingId),
    enabled: !!legacyFilingId,
  });

  // Fetch tasks
  const tasksQuery = useQuery({
    queryKey: ["work-item-tasks", id, legacyFilingId],
    queryFn: () => fetchTasks(legacyFilingId),
    enabled: !!legacyFilingId,
  });

  // Fetch alerts
  const alertsQuery = useQuery({
    queryKey: ["work-item-alerts", id, legacyFilingId],
    queryFn: () => fetchAlerts(legacyFilingId),
    enabled: !!legacyFilingId,
  });

  // Fetch evidence snapshots
  const evidenceQuery = useQuery({
    queryKey: ["work-item-evidence", id, legacyProcessId],
    queryFn: () => fetchEvidence(legacyProcessId),
    enabled: !!legacyProcessId,
  });

  // Fetch hearings
  const hearingsQuery = useQuery({
    queryKey: ["work-item-hearings", id, legacyFilingId, legacyProcessId],
    queryFn: () => fetchHearings(legacyFilingId, legacyProcessId),
    enabled: !!(legacyFilingId || legacyProcessId),
  });

  return {
    workItem: workItemQuery.data,
    isLoading: workItemQuery.isLoading,
    error: workItemQuery.error,
    processEvents: processEventsQuery.data || [],
    actuaciones: actuacionesQuery.data || [],
    documents: documentsQuery.data || [],
    tasks: tasksQuery.data || [],
    alerts: alertsQuery.data || [],
    evidenceSnapshots: evidenceQuery.data || [],
    hearings: hearingsQuery.data || [],
    refetch: () => {
      workItemQuery.refetch();
      processEventsQuery.refetch();
      actuacionesQuery.refetch();
      documentsQuery.refetch();
      tasksQuery.refetch();
      alertsQuery.refetch();
      evidenceQuery.refetch();
      hearingsQuery.refetch();
    },
  };
}
