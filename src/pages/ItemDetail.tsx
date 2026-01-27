/**
 * ItemDetail - Unified detail page that routes to the canonical work-items detail
 * 
 * This page redirects all items to /work-items/:id which is the single canonical detail view.
 */

import { useParams, Navigate, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle } from "lucide-react";

export default function ItemDetail() {
  const { id } = useParams<{ id: string }>();

  // Check if item exists in work_items or legacy tables
  const { data: itemExists, isLoading } = useQuery({
    queryKey: ["item-exists", id],
    queryFn: async () => {
      // Check work_items
      const { data: workItem } = await supabase
        .from("work_items")
        .select("id")
        .eq("id", id!)
        .maybeSingle();
      
      if (workItem) return { id: workItem.id };

      // Check cgp_items
      const { data: cgpItem } = await supabase
        .from("cgp_items")
        .select("id")
        .eq("id", id!)
        .maybeSingle();
      
      if (cgpItem) return { id: cgpItem.id };

      // Check peticiones
      const { data: peticion } = await supabase
        .from("peticiones")
        .select("id")
        .eq("id", id!)
        .maybeSingle();
      
      if (peticion) return { id: peticion.id };

      // Check cpaca_processes
      const { data: cpaca } = await supabase
        .from("cpaca_processes")
        .select("id")
        .eq("id", id!)
        .maybeSingle();
      
      if (cpaca) return { id: cpaca.id };

      // Check monitored_processes
      const { data: process } = await supabase
        .from("monitored_processes")
        .select("id")
        .eq("id", id!)
        .maybeSingle();
      
      if (process) return { id: process.id };

      // Check filings
      const { data: filing } = await supabase
        .from("filings")
        .select("id")
        .eq("id", id!)
        .maybeSingle();
      
      if (filing) return { id: filing.id };

      return null;
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
      </div>
    );
  }

  // If found, redirect to canonical work-items detail
  if (itemExists) {
    return <Navigate to={`/app/work-items/${itemExists.id}`} replace />;
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
