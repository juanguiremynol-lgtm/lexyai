/**
 * AddRadicadoInline - Inline component to add/edit radicado on existing work items
 * 
 * When saved, triggers auto-hydration via sync-by-work-item + sync-publicaciones-by-work-item.
 * Normalizes radicado to 23 digits before save.
 */

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Check, X, Pencil, Loader2, Hash } from "lucide-react";
import { toast } from "sonner";
import { normalizeRadicado } from "@/lib/radicado-utils";

interface AddRadicadoInlineProps {
  workItemId: string;
  currentRadicado: string | null;
  onUpdate?: () => void;
}

export function AddRadicadoInline({ workItemId, currentRadicado, onUpdate }: AddRadicadoInlineProps) {
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [inputValue, setInputValue] = useState(currentRadicado || "");

  const saveMutation = useMutation({
    mutationFn: async (radicado23: string) => {
      // Save normalized radicado
      const { error } = await supabase
        .from("work_items")
        .update({
          radicado: radicado23,
          radicado_verified: false,
          monitoring_enabled: true,
          scrape_status: "NOT_ATTEMPTED",
          consecutive_404_count: 0,
          provider_reachable: true,
          demonitor_reason: null,
          demonitor_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", workItemId);

      if (error) throw error;

      // Fire-and-forget: trigger hydration
      Promise.allSettled([
        supabase.functions.invoke("sync-by-work-item", {
          body: { work_item_id: workItemId },
        }),
        supabase.functions.invoke("sync-publicaciones-by-work-item", {
          body: { work_item_id: workItemId },
        }),
      ]).then(([actsResult, pubsResult]) => {
        const actsOk = actsResult.status === "fulfilled" && !actsResult.value.error;
        const pubsOk = pubsResult.status === "fulfilled" && !pubsResult.value.error;
        if (actsOk || pubsOk) {
          toast.success("Sincronización completada. Datos del proceso actualizados.");
          onUpdate?.();
          queryClient.invalidateQueries({ queryKey: ["work-item-detail", workItemId] });
          queryClient.invalidateQueries({ queryKey: ["work-item-actuaciones", workItemId] });
        } else {
          toast.info("Sincronización ejecutada. Los datos se actualizarán automáticamente.");
        }
      }).catch(() => {
        // Scheduled sync will retry
      });

      return radicado23;
    },
    onSuccess: () => {
      toast.success("Radicado guardado. Iniciando sincronización automática...");
      setIsEditing(false);
      onUpdate?.();
      queryClient.invalidateQueries({ queryKey: ["work-item-detail", workItemId] });
    },
    onError: (err: Error) => {
      toast.error("Error: " + err.message);
    },
  });

  const handleSave = () => {
    const result = normalizeRadicado(inputValue);
    if (!result.ok) {
      toast.error(result.error?.message || "El radicado debe tener exactamente 23 dígitos");
      return;
    }
    saveMutation.mutate(result.radicado23!);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setInputValue(currentRadicado || "");
  };

  // If we have a radicado, show it with edit option
  if (currentRadicado && !isEditing) {
    return (
      <div className="flex items-center gap-2">
        <span className="font-medium font-mono">{currentRadicado}</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => { setIsEditing(true); setInputValue(currentRadicado); }}
          title="Editar radicado"
        >
          <Pencil className="h-3 w-3" />
        </Button>
      </div>
    );
  }

  // If no radicado and not editing, show prompt
  if (!currentRadicado && !isEditing) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">—</span>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs gap-1"
          onClick={() => setIsEditing(true)}
        >
          <Hash className="h-3 w-3" />
          Agregar radicado
        </Button>
      </div>
    );
  }

  // Editing mode
  return (
    <div className="flex items-center gap-2">
      <Input
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        placeholder="23 dígitos del radicado"
        className="h-8 text-sm font-mono max-w-[280px]"
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSave();
          if (e.key === "Escape") handleCancel();
        }}
      />
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={handleSave}
        disabled={saveMutation.isPending}
      >
        {saveMutation.isPending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Check className="h-3.5 w-3.5" />
        )}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={handleCancel}
      >
        <X className="h-3.5 w-3.5" />
      </Button>
      {inputValue && (() => {
        const result = normalizeRadicado(inputValue);
        if (result.ok && result.radicado23 !== inputValue) {
          return (
            <Badge variant="secondary" className="text-xs font-mono">
              → {result.radicado23}
            </Badge>
          );
        }
        return null;
      })()}
    </div>
  );
}
