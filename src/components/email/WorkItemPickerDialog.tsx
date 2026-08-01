/**
 * WorkItemPickerDialog — "Vincular a otro expediente".
 *
 * Combobox sobre TODOS los expedientes activos del usuario usando la misma
 * búsqueda normalizada del buscador global (radicado en cualquier forma,
 * radicado parcial, parte, despacho, correo del despacho).
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertTriangle, Loader2, Plus, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  MATCHED_FIELD_LABELS,
  formatRadicadoPretty,
  radicadoBase,
} from "@/lib/search/normalized-search";

export interface PickerWorkItem {
  id: string;
  radicado: string | null;
  title: string | null;
  demandantes: string | null;
  demandados: string | null;
  authority_name: string | null;
  authority_city: string | null;
  workflow_type: string | null;
  stage: string | null;
  matched_fields: string[] | null;
  match_rank: number | null;
}

export function WorkItemPickerDialog({
  open,
  onOpenChange,
  onSelect,
  isPending,
  /** Radicados detectados en el correo, para avisar de conflicto. */
  messageRadicados = [],
  currentWorkItemId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (workItem: PickerWorkItem, overrideDespiteConflict: boolean) => void;
  isPending?: boolean;
  messageRadicados?: string[];
  currentWorkItemId?: string | null;
}) {
  const navigate = useNavigate();
  const [term, setTerm] = useState("");

  const { data, isFetching } = useQuery({
    queryKey: ["work-item-picker", term],
    queryFn: async (): Promise<PickerWorkItem[]> => {
      const { data, error } = await supabase.rpc("search_work_items_normalized", {
        p_query: term,
        p_limit: 25,
      });
      if (error) throw error;
      return (data ?? []) as unknown as PickerWorkItem[];
    },
    enabled: open && term.trim().length >= 2,
    staleTime: 15_000,
  });

  const results = data ?? [];
  const bases = messageRadicados.map(radicadoBase).filter(Boolean);

  const conflictWith = (item: PickerWorkItem) => {
    const wiBase = radicadoBase(item.radicado);
    if (!wiBase || bases.length === 0) return null;
    return bases.some((b) => b === wiBase) ? null : messageRadicados[0];
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Vincular a otro expediente</DialogTitle>
          <DialogDescription>
            Busca por radicado (completo, con guiones o parcial), parte, despacho o correo del
            despacho. Tu elección manda sobre la sugerencia automática.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            className="pl-9"
            placeholder="2025-00211, Londoño, juzgado 21 civil…"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
          {isFetching && (
            <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          )}
        </div>

        <ScrollArea className="max-h-80">
          <div className="space-y-1 pr-2">
            {term.trim().length < 2 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Escribe al menos 2 caracteres.
              </p>
            )}
            {term.trim().length >= 2 && !isFetching && results.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Sin expedientes que coincidan.
              </p>
            )}
            {results.map((item) => {
              const conflict = conflictWith(item);
              const parties = [item.demandantes, item.demandados].filter(Boolean).join(" vs ");
              const isCurrent = item.id === currentWorkItemId;
              return (
                <button
                  key={item.id}
                  type="button"
                  disabled={isPending || isCurrent}
                  onClick={() => onSelect(item, Boolean(conflict))}
                  className={cn(
                    "w-full rounded-md border p-3 text-left transition-colors hover:bg-accent",
                    isCurrent && "opacity-50",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium">
                      {item.radicado ? formatRadicadoPretty(item.radicado) : item.title ?? "Sin radicado"}
                    </span>
                    {item.workflow_type && <Badge variant="secondary">{item.workflow_type}</Badge>}
                    {isCurrent && <Badge variant="outline">Actual</Badge>}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {[parties, item.authority_name, item.authority_city].filter(Boolean).join(" · ") ||
                      "Sin partes registradas"}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {(item.matched_fields ?? []).slice(0, 3).map((f) => (
                      <Badge key={f} variant="outline" className="h-4 px-1.5 text-[10px] font-normal">
                        {MATCHED_FIELD_LABELS[f] ?? `coincide: ${f}`}
                      </Badge>
                    ))}
                  </div>
                  {conflict && (
                    <p className="mt-1.5 flex items-center gap-1 text-xs text-destructive">
                      <AlertTriangle className="h-3 w-3" aria-hidden />
                      El correo referencia el radicado {conflict}; confirmarás el vínculo con{" "}
                      {formatRadicadoPretty(item.radicado)}.
                    </p>
                  )}
                </button>
              );
            })}
          </div>
        </ScrollArea>

        <DialogFooter className="sm:justify-between">
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
              navigate(
                messageRadicados[0]
                  ? `/app/procesos-detectados?radicado=${encodeURIComponent(messageRadicados[0])}`
                  : "/app/procesos-detectados",
              );
            }}
          >
            <Plus className="mr-1 h-3.5 w-3.5" aria-hidden />
            Vincular a expediente nuevo
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}