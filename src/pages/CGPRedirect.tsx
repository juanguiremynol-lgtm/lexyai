import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";

/**
 * CGPRedirect - Handles backwards compatibility redirects for old routes
 * 
 * This component redirects:
 * - /filings/:id → /cgp/:cgpItemId (resolve via legacy_filing_id)
 * - /processes/:id → /cgp/:cgpItemId (resolve via legacy_process_id)
 * - /process-status/:id → /cgp/:cgpItemId (resolve via legacy_process_id)
 * 
 * If no cgp_item is found, it falls back to the old detail pages.
 */
export default function CGPRedirect({ type }: { type: "filing" | "process" }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!id) {
      navigate("/processes");
      return;
    }

    const resolveAndRedirect = async () => {
      try {
        // Try to find a cgp_item with this legacy ID
        const column = type === "filing" ? "legacy_filing_id" : "legacy_process_id";
        
        const { data: cgpItem, error } = await supabase
          .from("cgp_items")
          .select("id")
          .eq(column, id)
          .maybeSingle();

        if (error) {
          console.error("Error resolving CGP item:", error);
          setNotFound(true);
          return;
        }

        if (cgpItem) {
          // Found! Redirect to the canonical CGP detail page
          navigate(`/app/work-items/${cgpItem.id}`, { replace: true });
        } else {
          // No cgp_item found - this might be a non-CGP item or legacy data
          // Try direct lookup in the canonical table
          const { data: directItem, error: directError } = await supabase
            .from("cgp_items")
            .select("id")
            .eq("id", id)
            .maybeSingle();

          if (directError) {
            console.error("Error looking up CGP item directly:", directError);
            setNotFound(true);
            return;
          }

          if (directItem) {
            // The ID itself is a cgp_item ID
            navigate(`/app/work-items/${directItem.id}`, { replace: true });
          } else {
            // Not found in cgp_items - show not found
            setNotFound(true);
          }
        }
      } catch (err) {
        console.error("Error in CGP redirect:", err);
        setNotFound(true);
      }
    };

    resolveAndRedirect();
  }, [id, type, navigate]);

  if (notFound) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <p className="text-muted-foreground">
          {type === "filing" ? "Radicación" : "Proceso"} no encontrado
        </p>
        <button 
          onClick={() => navigate("/processes")}
          className="text-primary hover:underline"
        >
          Volver a Casos CGP
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      <span className="ml-2 text-muted-foreground">Redirigiendo...</span>
    </div>
  );
}