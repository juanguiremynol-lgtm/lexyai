import { SYNC_ENABLED_WORKFLOWS, TERMINAL_STAGES } from "../_shared/syncPolicy.ts";

type Database = Pick<import("npm:@supabase/supabase-js@2").SupabaseClient, "from">;

function activeMonitored(db: Database, columns: string) {
  return db.from("work_items").select(columns).eq("monitoring_enabled", true)
    .eq("lifecycle_state", "ACTIVE").is("deleted_at", null)
    .not("organization_id", "is", null).not("radicado", "is", null);
}

export async function monitoredOrganizations(db: Database): Promise<string[]> {
  const orgs = new Set<string>();
  let cursor: string | undefined;
  while (true) {
    let q = activeMonitored(db, "organization_id").order("organization_id").limit(200);
    if (cursor) q = q.gt("organization_id", cursor);
    const { data, error } = await q.returns<{organization_id: string}[]>();
    if (error) throw error;
    if (!data?.length) return [...orgs];
    const last = data[data.length - 1].organization_id;
    if (cursor && last <= cursor) throw new Error("DAILY_ORG_CURSOR_STALLED");
    for (const row of data) orgs.add(row.organization_id);
    cursor = last;
  }
}

interface Candidate {
  id: string;
  organization_id: string;
  radicado: string;
  workflow_type: string;
  stage: string | null;
  sync_item_failure_tracker: { dead_lettered: boolean } | null;
}

interface Summary {
  org_id: string;
  eligible_count: number;
  would_enqueue_count: number;
  sample_radicados: string[];
  exclusion_reasons: Record<string, number>;
}

export async function summarizeDryRun(db: Database, cutoff: string): Promise<Summary[]> {
  const orgs = new Map<string, Summary>();
  let cursor: string | undefined;
  const fields = "id,organization_id,radicado,workflow_type,stage,sync_item_failure_tracker(dead_lettered)";
  while (true) {
    let q = activeMonitored(db, fields).lte("created_at", cutoff).order("id").limit(200);
    if (cursor) q = q.gt("id", cursor);
    const { data, error } = await q.returns<Candidate[]>();
    if (error) throw error;
    if (!data?.length) return [...orgs.values()];
    const last = data[data.length - 1].id;
    if (cursor && last <= cursor) throw new Error("DAILY_DIAGNOSTIC_CURSOR_STALLED");
    for (const row of data) {
      const s: Summary = orgs.get(row.organization_id) ?? { org_id: row.organization_id,
        eligible_count: 0, would_enqueue_count: 0, sample_radicados: [], exclusion_reasons: {} };
      orgs.set(row.organization_id, s);
      s.eligible_count++;
      let reason: string | undefined;
      if (!SYNC_ENABLED_WORKFLOWS.some(w => w === row.workflow_type)) reason = "workflow_ineligible";
      else if (TERMINAL_STAGES.some(stage => stage === row.stage)) reason = "terminal_stage";
      else if (row.sync_item_failure_tracker?.dead_lettered) reason = "dead_lettered";
      else if (row.radicado.replace(/\D/g, "").length !== 23) reason = "invalid_radicado_format";
      if (reason) s.exclusion_reasons[reason] = (s.exclusion_reasons[reason] ?? 0) + 1;
      else {
        s.would_enqueue_count++;
        if (s.sample_radicados.length < 3) s.sample_radicados.push(row.radicado);
      }
    }
    cursor = last;
  }
}
