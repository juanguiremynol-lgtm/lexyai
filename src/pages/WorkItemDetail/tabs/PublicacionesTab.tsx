/**
 * PublicacionesTab - Court Publications tab for WorkItemDetail
 * 
 * Displays court publications (estados electrónicos, edictos, PDFs) for a work item.
 * NOTE: Sync happens automatically on login and via daily cron - no manual sync button.
 * Only a local refresh button is provided to re-query the database.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  RefreshCw, 
  FileText, 
  ExternalLink, 
  Calendar, 
  AlertCircle,
  FileWarning,
} from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";
import type { WorkItem } from "@/types/work-item";

interface PublicacionesTabProps {
  workItem: WorkItem;
}

interface Publicacion {
  id: string;
  work_item_id: string;
  source: string;
  title: string;
  annotation: string | null;
  pdf_url: string | null;
  published_at: string | null;
  created_at: string;
}

export function PublicacionesTab({ workItem }: PublicacionesTabProps) {
  const queryClient = useQueryClient();

  // Fetch publications
  const { data: publicaciones, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["work-item-publicaciones", workItem.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("work_item_publicaciones")
        .select("*")
        .eq("work_item_id", workItem.id)
        .order("published_at", { ascending: false, nullsFirst: false });
      
      if (error) throw error;
      return data as Publicacion[];
    },
  });

  // Check if radicado is valid
  const hasValidRadicado = workItem.radicado && workItem.radicado.replace(/\D/g, "").length === 23;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <Card className="border-destructive/50">
        <CardContent className="pt-6">
          <div className="flex items-center gap-2 text-destructive">
            <AlertCircle className="h-5 w-5" />
            <span>Error al cargar publicaciones: {(error as Error).message}</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with local refresh button only */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Publicaciones Procesales</h3>
          <p className="text-sm text-muted-foreground">
            Estados electrónicos, edictos y documentos publicados por el despacho.
            Se sincronizan automáticamente al iniciar sesión.
          </p>
        </div>
        
        <div className="flex items-center gap-2">
          {!hasValidRadicado && (
            <Badge variant="outline" className="text-amber-600 border-amber-300">
              <FileWarning className="h-3 w-3 mr-1" />
              Requiere radicado
            </Badge>
          )}
          
          {/* Local refresh button - only re-queries database, doesn't call edge function */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => refetch()}
            disabled={isFetching}
            title="Actualizar vista"
          >
            <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
          </Button>
        </div>
      </div>

      {/* Publications list */}
      {!publicaciones || publicaciones.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="text-center space-y-3">
              <FileText className="h-12 w-12 mx-auto text-muted-foreground/50" />
              <div>
                <h4 className="font-medium">Sin publicaciones</h4>
                <p className="text-sm text-muted-foreground">
                  {hasValidRadicado
                    ? "No se han encontrado publicaciones para este proceso. Las publicaciones se sincronizan automáticamente al iniciar sesión y cada día a las 7:00 AM."
                    : "Este proceso necesita un radicado válido (23 dígitos) para buscar publicaciones."
                  }
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {publicaciones.map((pub) => (
            <Card key={pub.id} className="hover:border-primary/30 transition-colors">
              <CardContent className="py-4">
                <div className="flex items-start gap-4">
                  <div className="p-2 rounded-lg bg-primary/10 shrink-0">
                    <FileText className="h-5 w-5 text-primary" />
                  </div>
                  
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="font-medium leading-tight">{pub.title}</h4>
                      {pub.pdf_url && (
                        <Button variant="outline" size="sm" asChild className="shrink-0">
                          <a href={pub.pdf_url} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="h-3 w-3 mr-1" />
                            Abrir PDF
                          </a>
                        </Button>
                      )}
                    </div>
                    
                    {pub.annotation && (
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {pub.annotation}
                      </p>
                    )}
                    
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      {pub.published_at && (
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {format(new Date(pub.published_at), "d MMM yyyy", { locale: es })}
                        </span>
                      )}
                      <Badge variant="outline" className="text-xs">
                        {pub.source}
                      </Badge>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
