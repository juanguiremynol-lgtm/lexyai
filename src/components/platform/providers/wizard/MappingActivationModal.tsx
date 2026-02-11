/**
 * MappingActivationModal — Confirmation modal for promoting DRAFT → ACTIVE mapping specs.
 * Shows diff between current ACTIVE and proposed DRAFT.
 * Requires explicit confirmation; stronger warning for PLATFORM/GLOBAL scope.
 */

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle2, Shield, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface MappingSpec {
  id: string;
  visibility: string;
  status: string;
  scope: string;
  schema_version: string;
  spec: Record<string, unknown>;
  created_at: string;
  approved_by?: string | null;
  approved_at?: string | null;
}

interface MappingActivationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draftSpec: MappingSpec;
  currentActiveSpec?: MappingSpec | null;
  mode: "PLATFORM" | "ORG";
  onActivated: () => void;
}

export function MappingActivationModal({
  open, onOpenChange, draftSpec, currentActiveSpec, mode, onActivated,
}: MappingActivationModalProps) {
  const [isActivating, setIsActivating] = useState(false);

  const handleActivate = async () => {
    setIsActivating(true);
    try {
      const { data, error } = await supabase.functions.invoke("provider-activate-mapping", {
        body: {
          mapping_spec_id: draftSpec.id,
          mode,
        },
      });

      if (error) throw error;
      if (data?.ok) {
        toast.success("Mapping spec activado correctamente");
        onActivated();
        onOpenChange(false);
      } else {
        toast.error(data?.error || "Error al activar mapping spec");
      }
    } catch (err: any) {
      toast.error(err?.message || "Error al activar mapping spec");
    } finally {
      setIsActivating(false);
    }
  };

  const isGlobal = draftSpec.visibility === "GLOBAL";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            Activar Mapping Spec
          </DialogTitle>
          <DialogDescription>
            {isGlobal
              ? "Este cambio afecta a TODAS las organizaciones de la plataforma."
              : "Este cambio afecta solo a esta organización."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Warning for GLOBAL */}
          {isGlobal && (
            <div className="flex items-start gap-2 p-3 bg-destructive/5 border border-destructive/20 rounded-lg">
              <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
              <div className="text-sm text-destructive/80">
                <strong>Advertencia Platform-Wide:</strong> Activar este mapping spec GLOBAL reemplazará el spec activo actual para TODOS los conectores de este tipo. Confirme que ha revisado el diff.
              </div>
            </div>
          )}

          {/* Draft info */}
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-foreground">Spec a activar (DRAFT)</h4>
            <div className="bg-muted/30 rounded-lg p-3 text-xs font-mono max-h-40 overflow-auto">
              <pre className="whitespace-pre-wrap">{JSON.stringify(draftSpec.spec, null, 2)}</pre>
            </div>
            <div className="flex gap-2">
              <Badge variant="outline">{draftSpec.scope}</Badge>
              <Badge variant="outline">{draftSpec.visibility}</Badge>
              <Badge variant="outline">{draftSpec.schema_version}</Badge>
            </div>
          </div>

          {/* Current active */}
          {currentActiveSpec && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-muted-foreground">Spec activo actual (será archivado)</h4>
              <div className="bg-muted/30 rounded-lg p-3 text-xs font-mono max-h-32 overflow-auto opacity-60">
                <pre className="whitespace-pre-wrap">{JSON.stringify(currentActiveSpec.spec, null, 2)}</pre>
              </div>
            </div>
          )}

          {!currentActiveSpec && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="h-4 w-4" />
              No hay spec activo actualmente — este será el primero.
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isActivating}>
            Cancelar
          </Button>
          <Button
            onClick={handleActivate}
            disabled={isActivating}
            variant={isGlobal ? "destructive" : "default"}
            className="gap-2"
          >
            {isActivating ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            {isGlobal ? "Confirmar activación GLOBAL" : "Activar mapping"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
