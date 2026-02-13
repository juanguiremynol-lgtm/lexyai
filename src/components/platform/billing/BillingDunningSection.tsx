/**
 * Billing Dunning & Collections Section — Phase 2 placeholder with dunning schedule view
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Construction } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";

export function BillingDunningSection() {
  const { data: dunningEntries, isLoading } = useQuery({
    queryKey: ["platform-dunning-schedule"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dunning_schedule")
        .select("*")
        .order("scheduled_at", { ascending: true })
        .limit(50);
      if (error) throw error;

      const orgIds = [...new Set((data || []).map((d) => d.organization_id))];
      if (orgIds.length === 0) return [];
      const { data: orgs } = await supabase.from("organizations").select("id, name").in("id", orgIds);
      const orgMap = new Map((orgs || []).map((o) => [o.id, o.name]));

      return (data || []).map((d) => ({ ...d, org_name: orgMap.get(d.organization_id) || "—" }));
    },
    staleTime: 30_000,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
          <AlertTriangle className="h-6 w-6 text-amber-400" />
          Cobros y Morosidad
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          Programación de intentos de cobro, escalamiento y suspensión automática.
        </p>
      </div>

      <Card className="bg-slate-900/50 border-amber-500/20">
        <CardContent className="pt-6">
          <div className="flex items-center gap-3 text-amber-400">
            <Construction className="h-5 w-5" />
            <div>
              <p className="font-medium">Fase 2 — En Desarrollo</p>
              <p className="text-sm text-slate-400 mt-1">
                La lógica de dunning automático (reintentos, notificaciones, suspensión) se implementará con la integración real de Wompi.
                La tabla dunning_schedule ya está lista para recibir programaciones.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Dunning Schedule Table */}
      <Card className="bg-slate-900/50 border-slate-700/50">
        <CardHeader>
          <CardTitle className="text-slate-100 text-base">Programación de Cobros</CardTitle>
          <CardDescription className="text-slate-400">
            Intentos de cobro programados por Atenia AI.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-slate-400">Cargando...</p>
          ) : (dunningEntries?.length || 0) === 0 ? (
            <p className="text-sm text-slate-500">No hay intentos de cobro programados.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-slate-400 border-b border-slate-700/50">
                    <th className="text-left py-2 px-2">Organización</th>
                    <th className="text-left py-2 px-2">Intento</th>
                    <th className="text-left py-2 px-2">Programado</th>
                    <th className="text-left py-2 px-2">Estado</th>
                    <th className="text-left py-2 px-2">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {dunningEntries?.map((d: any) => (
                    <tr key={d.id} className="border-b border-slate-800/50">
                      <td className="py-2 px-2 text-slate-200">{d.org_name}</td>
                      <td className="py-2 px-2 text-slate-300">#{d.attempt_number}</td>
                      <td className="py-2 px-2 text-slate-400">
                        {format(new Date(d.scheduled_at), "dd MMM yyyy HH:mm", { locale: es })}
                      </td>
                      <td className="py-2 px-2">
                        <Badge variant="outline">{d.status}</Badge>
                      </td>
                      <td className="py-2 px-2 text-slate-400">{d.action_type}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
