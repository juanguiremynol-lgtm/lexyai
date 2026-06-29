// Bulk-import mutation for the ICARUS reconciliation UI.
// Resolves/creates the assigned client, then inserts the work_item.
// Does NOT trigger sync — cron picks up monitoring_enabled=true items.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type {
  BatchItem,
  ClientAssignment,
  ImportResult,
  WorkflowType,
} from "@/lib/icarus-reconciliation/types";

export interface BulkImportInput {
  item: BatchItem;
  workflowType: WorkflowType;
  despacho: string;
  assignment: ClientAssignment;
}

async function resolveOrgAndProfile() {
  const { data: { user }, error: userErr } = await supabase.auth.getUser();
  if (userErr) throw userErr;
  if (!user) throw new Error("No hay sesión activa");

  const { data: profile, error: pErr } = await supabase
    .from("profiles")
    .select("organization_id, full_name, first_name, last_name")
    .eq("id", user.id)
    .maybeSingle();
  if (pErr) throw pErr;
  if (!profile?.organization_id) {
    throw new Error("Tu perfil no tiene organization_id. Configúralo antes de importar.");
  }

  const displayName =
    profile.full_name ||
    [profile.first_name, profile.last_name].filter(Boolean).join(" ").trim() ||
    user.email ||
    "Superadmin";

  return {
    userId: user.id,
    organizationId: profile.organization_id as string,
    displayName,
  };
}

async function resolveClient(
  assignment: ClientAssignment,
  ownerId: string,
  organizationId: string,
  superadminName: string,
  item: BatchItem,
): Promise<string> {
  // 1) Existing client selected → use it.
  if (assignment.mode !== "self_curador" && assignment.clientId) {
    return assignment.clientId;
  }

  // 2) Determine the name to create.
  let nameToCreate: string;
  switch (assignment.mode) {
    case "demandante":
      nameToCreate = assignment.createName?.trim() || item.demandantes[0] || "Demandante";
      break;
    case "demandado":
      nameToCreate = assignment.createName?.trim() || item.demandados[0] || "Demandado";
      break;
    case "self_curador":
      nameToCreate = superadminName;
      break;
    case "otro":
      nameToCreate = assignment.createName?.trim() || "Cliente";
      break;
  }

  // 3) Reuse an existing client with the same name in this org to avoid duplicates.
  const { data: existing } = await supabase
    .from("clients")
    .select("id")
    .eq("organization_id", organizationId)
    .ilike("name", nameToCreate)
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();
  if (existing?.id) return existing.id;

  // 4) Create a new client.
  const { data: created, error: cErr } = await supabase
    .from("clients")
    .insert({
      owner_id: ownerId,
      organization_id: organizationId,
      name: nameToCreate,
    })
    .select("id")
    .single();
  if (cErr) throw cErr;
  return created.id;
}

export function useBulkImportWorkItem() {
  const qc = useQueryClient();

  return useMutation<ImportResult, Error, BulkImportInput>({
    mutationFn: async ({ item, workflowType, despacho, assignment }) => {
      try {
        const { userId, organizationId, displayName } = await resolveOrgAndProfile();

        // Defensive: refuse if a non-deleted work_item already exists for this radicado.
        const { data: existingWi } = await supabase
          .from("work_items")
          .select("id")
          .eq("radicado", item.radicado)
          .is("deleted_at", null)
          .limit(1)
          .maybeSingle();
        if (existingWi?.id) {
          return { radicado: item.radicado, ok: false, error: "Ya existe un work_item con este radicado" };
        }

        const clientId = await resolveClient(assignment, userId, organizationId, displayName, item);

        const title = `${item.demandantes[0] || "—"} vs. ${item.demandados[0] || "—"}`;

        const { data: wi, error: wiErr } = await supabase
          .from("work_items")
          .insert({
            owner_id: userId,
            organization_id: organizationId,
            workflow_type: workflowType,
            source: "ICARUS_IMPORT",
            radicado: item.radicado,
            raw_courthouse_input: despacho,
            title,
            client_id: clientId,
            monitoring_enabled: true,
          })
          .select("id")
          .single();
        if (wiErr) throw wiErr;

        return { radicado: item.radicado, ok: true, workItemId: wi.id };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Error desconocido";
        return { radicado: item.radicado, ok: false, error: msg };
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["icarus-reconciliation"] });
      qc.invalidateQueries({ queryKey: ["work-items"] });
    },
  });
}