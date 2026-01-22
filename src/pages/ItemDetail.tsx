/**
 * ItemDetail - Unified detail page that routes to the correct workflow detail module
 * 
 * This page is the canonical entry point for viewing any work item.
 * It fetches the item, determines its workflow_type, and renders the appropriate detail module.
 */

import { useParams, Navigate, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, AlertCircle } from "lucide-react";

// Import workflow-specific detail modules (to be created/refactored later)
// For now, we redirect to existing pages based on workflow type

export default function ItemDetail() {
  const { id } = useParams<{ id: string }>();

  // First try to fetch from work_items
  const { data: workItem, isLoading: loadingWorkItem, error: workItemError } = useQuery({
    queryKey: ["work-item", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("work_items")
        .select(`
          *,
          clients(id, name)
        `)
        .eq("id", id!)
        .maybeSingle();
      
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  // If not found in work_items, check legacy tables
  const { data: legacyItem, isLoading: loadingLegacy } = useQuery({
    queryKey: ["legacy-item", id],
    queryFn: async () => {
      // Check cgp_items first
      const { data: cgpItem } = await supabase
        .from("cgp_items")
        .select("id, phase")
        .eq("id", id!)
        .maybeSingle();
      
      if (cgpItem) {
        return { type: 'CGP', id: cgpItem.id };
      }

      // Check peticiones
      const { data: peticion } = await supabase
        .from("peticiones")
        .select("id")
        .eq("id", id!)
        .maybeSingle();
      
      if (peticion) {
        return { type: 'PETICION', id: peticion.id };
      }

      // Check cpaca_processes
      const { data: cpaca } = await supabase
        .from("cpaca_processes")
        .select("id")
        .eq("id", id!)
        .maybeSingle();
      
      if (cpaca) {
        return { type: 'CPACA', id: cpaca.id };
      }

      // Check monitored_processes for administrative processes
      const { data: adminProcess } = await supabase
        .from("monitored_processes")
        .select("id, process_type")
        .eq("id", id!)
        .eq("process_type", "ADMINISTRATIVE")
        .maybeSingle();
      
      if (adminProcess) {
        return { type: 'GOV_PROCEDURE', id: adminProcess.id };
      }

      // Check monitored_processes (legacy CGP)
      const { data: monitoredProcess } = await supabase
        .from("monitored_processes")
        .select("id")
        .eq("id", id!)
        .maybeSingle();
      
      if (monitoredProcess) {
        return { type: 'LEGACY_PROCESS', id: monitoredProcess.id };
      }

      // Check filings (legacy CGP)
      const { data: filing } = await supabase
        .from("filings")
        .select("id")
        .eq("id", id!)
        .maybeSingle();
      
      if (filing) {
        return { type: 'LEGACY_FILING', id: filing.id };
      }

      return null;
    },
    enabled: !!id && !workItem && !loadingWorkItem,
  });

  const isLoading = loadingWorkItem || (loadingLegacy && !workItem);

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

  // If found in work_items, route based on workflow_type
  if (workItem) {
    switch (workItem.workflow_type) {
      case 'CGP':
        // For now, redirect to legacy CGP detail
        if (workItem.legacy_cgp_item_id) {
          return <Navigate to={`/cgp/${workItem.legacy_cgp_item_id}`} replace />;
        }
        // If no legacy ID, still go to CGP route
        return <Navigate to={`/cgp/${workItem.id}`} replace />;
      
      case 'PETICION':
        if (workItem.legacy_peticion_id) {
          return <Navigate to={`/peticiones/${workItem.legacy_peticion_id}`} replace />;
        }
        return <Navigate to={`/peticiones/${workItem.id}`} replace />;
      
      case 'TUTELA':
        // Tutelas currently use filings table
        if (workItem.legacy_filing_id) {
          return <Navigate to={`/cgp/${workItem.legacy_filing_id}`} replace />;
        }
        return <Navigate to={`/cgp/${workItem.id}`} replace />;
      
      case 'GOV_PROCEDURE':
        if (workItem.legacy_admin_process_id) {
          return <Navigate to={`/admin-processes/${workItem.legacy_admin_process_id}`} replace />;
        }
        return <Navigate to={`/admin-processes/${workItem.id}`} replace />;
      
      case 'CPACA':
        if (workItem.legacy_cpaca_id) {
          return <Navigate to={`/cpaca/${workItem.legacy_cpaca_id}`} replace />;
        }
        return <Navigate to={`/cpaca/${workItem.id}`} replace />;
      
      default:
        // Unknown type, show generic view
        return (
          <div className="space-y-6">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="icon" asChild>
                <Link to="/">
                  <ArrowLeft className="h-5 w-5" />
                </Link>
              </Button>
              <div>
                <h1 className="text-2xl font-bold">Detalle del Asunto</h1>
                <p className="text-muted-foreground">
                  Tipo: {workItem.workflow_type}
                </p>
              </div>
            </div>
          </div>
        );
    }
  }

  // If found in legacy tables, redirect accordingly
  if (legacyItem) {
    switch (legacyItem.type) {
      case 'CGP':
        return <Navigate to={`/cgp/${legacyItem.id}`} replace />;
      case 'PETICION':
        return <Navigate to={`/peticiones/${legacyItem.id}`} replace />;
      case 'CPACA':
        return <Navigate to={`/cpaca/${legacyItem.id}`} replace />;
      case 'GOV_PROCEDURE':
        return <Navigate to={`/admin-processes/${legacyItem.id}`} replace />;
      case 'LEGACY_PROCESS':
        // Try to find linked CGP item
        return <Navigate to={`/cgp/${legacyItem.id}`} replace />;
      case 'LEGACY_FILING':
        return <Navigate to={`/cgp/${legacyItem.id}`} replace />;
    }
  }

  // Not found
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
