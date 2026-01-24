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
import { AlertTriangle, Loader2, Trash2, Database, FileText, Bell, Calendar, Scale } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export function MasterDeleteSection() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  const requiredText = "ELIMINAR TODO";
  const isValid = understood && confirmText === requiredText;

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");

      // Get all work items for this user
      const { data: workItems, error: wiError } = await supabase
        .from("work_items")
        .select("id")
        .eq("owner_id", user.id);

      if (wiError) throw wiError;

      // Get all cgp_items
      const { data: cgpItems, error: cgpError } = await supabase
        .from("cgp_items")
        .select("id")
        .eq("owner_id", user.id);

      if (cgpError) throw cgpError;

      // Get all peticiones
      const { data: peticiones, error: petError } = await supabase
        .from("peticiones")
        .select("id")
        .eq("owner_id", user.id);

      if (petError) throw petError;

      // Get all monitored_processes
      const { data: processes, error: procError } = await supabase
        .from("monitored_processes")
        .select("id")
        .eq("owner_id", user.id);

      if (procError) throw procError;

      // Get all cpaca_processes
      const { data: cpaca, error: cpacaError } = await supabase
        .from("cpaca_processes")
        .select("id")
        .eq("owner_id", user.id);

      if (cpacaError) throw cpacaError;

      // Get all filings (tutelas)
      const { data: filings, error: filingsError } = await supabase
        .from("filings")
        .select("id")
        .eq("owner_id", user.id);

      if (filingsError) throw filingsError;

      // Collect all IDs
      const allIds = [
        ...(workItems || []).map(w => w.id),
        ...(cgpItems || []).map(c => c.id),
        ...(peticiones || []).map(p => p.id),
        ...(processes || []).map(p => p.id),
        ...(cpaca || []).map(c => c.id),
        ...(filings || []).map(f => f.id),
      ];

      if (allIds.length === 0) {
        return { deleted_count: 0 };
      }

      // Call the delete edge function with all IDs
      const { data, error } = await supabase.functions.invoke("delete-work-items", {
        body: { work_item_ids: allIds, mode: "HARD_DELETE" },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (result) => {
      // Invalidate all queries
      queryClient.invalidateQueries();
      
      setDialogOpen(false);
      setUnderstood(false);
      setConfirmText("");
      
      toast.success(
        `Se eliminaron ${result?.deleted_count || 0} elementos y todos sus datos asociados`
      );
    },
    onError: (error: Error) => {
      toast.error(`Error al eliminar: ${error.message}`);
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
    <Card className="border-destructive/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-destructive">
          <AlertTriangle className="h-5 w-5" />
          Zona de Peligro
        </CardTitle>
        <CardDescription>
          Acciones irreversibles que afectan todos tus datos
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Warning section */}
        <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-4 space-y-3">
          <h4 className="font-medium text-destructive">Eliminar todos los datos</h4>
          <p className="text-sm text-muted-foreground">
            Esta acción eliminará <strong>permanentemente</strong> todos tus asuntos, procesos, 
            documentos, alertas, tareas y archivos almacenados. Esta operación no se puede deshacer.
          </p>
          
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 pt-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Scale className="h-4 w-4" />
              <span>Procesos CGP</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <FileText className="h-4 w-4" />
              <span>Peticiones</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Database className="h-4 w-4" />
              <span>CPACA</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <FileText className="h-4 w-4" />
              <span>Tutelas</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Bell className="h-4 w-4" />
              <span>Alertas y tareas</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Calendar className="h-4 w-4" />
              <span>Términos y plazos</span>
            </div>
          </div>
        </div>

        {/* Delete button */}
        <AlertDialog open={dialogOpen} onOpenChange={handleClose}>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" className="w-full sm:w-auto">
              <Trash2 className="h-4 w-4 mr-2" />
              Eliminar todos mis datos
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent className="max-w-md">
            <AlertDialogHeader>
              <div className="flex items-center gap-3 text-destructive">
                <div className="h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center">
                  <AlertTriangle className="h-6 w-6" />
                </div>
                <AlertDialogTitle className="text-xl">
                  ¿Eliminar absolutamente todo?
                </AlertDialogTitle>
              </div>
              <AlertDialogDescription asChild>
                <div className="space-y-4 pt-4">
                  <p className="text-base">
                    Estás a punto de eliminar <strong>TODOS</strong> tus datos de la aplicación.
                  </p>

                  <div className="bg-destructive/10 border border-destructive/20 rounded-md p-4 space-y-2">
                    <p className="font-medium text-destructive text-sm">
                      Esta acción eliminará permanentemente:
                    </p>
                    <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
                      <li>Todos los procesos, radicaciones y tutelas</li>
                      <li>Todas las peticiones y trámites administrativos</li>
                      <li>Todos los documentos y archivos adjuntos</li>
                      <li>Todas las actuaciones y eventos del expediente</li>
                      <li>Todas las alertas, tareas y recordatorios</li>
                      <li>Todo el historial de monitoreo y evidencias</li>
                    </ul>
                  </div>

                  <div className="space-y-4 pt-2">
                    <div className="flex items-start space-x-3">
                      <Checkbox
                        id="master-understand"
                        checked={understood}
                        onCheckedChange={(checked) => setUnderstood(checked === true)}
                        disabled={deleteMutation.isPending}
                      />
                      <Label
                        htmlFor="master-understand"
                        className="text-sm font-normal cursor-pointer leading-relaxed"
                      >
                        Entiendo que esta acción es <strong>permanente, irreversible</strong> y 
                        eliminará absolutamente todos mis datos
                      </Label>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="master-confirm-text" className="text-sm">
                        Escribe{" "}
                        <code className="bg-muted px-1.5 py-0.5 rounded text-destructive font-mono font-bold">
                          ELIMINAR TODO
                        </code>{" "}
                        para confirmar:
                      </Label>
                      <Input
                        id="master-confirm-text"
                        value={confirmText}
                        onChange={(e) => setConfirmText(e.target.value.toUpperCase())}
                        placeholder="ELIMINAR TODO"
                        disabled={deleteMutation.isPending}
                        className={cn(
                          "font-mono text-center text-lg",
                          confirmText === requiredText && "border-destructive focus-visible:ring-destructive"
                        )}
                      />
                    </div>
                  </div>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="mt-4">
              <AlertDialogCancel disabled={deleteMutation.isPending}>
                Cancelar
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={() => deleteMutation.mutate()}
                disabled={!isValid || deleteMutation.isPending}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {deleteMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Eliminando todo...
                  </>
                ) : (
                  <>
                    <Trash2 className="h-4 w-4 mr-2" />
                    Eliminar todo permanentemente
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
