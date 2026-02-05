import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { 
  AlertTriangle, 
  Loader2, 
  Trash2, 
  Database,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";

interface PurgeResult {
  ok: boolean;
  message: string;
  deleted_counts: {
    work_items: number;
    cgp_items: number;
    peticiones: number;
    cpaca_processes: number;
    process_events: number;
    actuaciones: number;
    documents: number;
    tasks: number;
    alerts: number;
    hearings: number;
    storage_files: number;
  };
  errors: string[];
}

export function PurgeLegacyDataSection() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  const REQUIRED_TEXT = "PURGE MY ORG";
  const isValid = understood && confirmText === REQUIRED_TEXT;

  // Fetch current data counts - only from existing tables
  const { data: counts, refetch: refetchCounts } = useQuery({
    queryKey: ["purge-data-counts"],
    queryFn: async () => {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) return null;

      const [workItems, cgp, cpaca, peticiones] = await Promise.all([
        supabase.from("work_items").select("id", { count: "exact", head: true }).eq("owner_id", user.user.id),
        supabase.from("cgp_items").select("id", { count: "exact", head: true }).eq("owner_id", user.user.id),
        supabase.from("cpaca_processes").select("id", { count: "exact", head: true }).eq("owner_id", user.user.id),
        supabase.from("peticiones").select("id", { count: "exact", head: true }).eq("owner_id", user.user.id),
      ]);

      return {
        work_items: workItems.count || 0,
        cgp_items: cgp.count || 0,
        cpaca_processes: cpaca.count || 0,
        peticiones: peticiones.count || 0,
        total: (workItems.count || 0) + (cgp.count || 0) + (cpaca.count || 0) + (peticiones.count || 0),
      };
    },
  });

  const purgeMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke<PurgeResult>("purge-organization-data", {
        body: { confirm_text: REQUIRED_TEXT },
      });

      if (error) throw error;
      if (!data?.ok && data?.errors?.length) {
        throw new Error(data.errors.join(", "));
      }
      return data;
    },
    onSuccess: (result) => {
      // Invalidate ALL queries
      queryClient.invalidateQueries();
      setDialogOpen(false);
      setUnderstood(false);
      setConfirmText("");
      
      const totalDeleted = result ? Object.values(result.deleted_counts).reduce((a, b) => a + b, 0) : 0;
      toast.success(`Purge completo: ${totalDeleted} registros eliminados`, {
        description: "Todos los datos legacy han sido eliminados.",
        duration: 10000,
      });
    },
    onError: (error: Error) => {
      toast.error(`Error durante purge: ${error.message}`);
    },
  });

  const handleClose = (open: boolean) => {
    if (!open) {
      setUnderstood(false);
      setConfirmText("");
    }
    setDialogOpen(open);
  };

  return (
    <Card className="border-destructive/50 bg-destructive/5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-destructive">
          <Database className="h-5 w-5" />
          Purgar Datos Legacy / Reset de Organización
        </CardTitle>
        <CardDescription>
          Elimina permanentemente todos los datos legacy creados antes de la migración a work_items.
          Esta acción limpia inconsistencias y elementos huérfanos.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Current data summary */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-base font-medium">Datos actuales en tu cuenta</Label>
            <Button variant="ghost" size="sm" onClick={() => refetchCounts()}>
              <RefreshCw className="h-4 w-4 mr-1" />
              Actualizar
            </Button>
          </div>
          
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <div className="flex items-center justify-between p-2 bg-muted rounded-md">
              <span className="text-sm">Work Items</span>
              <Badge variant="secondary">{counts?.work_items || 0}</Badge>
            </div>
            <div className="flex items-center justify-between p-2 bg-muted rounded-md">
              <span className="text-sm">CGP Items</span>
              <Badge variant="secondary">{counts?.cgp_items || 0}</Badge>
            </div>
            <div className="flex items-center justify-between p-2 bg-muted rounded-md">
              <span className="text-sm">CPACA</span>
              <Badge variant="secondary">{counts?.cpaca_processes || 0}</Badge>
            </div>
            <div className="flex items-center justify-between p-2 bg-muted rounded-md">
              <span className="text-sm">Peticiones</span>
              <Badge variant="secondary">{counts?.peticiones || 0}</Badge>
            </div>
          </div>
          
          <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-md">
            <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
              Total de registros a eliminar: {counts?.total || 0}
            </p>
          </div>
        </div>

        <Separator />

        {/* Warning and action */}
        <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-4 space-y-3">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-medium text-destructive">
                ADVERTENCIA: Esta acción es irreversible
              </p>
              <p className="text-sm text-muted-foreground">
                Este purge eliminará TODOS los datos de tu organización incluyendo:
                work_items, cgp_items, peticiones, cpaca_processes,
                y todos sus datos dependientes (documentos, actuaciones, alertas, tareas, términos, etc.)
              </p>
            </div>
          </div>
        </div>

        <AlertDialog open={dialogOpen} onOpenChange={handleClose}>
          <AlertDialogTrigger asChild>
            <Button 
              variant="destructive" 
              className="w-full"
              disabled={!counts?.total || counts.total === 0}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Purgar todos los datos de mi organización
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent className="max-w-md">
            <AlertDialogHeader>
              <div className="flex items-center gap-3 text-destructive">
                <div className="h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center">
                  <AlertTriangle className="h-6 w-6" />
                </div>
                <AlertDialogTitle className="text-xl">
                  Confirmar Purge de Organización
                </AlertDialogTitle>
              </div>
              <AlertDialogDescription asChild>
                <div className="space-y-4 pt-4">
                  <p className="text-base">
                    Esta acción eliminará permanentemente <strong>{counts?.total || 0}</strong> registros
                    y todos sus datos asociados.
                  </p>

                  <div className="bg-destructive/10 border border-destructive/20 rounded-md p-4 space-y-2">
                    <p className="font-medium text-destructive text-sm">
                      Se eliminarán:
                    </p>
                    <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
                      <li>Todos los work_items y procesos CGP</li>
                      <li>Todas las peticiones</li>
                      <li>Todos los procesos CPACA</li>
                      <li>Documentos, actuaciones, y línea de tiempo</li>
                      <li>Términos, plazos, alertas y tareas</li>
                      <li>Archivos almacenados en la nube</li>
                    </ul>
                  </div>

                  <div className="space-y-4 pt-2">
                    <div className="flex items-start space-x-3">
                      <Checkbox
                        id="purge-understand"
                        checked={understood}
                        onCheckedChange={(checked) => setUnderstood(checked === true)}
                        disabled={purgeMutation.isPending}
                      />
                      <Label
                        htmlFor="purge-understand"
                        className="text-sm font-normal cursor-pointer leading-relaxed"
                      >
                        Entiendo que esta acción es <strong>permanente e irreversible</strong>,
                        y eliminará todos los datos de mi organización.
                      </Label>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="purge-confirm-text" className="text-sm">
                        Escribe <code className="bg-muted px-1.5 py-0.5 rounded text-destructive font-mono">
                          {REQUIRED_TEXT}
                        </code> para confirmar:
                      </Label>
                      <Input
                        id="purge-confirm-text"
                        value={confirmText}
                        onChange={(e) => setConfirmText(e.target.value)}
                        placeholder={REQUIRED_TEXT}
                        className="font-mono"
                        disabled={purgeMutation.isPending}
                      />
                    </div>
                  </div>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={purgeMutation.isPending}>
                Cancelar
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={() => purgeMutation.mutate()}
                disabled={!isValid || purgeMutation.isPending}
                className="bg-destructive hover:bg-destructive/90"
              >
                {purgeMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Purgando...
                  </>
                ) : (
                  <>
                    <Trash2 className="h-4 w-4 mr-2" />
                    Purgar Organización
                  </>
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
