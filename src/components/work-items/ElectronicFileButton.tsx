/**
 * ElectronicFileButton - Prominent button to open OneDrive/SharePoint electronic file
 * 
 * Shows in Work Item Detail header when onedrive_url or sharepoint_url is set
 */

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { 
  FolderOpen, 
  ExternalLink, 
  Plus,
  Loader2,
  AlertCircle,
  Pencil,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { WorkItem } from "@/types/work-item";

interface ElectronicFileButtonProps {
  workItem: WorkItem & { 
    onedrive_url?: string | null;
    sharepoint_url?: string | null;
  };
  className?: string;
}

function isValidUrl(url: string): boolean {
  if (!url || url.trim() === "") return false;
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

export function ElectronicFileButton({ workItem, className }: ElectronicFileButtonProps) {
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);

  // Get the URL - prefer sharepoint_url, fallback to onedrive_url, then expediente_url
  const electronicFileUrl = workItem.sharepoint_url || workItem.onedrive_url || workItem.expediente_url;
  const hasUrl = !!electronicFileUrl && isValidUrl(electronicFileUrl);

  // Save mutation - stores in sharepoint_url (primary) and also expediente_url for backward compat
  const saveMutation = useMutation({
    mutationFn: async (url: string | null) => {
      const { error } = await supabase
        .from("work_items")
        .update({ 
          sharepoint_url: url,
          expediente_url: url,
          updated_at: new Date().toISOString() 
        })
        .eq("id", workItem.id);

      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Enlace guardado");
      setIsOpen(false);
      setInputValue("");
      setInputError(null);
      queryClient.invalidateQueries({ queryKey: ["work-item-detail", workItem.id] });
    },
    onError: (error) => {
      console.error("Error saving:", error);
      toast.error("Error al guardar el enlace");
    },
  });

  const handleOpen = () => {
    setInputValue(electronicFileUrl || "");
    setInputError(null);
    setIsOpen(true);
  };

  const handleSave = () => {
    const trimmedValue = inputValue.trim();
    
    if (trimmedValue === "") {
      saveMutation.mutate(null);
      return;
    }

    if (!isValidUrl(trimmedValue)) {
      setInputError("Por favor ingresa una URL válida que comience con https://");
      return;
    }

    saveMutation.mutate(trimmedValue);
  };

  // If URL exists, show button to open it
  if (hasUrl) {
    return (
      <div className={cn("flex items-center gap-1", className)}>
        <Button variant="default" asChild className="gap-2">
          <a href={electronicFileUrl!} target="_blank" rel="noopener noreferrer">
            <FolderOpen className="h-4 w-4" />
            Abrir Expediente Electrónico
            <ExternalLink className="h-3 w-3" />
          </a>
        </Button>
        
        {/* Edit button */}
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button 
              variant="ghost" 
              size="icon"
              className="h-9 w-9"
              onClick={handleOpen}
            >
              <Pencil className="h-4 w-4" />
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Editar Enlace del Expediente Electrónico</DialogTitle>
              <DialogDescription>
                Actualiza o elimina el enlace de OneDrive/SharePoint al expediente electrónico.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Input
                  value={inputValue}
                  onChange={(e) => {
                    setInputValue(e.target.value);
                    setInputError(null);
                  }}
                  placeholder="https://onedrive.live.com/... o https://sharepoint.com/..."
                  className={cn(inputError && "border-destructive")}
                />
                {inputError && (
                  <p className="text-sm text-destructive flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />
                    {inputError}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Deja vacío para eliminar el enlace.
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={handleSave} disabled={saveMutation.isPending}>
                {saveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Guardar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // If no URL, show button to add one
  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button 
          variant="outline" 
          className={cn("gap-2", className)}
          onClick={handleOpen}
        >
          <Plus className="h-4 w-4" />
          Agregar Expediente Electrónico
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Agregar Expediente Electrónico</DialogTitle>
          <DialogDescription>
            Pega el enlace de OneDrive o SharePoint al expediente electrónico compartido por el despacho.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Input
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value);
                setInputError(null);
              }}
              placeholder="https://onedrive.live.com/... o https://sharepoint.com/..."
              className={cn(inputError && "border-destructive")}
              autoFocus
            />
            {inputError && (
              <p className="text-sm text-destructive flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                {inputError}
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setIsOpen(false)}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saveMutation.isPending || !inputValue.trim()}>
            {saveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
