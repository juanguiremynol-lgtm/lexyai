import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";

/**
 * Process Detail Redirect
 * 
 * This page redirects from the old /processes/:id route to the canonical
 * /filings/:id detail view. It resolves the linked filing for a process
 * and redirects appropriately.
 */
export default function ProcessDetailRedirect() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [redirected, setRedirected] = useState(false);

  // Fetch process to find its linked filing
  const { data: process, isLoading: processLoading, error: processError } = useQuery({
    queryKey: ["process-redirect-lookup", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("monitored_processes")
        .select("id, linked_filing_id, radicado")
        .eq("id", id!)
        .maybeSingle();
      
      if (error) throw error;
      return data;
    },
    enabled: !!id && !redirected,
  });

  // If process has a linked filing, use that
  // Otherwise, find any filing linked to this process
  const { data: filingId, isLoading: filingLoading } = useQuery({
    queryKey: ["process-filing-lookup", id, process?.linked_filing_id],
    queryFn: async () => {
      // Process has a direct linked filing
      if (process?.linked_filing_id) {
        return process.linked_filing_id;
      }

      // Look for any filing that references this process
      const { data: linkedFilings, error } = await supabase
        .from("filings")
        .select("id")
        .eq("linked_process_id", id!)
        .order("created_at", { ascending: true })
        .limit(1);
      
      if (error) throw error;
      return linkedFilings?.[0]?.id || null;
    },
    enabled: !!id && process !== undefined && !redirected,
  });

  // Redirect effect
  useEffect(() => {
    if (processLoading || filingLoading || redirected) return;

    // If we found a filing, redirect to the filing detail page with process context
    if (filingId) {
      setRedirected(true);
      navigate(`/filings/${filingId}?processId=${id}`, { replace: true });
      return;
    }

    // If we have a process but no filing, create a temporary filing context
    // For now, redirect to processes list with a toast
    if (process && !filingId) {
      // The process exists but has no linked filing
      // In this case, we still redirect but show the filing page will handle it
      setRedirected(true);
      // Try to find if the ID might be a filing directly
      supabase
        .from("filings")
        .select("id")
        .eq("id", id!)
        .maybeSingle()
        .then(({ data: directFiling }) => {
          if (directFiling) {
            navigate(`/filings/${directFiling.id}`, { replace: true });
          } else {
            // No filing found, go back to processes list
            navigate("/processes", { replace: true });
          }
        });
      return;
    }

    // Process not found - check if it's a filing ID
    if (!process && !processLoading) {
      setRedirected(true);
      supabase
        .from("filings")
        .select("id")
        .eq("id", id!)
        .maybeSingle()
        .then(({ data: directFiling }) => {
          if (directFiling) {
            navigate(`/filings/${directFiling.id}`, { replace: true });
          } else {
            // Nothing found, 404-like behavior
            navigate("/processes", { replace: true });
          }
        });
    }
  }, [process, filingId, processLoading, filingLoading, navigate, id, redirected]);

  return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      <span className="ml-3 text-muted-foreground">Cargando caso...</span>
    </div>
  );
}
