/**
 * UnclassifiedTray — "Por clasificar" (iteration 18).
 *
 * Work items whose subject matter could not be derived (mixed-competence
 * court, unknown specialty, no provider clase_proceso). Monitoring stays
 * active; only the legal classification is pending, and only a human sets it.
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { HelpCircle, ExternalLink } from "lucide-react";
import { WORKFLOW_TYPES, type WorkflowType } from "@/lib/workflow-constants";
import { PRACTICE_AREA_OPTIONS, usePracticeAreas } from "@/hooks/use-practice-areas";

interface UnclassifiedRow {
  id: string;
  radicado: string | null;
  title: string | null;
  authority_name: string | null;
  clase_proceso: string | null;
  despacho_competencia: string | null;
  despacho_competencia_subjects: string[] | null;
  last_action_date: string | null;
}

export function UnclassifiedTray() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { areas, isPracticed, addArea } = usePracticeAreas();
  const [pending, setPending] = useState<Record<string, WorkflowType>>({});

  const { data: items, isLoading } = useQuery({
    queryKey: ["unclassified-work-items"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("work_items")
        .select(
          "id, radicado, title, authority_name, clase_proceso, despacho_competencia, despacho_competencia_subjects, last_action_date",
        )
        .eq("workflow_type", "INDETERMINADO" as never)
        .eq("status", "ACTIVE")
        .order("last_action_date", { ascending: false, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as unknown as UnclassifiedRow[];
    },
  });

  const classify = useMutation({
    mutationFn: async ({ id, workflow }: { id: string; workflow: WorkflowType }) => {
      const { error } = await supabase
        .from("work_items")
        .update({
          workflow_type: workflow as never,
          workflow_type_source: "MANUAL",
        } as never)
        .eq("id", id);
      if (error) throw error;
      if (!isPracticed(workflow)) await addArea.mutateAsync(workflow);
      return workflow;
    },
    onSuccess: (workflow) => {
      toast.success(`Asunto clasificado como ${WORKFLOW_TYPES[workflow].label}`);
      queryClient.invalidateQueries({ queryKey: ["unclassified-work-items"] });
      queryClient.invalidateQueries({ queryKey: ["work-items"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) {
    return <Skeleton className="h-48 w-full" />;
  }

  if (!items || items.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center readable-muted text-sm">
          No hay asuntos por clasificar.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <HelpCircle className="h-5 w-5 text-amber-600" />
          Por clasificar ({items.length})
        </CardTitle>
        <CardDescription>
          La materia no se infiere del radicado en despachos de competencia mixta. El monitoreo
          sigue activo; solo falta que un abogado defina la materia.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.map((item) => (
          <div
            key={item.id}
            className="flex flex-col gap-3 rounded-lg border p-3 md:flex-row md:items-center md:justify-between"
          >
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  className="font-mono text-sm underline-offset-2 hover:underline"
                  onClick={() => navigate(`/app/item/${item.id}`)}
                >
                  {item.radicado ?? "Sin radicado"}
                </button>
                <Badge variant="outline" className="text-xs">
                  {item.despacho_competencia === "MIXTA"
                    ? "Competencia mixta"
                    : "Competencia desconocida"}
                </Badge>
                {(item.despacho_competencia_subjects ?? []).map((s) => (
                  <Badge key={s} variant="secondary" className="text-xs">
                    {s}
                  </Badge>
                ))}
              </div>
              <p className="truncate text-sm readable-muted">
                {item.authority_name ?? "Despacho no identificado"}
                {item.clase_proceso ? ` · ${item.clase_proceso}` : ""}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Select
                value={pending[item.id] ?? ""}
                onValueChange={(v) => setPending((p) => ({ ...p, [item.id]: v as WorkflowType }))}
              >
                <SelectTrigger className="w-[190px]">
                  <SelectValue placeholder="Definir materia" />
                </SelectTrigger>
                <SelectContent>
                  {PRACTICE_AREA_OPTIONS.map((wf) => (
                    <SelectItem key={wf} value={wf}>
                      {WORKFLOW_TYPES[wf].label}
                      {areas && !areas.includes(wf) ? " (fuera de tus áreas)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                disabled={!pending[item.id] || classify.isPending}
                onClick={() => classify.mutate({ id: item.id, workflow: pending[item.id] })}
              >
                Clasificar
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => navigate(`/app/item/${item.id}`)}
                aria-label="Abrir asunto"
              >
                <ExternalLink className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
