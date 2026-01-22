/**
 * WorkItemDetail - Unified detail page that renders workflow-specific content
 * 
 * This page is the canonical entry point for viewing any work item.
 * It fetches the work_item, determines its workflow_type, and renders the appropriate detail module.
 */

import { useParams, Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, AlertCircle } from "lucide-react";

// Import workflow-specific detail modules
import CGPDetailModule from "./WorkItemDetail/CGPDetailModule";
import PeticionDetailModule from "./WorkItemDetail/PeticionDetailModule";
import TutelaDetailModule from "./WorkItemDetail/TutelaDetailModule";
import CpacaDetailModule from "./WorkItemDetail/CpacaDetailModule";
import GovProcedureDetailModule from "./WorkItemDetail/GovProcedureDetailModule";

import type { WorkItem } from "@/types/work-item";

export default function WorkItemDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  // Fetch work item
  const { data: workItem, isLoading, error } = useQuery({
    queryKey: ["work-item-detail", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("work_items")
        .select(`
          *,
          clients(id, name),
          matters(id, matter_name)
        `)
        .eq("id", id!)
        .maybeSingle();
      
      if (error) throw error;
      return data as WorkItem | null;
    },
    enabled: !!id,
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-10" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-64" />
            <Skeleton className="h-4 w-40" />
          </div>
        </div>
        <Skeleton className="h-[200px] w-full" />
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12 space-y-4">
        <AlertCircle className="h-12 w-12 text-destructive" />
        <h2 className="text-xl font-semibold">Error al cargar</h2>
        <p className="text-muted-foreground">
          No se pudo cargar el asunto. {(error as Error).message}
        </p>
        <Button onClick={() => navigate(-1)}>Volver</Button>
      </div>
    );
  }

  if (!workItem) {
    return (
      <div className="flex flex-col items-center justify-center py-12 space-y-4">
        <AlertCircle className="h-12 w-12 text-muted-foreground" />
        <h2 className="text-xl font-semibold">Asunto no encontrado</h2>
        <p className="text-muted-foreground">
          El asunto con ID {id} no existe o no tienes acceso.
        </p>
        <Button asChild>
          <Link to="/">Volver al inicio</Link>
        </Button>
      </div>
    );
  }

  // Render the appropriate detail module based on workflow_type
  switch (workItem.workflow_type) {
    case 'CGP':
      return <CGPDetailModule workItem={workItem} />;
    
    case 'PETICION':
      return <PeticionDetailModule workItem={workItem} />;
    
    case 'TUTELA':
      return <TutelaDetailModule workItem={workItem} />;
    
    case 'CPACA':
      return <CpacaDetailModule workItem={workItem} />;
    
    case 'GOV_PROCEDURE':
      return <GovProcedureDetailModule workItem={workItem} />;
    
    default:
      // Unknown workflow type - show generic view
      return (
        <div className="space-y-6">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold">Detalle del Asunto</h1>
              <p className="text-muted-foreground">
                Tipo: {workItem.workflow_type}
              </p>
            </div>
          </div>
          <div className="p-6 border rounded-lg">
            <pre className="text-sm text-muted-foreground overflow-auto">
              {JSON.stringify(workItem, null, 2)}
            </pre>
          </div>
        </div>
      );
  }
}
