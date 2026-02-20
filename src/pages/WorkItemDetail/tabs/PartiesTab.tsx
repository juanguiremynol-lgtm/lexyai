/**
 * PartiesTab — Partes tab for work item detail view.
 * Shows structured party management with side grouping and completeness warnings.
 */

import { PartyManager } from "@/components/parties/PartyManager";
import type { WorkItem } from "@/types/work-item";

interface PartiesTabProps {
  workItem: WorkItem;
}

export function PartiesTab({ workItem }: PartiesTabProps) {
  return (
    <PartyManager
      workItemId={workItem.id}
      workflowType={workItem.workflow_type}
      ownerId={workItem.owner_id}
      organizationId={workItem.organization_id}
    />
  );
}
