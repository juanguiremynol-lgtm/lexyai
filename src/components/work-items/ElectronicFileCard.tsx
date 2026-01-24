/**
 * ElectronicFileCard - Dedicated card for managing OneDrive/SharePoint expediente link
 * 
 * This is a critical milestone for judicial processes:
 * - Courts send the electronic file link via email
 * - Lawyers must save and access this link frequently
 */

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { 
  Link2, 
  ExternalLink, 
  Save, 
  Edit2, 
  X,
  FolderOpen,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

import type { WorkItem } from "@/types/work-item";

interface ElectronicFileCardProps {
  workItem: WorkItem & { _source?: string };
}

export function ElectronicFileCard({ workItem }: ElectronicFileCardProps) {
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [url, setUrl] = useState(workItem.expediente_url || "");
  
  const hasUrl = !!workItem.expediente_url;

  // Save URL mutation
  const saveUrlMutation = useMutation({
    mutationFn: async (newUrl: string) => {
      const source = workItem._source;
      let error;
      
      // Update based on source table
      if (source === "work_items") {
        ({ error } = await supabase
          .from("work_items")
          .update({ expediente_url: newUrl || null })
          .eq("id", workItem.id));
      } else if (source === "cgp_items") {
        ({ error } = await supabase
          .from("cgp_items")
          .update({ expediente_url: newUrl || null })
          .eq("id", workItem.id));
      } else {
        // For other legacy tables, try work_items first
        ({ error } = await supabase
          .from("work_items")
          .update({ expediente_url: newUrl || null })
          .eq("id", workItem.id));
      }
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["work-item-detail", workItem.id] });
      toast.success("Enlace del expediente guardado");
      setIsEditing(false);
    },
    onError: (error) => {
      toast.error("Error al guardar: " + error.message);
    },
  });

  const handleSave = () => {
    // Basic URL validation
    if (url && !url.startsWith("http")) {
      toast.error("El enlace debe comenzar con http:// o https://");
      return;
    }
    saveUrlMutation.mutate(url.trim());
  };

  const handleCancel = () => {
    setUrl(workItem.expediente_url || "");
    setIsEditing(false);
  };

  const isValidUrl = (urlString: string) => {
    if (!urlString) return true;
    try {
      const url = new URL(urlString);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  };

  const isOneDriveOrSharePoint = (urlString: string) => {
    if (!urlString) return false;
    const lowerUrl = urlString.toLowerCase();
    return lowerUrl.includes("sharepoint") || 
           lowerUrl.includes("onedrive") || 
           lowerUrl.includes("1drv.ms") ||
           lowerUrl.includes("office.com") ||
           lowerUrl.includes("teams.microsoft");
  };

  return (
    <Card className={cn(
      "transition-colors",
      hasUrl 
        ? "border-emerald-500/30 bg-emerald-50/30 dark:bg-emerald-950/10" 
        : "border-amber-500/30 bg-amber-50/30 dark:bg-amber-950/10"
    )}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <FolderOpen className={cn(
            "h-5 w-5",
            hasUrl ? "text-emerald-600" : "text-amber-600"
          )} />
          Expediente Electrónico
          {hasUrl ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-500 ml-auto" />
          ) : (
            <AlertCircle className="h-4 w-4 text-amber-500 ml-auto" />
          )}
        </CardTitle>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* Editing mode */}
        {isEditing ? (
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="expediente-url" className="text-sm">
                Enlace al expediente (OneDrive, SharePoint, etc.)
              </Label>
              <Input
                id="expediente-url"
                type="url"
                placeholder="https://..."
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className={cn(
                  !isValidUrl(url) && url && "border-destructive"
                )}
              />
              {url && !isValidUrl(url) && (
                <p className="text-xs text-destructive">
                  Ingrese una URL válida
                </p>
              )}
              {url && isValidUrl(url) && !isOneDriveOrSharePoint(url) && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  ⚠️ Este enlace no parece ser de OneDrive o SharePoint
                </p>
              )}
            </div>
            
            <p className="text-xs text-muted-foreground">
              El juzgado generalmente envía este enlace por correo electrónico.
              Puede ser un enlace de OneDrive, SharePoint o Microsoft Teams.
            </p>
            
            <div className="flex items-center gap-2">
              <Button 
                onClick={handleSave} 
                disabled={saveUrlMutation.isPending || (url && !isValidUrl(url))}
                size="sm"
              >
                <Save className="h-4 w-4 mr-2" />
                Guardar
              </Button>
              <Button 
                variant="ghost" 
                onClick={handleCancel}
                size="sm"
              >
                <X className="h-4 w-4 mr-2" />
                Cancelar
              </Button>
            </div>
          </div>
        ) : hasUrl ? (
          /* Has URL - show open button */
          <div className="space-y-3">
            <Button 
              className="w-full" 
              size="lg"
              asChild
            >
              <a 
                href={workItem.expediente_url!} 
                target="_blank" 
                rel="noopener noreferrer"
              >
                <ExternalLink className="h-5 w-5 mr-2" />
                Abrir Expediente Electrónico
              </a>
            </Button>
            
            <div className="flex items-center justify-between text-sm">
              <code className="text-xs text-muted-foreground truncate max-w-[200px]">
                {workItem.expediente_url}
              </code>
              <Button 
                variant="ghost" 
                size="sm"
                onClick={() => setIsEditing(true)}
              >
                <Edit2 className="h-3 w-3 mr-1" />
                Editar
              </Button>
            </div>
          </div>
        ) : (
          /* No URL - show input prompt */
          <div className="space-y-3">
            <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-100/50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
              <AlertCircle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                  Sin enlace al expediente
                </p>
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  El juzgado envía el enlace al expediente electrónico por correo.
                  Agregue el enlace aquí para acceder rápidamente.
                </p>
              </div>
            </div>
            
            <Button 
              variant="outline" 
              className="w-full"
              onClick={() => setIsEditing(true)}
            >
              <Link2 className="h-4 w-4 mr-2" />
              Agregar Enlace del Expediente
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
