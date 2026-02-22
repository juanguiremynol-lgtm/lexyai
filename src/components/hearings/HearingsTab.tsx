/**
 * HearingsTab — Main tab component for work item detail
 * Split panel: Timeline (left) + Detail editor (right)
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, FileDown, Scale } from "lucide-react";
import { useWorkItemHearingsV2 } from "@/hooks/use-work-item-hearings-v2";
import { HearingTimeline } from "./HearingTimeline";
import { HearingDetailEditor } from "./HearingDetailEditor";
import { AddHearingDialog } from "./AddHearingDialog";
import { HearingSearchDialog } from "./HearingSearchDialog";
import { HearingDigestExport } from "./HearingDigestExport";

interface Props {
  workItem: {
    id: string;
    organization_id?: string;
    workflow_type?: string;
    numero_radicado?: string;
    parties_summary?: string;
    despacho?: string;
  };
}

export function HearingsTab({ workItem }: Props) {
  const { data: hearings = [], isLoading } = useWorkItemHearingsV2(workItem.id);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [searchDialogOpen, setSearchDialogOpen] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Auto-select first hearing if none selected
  const effectiveSelectedId = selectedId || hearings[0]?.id || null;
  const selectedHearing = hearings.find((h) => h.id === effectiveSelectedId);

  // Filter hearings by search
  const filteredHearings = searchQuery
    ? hearings.filter((h) => {
        const name = h.custom_name || h.hearing_type?.short_name || "";
        const notes = h.notes_plain_text || "";
        const decisions = h.decisions_summary || "";
        const q = searchQuery.toLowerCase();
        return name.toLowerCase().includes(q) ||
          notes.toLowerCase().includes(q) ||
          decisions.toLowerCase().includes(q);
      })
    : hearings;

  if (isLoading) {
    return (
      <div className="grid grid-cols-3 gap-4">
        <Skeleton className="h-[400px]" />
        <Skeleton className="h-[400px] col-span-2" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Filtrar audiencias..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-9 w-64"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSearchDialogOpen(true)}
            disabled={hearings.length === 0}
          >
            <Search className="h-4 w-4 mr-1" />
            Buscar en contenido
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setExportDialogOpen(true)}
            disabled={hearings.length === 0}
          >
            <FileDown className="h-4 w-4 mr-1" />
            Exportar resumen
          </Button>
        </div>
      </div>

      {/* Split Panel */}
      {hearings.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Scale className="h-16 w-16 text-muted-foreground/30 mb-4" />
          <h3 className="text-lg font-medium mb-1">Sin audiencias</h3>
          <p className="text-sm text-muted-foreground mb-4 max-w-sm">
            Las audiencias del proceso se generan automáticamente según la jurisdicción, o puedes agregarlas manualmente.
          </p>
          <Button onClick={() => setAddDialogOpen(true)}>
            Agregar audiencia
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Left: Timeline */}
          <div className="lg:col-span-1 border rounded-lg p-3 max-h-[700px] overflow-y-auto">
            <HearingTimeline
              hearings={filteredHearings}
              selectedId={effectiveSelectedId}
              onSelect={setSelectedId}
              onAddClick={() => setAddDialogOpen(true)}
            />
          </div>

          {/* Right: Detail */}
          <div className="lg:col-span-2 max-h-[700px] overflow-y-auto">
            {selectedHearing ? (
              <HearingDetailEditor hearing={selectedHearing} />
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                <p>Selecciona una audiencia para ver los detalles</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Dialogs */}
      <AddHearingDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        workItemId={workItem.id}
        organizationId={workItem.organization_id || ""}
        jurisdiction={workItem.workflow_type || "CGP"}
      />

      <HearingSearchDialog
        open={searchDialogOpen}
        onOpenChange={setSearchDialogOpen}
        workItemId={workItem.id}
        onSelectHearing={(id) => setSelectedId(id)}
      />

      <HearingDigestExport
        open={exportDialogOpen}
        onOpenChange={setExportDialogOpen}
        hearings={hearings}
        workItem={workItem}
      />
    </div>
  );
}
