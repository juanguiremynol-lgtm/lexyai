/**
 * RechazoPresuntoBanner
 *
 * Amber advisory shown when a SUBSANACION deadline expired without any
 * evidence of a memorial in the judicial record. The rejection is a
 * PRESUMPTION (never an automatic stage change).
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle2, FileCheck } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { toast } from "sonner";

interface Props {
  workItemId: string;
}

interface PresuntoDeadline {
  id: string;
  trigger_date: string;
  deadline_date: string;
  calculation_meta: Record<string, any> | null;
}

const fmt = (iso: string) => {
  try {
    return format(new Date(`${iso}T00:00:00`), "d 'de' MMMM 'de' yyyy", { locale: es });
  } catch {
    return iso;
  }
};

export function RechazoPresuntoBanner({ workItemId }: Props) {
  const queryClient = useQueryClient();

  const { data: rows } = useQuery({
    queryKey: ["rechazo-presunto", workItemId],
    queryFn: async (): Promise<PresuntoDeadline[]> => {
      const { data, error } = await supabase
        .from("work_item_deadlines")
        .select("id, trigger_date, deadline_date, calculation_meta")
        .eq("work_item_id", workItemId)
        .eq("deadline_type", "SUBSANACION")
        .eq("status", "VENCIDO_SIN_SUBSANAR")
        .order("deadline_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as PresuntoDeadline[];
    },
    enabled: !!workItemId,
    staleTime: 60_000,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["rechazo-presunto", workItemId] });
    queryClient.invalidateQueries({ queryKey: ["work-item-deadlines", workItemId] });
  };

  const confirmRechazo = useMutation({
    mutationFn: async (row: PresuntoDeadline) => {
      const meta = {
        ...(row.calculation_meta ?? {}),
        subsanacion_rule: {
          ...((row.calculation_meta?.subsanacion_rule as Record<string, unknown>) ?? {}),
          user_confirmed_rechazo: true,
          user_confirmed_at: new Date().toISOString(),
        },
      };
      const { error } = await supabase
        .from("work_item_deadlines")
        .update({ calculation_meta: meta, notes: "Rechazo confirmado manualmente por el usuario." })
        .eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Rechazo confirmado. Revise la sugerencia de etapa pendiente.");
    },
    onError: (e: Error) => toast.error(`No se pudo confirmar: ${e.message}`),
  });

  const marcarSubsanado = useMutation({
    mutationFn: async (row: PresuntoDeadline) => {
      const meta = {
        ...(row.calculation_meta ?? {}),
        subsanacion_rule: {
          ...((row.calculation_meta?.subsanacion_rule as Record<string, unknown>) ?? {}),
          outcome: "FULFILLED",
          fulfilled_source: "MANUAL_USER",
          fulfilled_at: new Date().toISOString(),
        },
      };
      const { error } = await supabase
        .from("work_item_deadlines")
        .update({
          status: "FULFILLED",
          met_at: new Date().toISOString(),
          calculation_meta: meta,
          notes: "Subsanación registrada manualmente por el usuario (no reflejada en el portal judicial).",
        })
        .eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Término marcado como cumplido con la subsanación registrada.");
    },
    onError: (e: Error) => toast.error(`No se pudo registrar: ${e.message}`),
  });

  if (!rows || rows.length === 0) return null;

  return (
    <div className="space-y-3 mb-4">
      {rows.map((row) => {
        const rule = (row.calculation_meta?.subsanacion_rule ?? {}) as Record<string, any>;
        const confirmado = rule.outcome === "RECHAZO_CONFIRMADO" || rule.user_confirmed_rechazo;
        return (
          <div
            key={row.id}
            className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-4"
          >
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600 mt-0.5" />
              <div className="flex-1 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-amber-900 dark:text-amber-200">
                    {confirmado ? "Rechazo confirmado" : "Rechazo presunto — verificar"}
                  </p>
                  <Badge variant="outline" className="border-amber-500 text-amber-700 dark:text-amber-300">
                    Presunción procesal
                  </Badge>
                </div>
                <p className="text-sm text-amber-900/90 dark:text-amber-100/90">
                  Demanda inadmitida el <strong>{fmt(row.trigger_date)}</strong>; el término de
                  subsanación de 5 días hábiles venció el <strong>{fmt(row.deadline_date)}</strong> sin
                  que se detecte escrito de subsanación en el expediente.
                  {rule.auto_rechazo_date
                    ? ` Auto de rechazo registrado el ${fmt(String(rule.auto_rechazo_date))}.`
                    : " Verifique si se radicó subsanación por un canal no reflejado en el portal."}
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={confirmRechazo.isPending}
                    onClick={() => confirmRechazo.mutate(row)}
                  >
                    <CheckCircle2 className="h-4 w-4 mr-1.5" />
                    Confirmar rechazo
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={marcarSubsanado.isPending}
                    onClick={() => marcarSubsanado.mutate(row)}
                  >
                    <FileCheck className="h-4 w-4 mr-1.5" />
                    Registré subsanación
                  </Button>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
