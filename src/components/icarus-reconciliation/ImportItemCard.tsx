// One card per missing radicado. 3-step inline stepper:
//   1. Review/edit fields (despacho, workflow_type)
//   2. Client assignment
//   3. Confirm + import

import { useState } from "react";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ClientAssignmentPicker } from "./ClientAssignmentPicker";
import { useBulkImportWorkItem } from "@/hooks/use-bulk-import-work-item";
import type {
  BatchItem, ClientAssignment, ImportResult, WorkflowType,
} from "@/lib/icarus-reconciliation/types";

const WORKFLOW_OPTIONS: WorkflowType[] = [
  "CGP", "CPACA", "LABORAL", "TUTELA", "PENAL_906", "GOV_PROCEDURE", "PETICION", "GENERIC",
];

interface Props {
  item: BatchItem;
}

function formatRadicado(r: string): string {
  // 23 digits → DD-DD-DD-DD-DD-DDDD-DDDDD-DD readable grouping (best-effort).
  if (r.length !== 23) return r;
  return `${r.slice(0,5)} ${r.slice(5,7)} ${r.slice(7,9)} ${r.slice(9,12)} ${r.slice(12,16)} ${r.slice(16,21)} ${r.slice(21,23)}`;
}

export function ImportItemCard({ item }: Props) {
  const [despacho, setDespacho] = useState(item.despacho);
  const [workflowType, setWorkflowType] = useState<WorkflowType>(item.suggested_workflow_type);
  const [demandantesText] = useState(item.demandantes.join("\n"));
  const [demandadosText] = useState(item.demandados.join("\n"));
  const [assignment, setAssignment] = useState<ClientAssignment>({
    mode: "demandante", createName: item.demandantes[0],
  });
  const [result, setResult] = useState<ImportResult | null>(null);

  const { mutateAsync, isPending } = useBulkImportWorkItem();

  const assignmentValid =
    assignment.mode === "self_curador" ||
    !!assignment.clientId ||
    !!assignment.createName?.trim();

  const handleImport = async () => {
    const r = await mutateAsync({ item, workflowType, despacho, assignment });
    setResult(r);
  };

  if (result?.ok) {
    return (
      <Card className="border-green-600/40">
        <CardContent className="py-4 flex items-center gap-3">
          <CheckCircle2 className="h-5 w-5 text-green-600" />
          <div className="flex-1">
            <p className="font-medium">{item.demandantes[0]} vs. {item.demandados[0]}</p>
            <p className="text-xs text-muted-foreground font-mono">{formatRadicado(item.radicado)}</p>
          </div>
          <Badge variant="outline" className="border-green-600 text-green-700">Importado</Badge>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-base">
              {item.demandantes[0]} vs. {item.demandados[0]}
            </CardTitle>
            <p className="text-xs text-muted-foreground font-mono">{formatRadicado(item.radicado)}</p>
          </div>
          <Badge variant="outline">{item.suggested_workflow_type} sugerido</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Step 1 — Review */}
        <section className="space-y-3">
          <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            1. Revisar datos
          </h4>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Radicado</Label>
              <Input value={formatRadicado(item.radicado)} readOnly className="font-mono text-xs" />
            </div>
            <div className="space-y-1.5">
              <Label>Tipo de flujo</Label>
              <Select value={workflowType} onValueChange={(v) => setWorkflowType(v as WorkflowType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {WORKFLOW_OPTIONS.map((w) => (
                    <SelectItem key={w} value={w}>{w}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Despacho</Label>
            <Input value={despacho} onChange={(e) => setDespacho(e.target.value)} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Demandante(s)</Label>
              <Textarea value={demandantesText} readOnly rows={2} className="text-xs" />
            </div>
            <div className="space-y-1.5">
              <Label>Demandado(s)</Label>
              <Textarea value={demandadosText} readOnly rows={2} className="text-xs" />
            </div>
          </div>
        </section>

        {/* Step 2 — Client */}
        <section className="space-y-3">
          <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            2. Asignar cliente
          </h4>
          <ClientAssignmentPicker item={item} value={assignment} onChange={setAssignment} />
        </section>

        {/* Step 3 — Import */}
        <section className="space-y-3">
          <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            3. Confirmar e importar
          </h4>
          {result && !result.ok && (
            <Alert variant="destructive">
              <XCircle className="h-4 w-4" />
              <AlertDescription>{result.error || "Error desconocido"}</AlertDescription>
            </Alert>
          )}
          <div className="flex justify-end">
            <Button onClick={handleImport} disabled={isPending || !assignmentValid}>
              {isPending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Importando…</>
              ) : (
                "Importar a Andromeda"
              )}
            </Button>
          </div>
        </section>
      </CardContent>
    </Card>
  );
}