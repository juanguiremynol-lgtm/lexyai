/**
 * PracticeAreasSettings — tenant practice areas (iteration 18).
 * Areas not selected hide their kanban board and are never assigned by inference.
 */

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { WORKFLOW_TYPES, type WorkflowType } from "@/lib/workflow-constants";
import { PRACTICE_AREA_OPTIONS, usePracticeAreas } from "@/hooks/use-practice-areas";

export function PracticeAreasSettings() {
  const { areas, isLoading, setAreas } = usePracticeAreas();
  const selected = areas ?? PRACTICE_AREA_OPTIONS;

  const toggle = (wf: WorkflowType, checked: boolean) => {
    const next = checked ? [...selected, wf] : selected.filter((a) => a !== wf);
    if (next.length === 0) {
      toast.error("Debes mantener al menos un área de práctica");
      return;
    }
    setAreas.mutate(next, {
      onSuccess: () => toast.success("Áreas de práctica actualizadas"),
      onError: (e: Error) => toast.error(e.message),
    });
  };

  if (isLoading) return <Skeleton className="h-40 w-full" />;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Áreas de práctica</CardTitle>
        <CardDescription>
          Define las materias que litiga tu despacho. Las áreas no seleccionadas ocultan su tablero
          y nunca se asignan automáticamente: esos asuntos quedan en "Por clasificar".
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2">
        {PRACTICE_AREA_OPTIONS.map((wf) => (
          <label key={wf} className="flex items-start gap-3 rounded-lg border p-3">
            <Checkbox
              checked={selected.includes(wf)}
              disabled={setAreas.isPending}
              onCheckedChange={(c) => toggle(wf, c === true)}
            />
            <span>
              <span className="block text-sm font-medium">{WORKFLOW_TYPES[wf].label}</span>
              <span className="block text-xs readable-muted">{WORKFLOW_TYPES[wf].description}</span>
            </span>
          </label>
        ))}
      </CardContent>
    </Card>
  );
}
