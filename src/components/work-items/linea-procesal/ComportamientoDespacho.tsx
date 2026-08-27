/**
 * ComportamientoDespacho — YY2.
 *
 * One sentence describing how THIS court behaves, derived by the database from
 * observed reads (`public.despacho_behavior_statement`). Two rules:
 *
 *  · It is an OBSERVATION, never a rule: the wording says what we saw, over how
 *    many matters and how many days of reading.
 *  · While the evidence threshold is not met the component renders nothing at
 *    all. Silence is preferable to a claim the sample cannot support.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Landmark } from "lucide-react";

interface Props {
  workItemId: string;
}

export function ComportamientoDespacho({ workItemId }: Props) {
  const { data } = useQuery({
    queryKey: ["despacho-behavior", workItemId],
    queryFn: async () => {
      const { data: wi, error } = await supabase
        .from("work_items")
        .select("radicado")
        .eq("id", workItemId)
        .maybeSingle();
      if (error) throw error;
      const radicado = wi?.radicado ?? "";
      if (!radicado) return null;

      const { data: statement, error: rpcError } = await supabase.rpc(
        "despacho_behavior_statement",
        { p_radicado: radicado },
      );
      if (rpcError) throw rpcError;
      return typeof statement === "string" && statement.length > 0 ? statement : null;
    },
    staleTime: 30 * 60 * 1000,
  });

  if (!data) return null;

  return (
    <Alert className="border-primary/30 bg-primary/5">
      <Landmark className="h-4 w-4" />
      <AlertDescription className="text-sm">
        <span className="font-medium">Comportamiento observado del despacho. </span>
        {data}
        <span className="block text-xs text-muted-foreground mt-1">
          Es una observación de Andrómeda sobre lo que el despacho ha entregado, no una regla
          procesal. Se recalcula a medida que hay más lecturas.
        </span>
      </AlertDescription>
    </Alert>
  );
}
