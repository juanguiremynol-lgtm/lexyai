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
import { supabase } from "@/integrations/supabase/client";

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
  email_linking_enabled: boolean;
  expediente_url: string | null;
  sharepoint_url: string | null;
  scrape_status: string;
  last_checked_at: string | null;
  last_crawled_at: string | null;
  scraped_fields: Record<string, unknown> | null;
  total_actuaciones: number;
  created_at: string;
  updated_at: string;
  clients: { id: string; name: string } | null;
  matters: { id: string; matter_name: string; practice_area?: string; sharepoint_url?: string } | null;
  _source: string;
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
  // Try work_item_id
  const { data } = await supabase
    .from("actuaciones")
    .select("*")
    .eq("work_item_id", id)
    .order("act_date", { ascending: false });
  
  return data || [];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchDocuments(workItemId: string): Promise<any[]> {
  const { data } = await supabase
    .from("documents")
    .select("*")
    .eq("work_item_id", workItemId)
    .order("uploaded_at", { ascending: false });
  return data || [];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchTasks(workItemId: string): Promise<any[]> {
  const { data } = await supabase
    .from("tasks")
    .select("*")
    .eq("work_item_id", workItemId)
    .order("due_at", { ascending: true });
  return data || [];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchHearings(workItemId: string): Promise<any[]> {
  const { data } = await supabase
    .from("hearings")
    .select("*")
    .eq("work_item_id", workItemId)
    .order("scheduled_at", { ascending: true });
  return data || [];
}

export function useWorkItemDetail(id: string | undefined) {
  // Main work item query with polymorphic resolution
  const workItemQuery = useQuery({
    queryKey: ["work-item-detail", id],
    queryFn: () => fetchWorkItem(id!),
    enabled: !!id,
  });

  const workItem = workItemQuery.data;

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
    workItem: workItemQuery.data,
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
      processEventsQuery.refetch();
      actuacionesQuery.refetch();
      documentsQuery.refetch();
      tasksQuery.refetch();
      hearingsQuery.refetch();
    },
  };
}
