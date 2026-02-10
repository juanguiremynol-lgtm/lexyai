/**
 * AdminCourthouseDirectoryTab - Admin UI for reimporting courthouse directory
 */

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Building2, Upload, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

export function AdminCourthouseDirectoryTab() {
  const [importResult, setImportResult] = useState<Record<string, unknown> | null>(null);

  // Count records in directory
  const { data: dirCount, isLoading: countLoading } = useQuery({
    queryKey: ["courthouse-directory-count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("courthouse_directory")
        .select("id", { count: "exact", head: true });
      if (error) throw error;
      return count || 0;
    },
  });

  // Import mutation
  const importMutation = useMutation({
    mutationFn: async () => {
      // Fetch the JSON from the public asset
      const resp = await fetch("/seed/directorio_juzgados_completo.json");
      if (!resp.ok) throw new Error("Could not load directory JSON file");
      const records = await resp.json();

      const { data, error } = await supabase.functions.invoke("import-courthouse-directory", {
        body: { records },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      setImportResult(data);
      if (data?.ok) {
        toast.success(`Directorio importado: ${data.inserted} registros procesados`);
      } else {
        toast.error("Error en importación: " + (data?.error || "desconocido"));
      }
    },
    onError: (err: Error) => {
      toast.error("Error: " + err.message);
    },
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Directorio de Despachos Judiciales
          </CardTitle>
          <CardDescription>
            Directorio de emails de despachos judiciales colombianos. Se usa para resolver automáticamente 
            el email correcto del despacho al crear o actualizar un caso.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Registros en directorio</p>
              <p className="text-2xl font-bold">
                {countLoading ? "..." : dirCount?.toLocaleString()}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button
              onClick={() => importMutation.mutate()}
              disabled={importMutation.isPending}
              className="gap-2"
            >
              {importMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              {dirCount && dirCount > 0 ? "Reimportar Directorio" : "Importar Directorio"}
            </Button>
            <p className="text-xs text-muted-foreground">
              Fuente: directorio_juzgados_completo.json • Idempotente (no crea duplicados)
            </p>
          </div>

          {importResult && (
            <Card className={importResult.ok ? "border-emerald-300" : "border-destructive"}>
              <CardContent className="py-3">
                <div className="flex items-start gap-2">
                  {importResult.ok ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-destructive mt-0.5" />
                  )}
                  <div className="text-sm space-y-1">
                    <p>
                      <strong>Total registros:</strong> {String(importResult.total_records)}
                    </p>
                    <p>
                      <strong>Insertados/actualizados:</strong> {String(importResult.inserted)}
                    </p>
                    {(importResult.errors_count as number) > 0 && (
                      <div>
                        <p className="text-destructive">
                          <strong>Errores:</strong> {String(importResult.errors_count)}
                        </p>
                        <ul className="text-xs text-muted-foreground mt-1 space-y-0.5">
                          {((importResult.errors as string[]) || []).slice(0, 5).map((e, i) => (
                            <li key={i}>• {e}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
