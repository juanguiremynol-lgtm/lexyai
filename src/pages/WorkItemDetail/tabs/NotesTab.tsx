/**
 * Notes Tab - Persistent notes for any work item
 * 
 * Features:
 * - Large editable textarea
 * - Autosave with debounce
 * - Last saved timestamp
 * - Works for all workflow types
 */

import { useState, useEffect, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  StickyNote, 
  Save, 
  Clock,
  CheckCircle,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";

import type { WorkItem } from "@/types/work-item";

interface NotesTabProps {
  workItem: WorkItem & { _source?: string };
}

export function NotesTab({ workItem }: NotesTabProps) {
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState(workItem.notes || "");
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Sync notes when workItem changes
  useEffect(() => {
    setNotes(workItem.notes || "");
    setHasUnsavedChanges(false);
  }, [workItem.notes]);

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async (newNotes: string) => {
      const source = workItem._source;
      let error = null;

      // Update based on source table
      if (source === "work_items") {
        ({ error } = await supabase
          .from("work_items")
          .update({ notes: newNotes, updated_at: new Date().toISOString() })
          .eq("id", workItem.id));
      } else if (source === "cgp_items") {
        ({ error } = await supabase
          .from("cgp_items")
          .update({ notes: newNotes, updated_at: new Date().toISOString() })
          .eq("id", workItem.id));
      } else if (source === "peticiones") {
        ({ error } = await supabase
          .from("peticiones")
          .update({ notes: newNotes, updated_at: new Date().toISOString() })
          .eq("id", workItem.id));
      } else if (source === "monitored_processes") {
        ({ error } = await supabase
          .from("monitored_processes")
          .update({ notes: newNotes, updated_at: new Date().toISOString() })
          .eq("id", workItem.id));
      } else if (source === "cpaca_processes") {
        ({ error } = await supabase
          .from("cpaca_processes")
          .update({ notas: newNotes, updated_at: new Date().toISOString() })
          .eq("id", workItem.id));
      } else {
        // Default to work_items
        ({ error } = await supabase
          .from("work_items")
          .update({ notes: newNotes, updated_at: new Date().toISOString() })
          .eq("id", workItem.id));
      }

      if (error) throw error;
      return newNotes;
    },
    onSuccess: () => {
      setLastSaved(new Date());
      setHasUnsavedChanges(false);
      queryClient.invalidateQueries({ queryKey: ["work-item-detail", workItem.id] });
    },
    onError: (error) => {
      console.error("Error saving notes:", error);
      toast.error("Error al guardar notas");
    },
  });

  // Handle text change
  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    setNotes(newValue);
    setHasUnsavedChanges(newValue !== (workItem.notes || ""));
  }, [workItem.notes]);

  // Manual save
  const handleSave = useCallback(() => {
    saveMutation.mutate(notes);
  }, [notes, saveMutation]);

  // Autosave with debounce (3 seconds)
  useEffect(() => {
    if (!hasUnsavedChanges) return;

    const timer = setTimeout(() => {
      saveMutation.mutate(notes);
    }, 3000);

    return () => clearTimeout(timer);
  }, [notes, hasUnsavedChanges]);

  // Keyboard shortcut: Ctrl+S / Cmd+S
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (hasUnsavedChanges) {
          handleSave();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [hasUnsavedChanges, handleSave]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <StickyNote className="h-5 w-5" />
              Notas
            </CardTitle>
            <div className="flex items-center gap-3">
              {/* Status indicator */}
              {saveMutation.isPending ? (
                <Badge variant="secondary" className="gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Guardando...
                </Badge>
              ) : hasUnsavedChanges ? (
                <Badge variant="outline" className="gap-1 text-amber-600 border-amber-300 bg-amber-50 dark:bg-amber-900/20">
                  <Clock className="h-3 w-3" />
                  Sin guardar
                </Badge>
              ) : lastSaved ? (
                <Badge variant="outline" className="gap-1 text-emerald-600 border-emerald-300 bg-emerald-50 dark:bg-emerald-900/20">
                  <CheckCircle className="h-3 w-3" />
                  Guardado {formatDistanceToNow(lastSaved, { addSuffix: true, locale: es })}
                </Badge>
              ) : null}
              
              {/* Save button */}
              <Button
                size="sm"
                onClick={handleSave}
                disabled={!hasUnsavedChanges || saveMutation.isPending}
              >
                {saveMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                Guardar
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Textarea
            value={notes}
            onChange={handleChange}
            placeholder="Escribe una nota para este asunto...

Ejemplos de uso:
• Tareas pendientes por realizar
• Números o IDs importantes
• Recordatorios breves
• Detalles de negociación
• Próxima acción a tomar"
            className={cn(
              "min-h-[300px] resize-y font-mono text-sm",
              hasUnsavedChanges && "border-amber-300 focus:ring-amber-300"
            )}
          />
          <p className="text-xs text-muted-foreground mt-2">
            Tip: Usa Ctrl+S (o ⌘+S) para guardar rápidamente. Las notas se guardan automáticamente después de 3 segundos de inactividad.
          </p>
        </CardContent>
      </Card>

      {/* Last update info */}
      {workItem.updated_at && (
        <div className="text-xs text-muted-foreground text-right">
          Última actualización: {format(new Date(workItem.updated_at), "d MMM yyyy, HH:mm", { locale: es })}
        </div>
      )}
    </div>
  );
}
