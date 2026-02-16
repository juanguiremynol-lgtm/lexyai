/**
 * Admin Support Tools Tab - Data export and demo reset utilities
 * Uses organization_id for multi-tenant scoping (not owner_id)
 */

import { useState } from "react";
import { sanitizeCellValue } from "@/lib/spreadsheet-sanitize";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { 
  Download, 
  Trash2, 
  FileJson, 
  FileSpreadsheet,
  Loader2,
  AlertTriangle,
  Users,
  Scale,
  CalendarDays,
  CheckSquare,
  Bell,
  AlertCircle,
  ClipboardCheck,
  ExternalLink
} from "lucide-react";
import { toast } from "sonner";
import { useOrganization } from "@/contexts/OrganizationContext";
import { logAudit } from "@/lib/audit-log";

interface ExportStats {
  clients: number;
  work_items: number;
  tasks: number;
  hearings: number;
  alerts: number;
}

export function AdminSupportToolsTab() {
  const queryClient = useQueryClient();
  const { organization } = useOrganization();

  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState("");
  const [exportFormat, setExportFormat] = useState<"json" | "csv">("json");

  // Fetch entity counts for export preview - using organization_id for multi-tenant scoping
  const { data: stats, isLoading: loadingStats } = useQuery({
    queryKey: ["admin-export-stats", organization?.id],
    queryFn: async () => {
      if (!organization?.id) return null;

      const [clients, workItems, tasks, hearings, alerts] = await Promise.all([
        supabase.from("clients").select("id", { count: "exact", head: true }).eq("organization_id", organization.id).is("deleted_at", null),
        supabase.from("work_items").select("id", { count: "exact", head: true }).eq("organization_id", organization.id).is("deleted_at", null),
        supabase.from("tasks").select("id", { count: "exact", head: true }).eq("organization_id", organization.id).is("deleted_at", null),
        supabase.from("hearings").select("id", { count: "exact", head: true }).eq("organization_id", organization.id),
        supabase.from("alert_instances").select("id", { count: "exact", head: true }).eq("organization_id", organization.id),
      ]);

      return {
        clients: clients.count || 0,
        work_items: workItems.count || 0,
        tasks: tasks.count || 0,
        hearings: hearings.count || 0,
        alerts: alerts.count || 0,
      } as ExportStats;
    },
    enabled: !!organization?.id,
  });

  // Export data mutation - using organization_id for multi-tenant scoping
  const exportData = useMutation({
    mutationFn: async (entities: string[]) => {
      if (!organization?.id) throw new Error("Organización no cargada");

      const exportData: Record<string, unknown[]> = {};

      for (const entity of entities) {
        const { data } = await supabase
          .from(entity as any)
          .select("*")
          .eq("organization_id", organization.id)
          .is("deleted_at", null)
          .limit(10000);

        exportData[entity] = data || [];
      }

      // Create download
      const filename = `atenia_export_${organization.name?.replace(/\s+/g, '_') || 'org'}_${new Date().toISOString().split("T")[0]}`;
      
      if (exportFormat === "json") {
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${filename}.json`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        // CSV export - one file per entity
        for (const [entity, rows] of Object.entries(exportData)) {
          if (rows.length === 0) continue;
          
          const headers = Object.keys(rows[0] as object);
          const csvContent = [
            headers.join(","),
            ...rows.map(row => 
              headers.map(h => {
                const raw = (row as any)[h];
                const val = sanitizeCellValue(raw);
                if (val === null || val === undefined) return "";
                const str = String(val);
                if (str.includes(",") || str.includes('"') || str.includes("\n")) {
                  return `"${str.replace(/"/g, '""')}"`;
                }
                return str;
              }).join(",")
            )
          ].join("\n");

          const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `${filename}_${entity}.csv`;
          a.click();
          URL.revokeObjectURL(url);
        }
      }

      // Log audit
      await logAudit({
        organizationId: organization.id,
        action: "DATA_EXPORTED",
        entityType: "organization",
        entityId: organization.id,
        metadata: { entities, format: exportFormat },
      });

      return entities.length;
    },
    onSuccess: (count) => {
      toast.success(`Datos exportados (${count} categorías)`);
    },
    onError: (error: Error) => {
      toast.error("Error al exportar: " + error.message);
    },
  });

  // Reset demo data mutation - using organization_id for multi-tenant scoping
  const resetDemoData = useMutation({
    mutationFn: async () => {
      if (!organization?.id) throw new Error("Organización no cargada");

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");

      // Soft-delete all work_items in the organization
      const { error: workItemsError } = await supabase
        .from("work_items")
        .update({ 
          deleted_at: new Date().toISOString(),
          deleted_by: user.id,
          delete_reason: "Demo data reset"
        })
        .eq("organization_id", organization.id)
        .is("deleted_at", null);

      if (workItemsError) throw workItemsError;

      // Soft-delete all clients in the organization
      const { error: clientsError } = await supabase
        .from("clients")
        .update({ 
          deleted_at: new Date().toISOString(),
          deleted_by: user.id
        })
        .eq("organization_id", organization.id)
        .is("deleted_at", null);

      if (clientsError) throw clientsError;

      // Log audit
      await logAudit({
        organizationId: organization.id,
        action: "DEMO_DATA_RESET",
        entityType: "organization",
        entityId: organization.id,
        metadata: { resetBy: user.id },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
      toast.success("Datos de demostración archivados. Puedes restaurarlos desde la Papelera.");
      setResetDialogOpen(false);
      setConfirmReset("");
    },
    onError: (error: Error) => {
      toast.error("Error: " + error.message);
    },
  });

  const exportEntities = ["clients", "work_items", "tasks", "hearings"];

  // Defensive check: if organization context is not ready
  if (!organization?.id) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-amber-500" />
            Contexto de Organización
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
            <p className="text-muted-foreground">
              Cargando contexto de organización...
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              Las herramientas de soporte están deshabilitadas hasta que se cargue el contexto.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Export Data */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Download className="h-5 w-5 text-primary" />
            Exportar Datos de la Organización
          </CardTitle>
          <CardDescription>
            Descarga todos los datos de <strong>{organization.name}</strong> en formato JSON o CSV
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Stats Preview */}
          {loadingStats ? (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className="p-3 rounded-lg bg-muted/50 text-center">
                <Users className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
                <p className="text-2xl font-bold">{stats?.clients || 0}</p>
                <p className="text-xs text-muted-foreground">Clientes</p>
              </div>
              <div className="p-3 rounded-lg bg-muted/50 text-center">
                <Scale className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
                <p className="text-2xl font-bold">{stats?.work_items || 0}</p>
                <p className="text-xs text-muted-foreground">Procesos</p>
              </div>
              <div className="p-3 rounded-lg bg-muted/50 text-center">
                <CheckSquare className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
                <p className="text-2xl font-bold">{stats?.tasks || 0}</p>
                <p className="text-xs text-muted-foreground">Tareas</p>
              </div>
              <div className="p-3 rounded-lg bg-muted/50 text-center">
                <CalendarDays className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
                <p className="text-2xl font-bold">{stats?.hearings || 0}</p>
                <p className="text-xs text-muted-foreground">Audiencias</p>
              </div>
              <div className="p-3 rounded-lg bg-muted/50 text-center">
                <Bell className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
                <p className="text-2xl font-bold">{stats?.alerts || 0}</p>
                <p className="text-xs text-muted-foreground">Alertas</p>
              </div>
            </div>
          )}

          <Separator />

          {/* Export Options */}
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <Button
                variant={exportFormat === "json" ? "default" : "outline"}
                size="sm"
                onClick={() => setExportFormat("json")}
              >
                <FileJson className="h-4 w-4 mr-2" />
                JSON
              </Button>
              <Button
                variant={exportFormat === "csv" ? "default" : "outline"}
                size="sm"
                onClick={() => setExportFormat("csv")}
              >
                <FileSpreadsheet className="h-4 w-4 mr-2" />
                CSV
              </Button>
            </div>
            <div className="flex-1" />
            <Button
              onClick={() => exportData.mutate(exportEntities)}
              disabled={exportData.isPending || loadingStats}
            >
              {exportData.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-2" />
              )}
              Exportar Todo
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            La exportación incluye: clientes, procesos (work_items), tareas y audiencias de toda la organización.
            Los datos sensibles como tokens de invitación no se incluyen.
          </p>
        </CardContent>
      </Card>

      {/* Reset Demo Data */}
      <Card className="border-amber-200 dark:border-amber-800">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
            <Trash2 className="h-5 w-5" />
            Reiniciar Datos de Demostración
          </CardTitle>
          <CardDescription>
            Archiva todos los procesos y clientes de <strong>{organization.name}</strong> creados durante el período de prueba.
            Podrás restaurarlos desde la Papelera de Reciclaje.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="p-4 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-lg mb-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium text-amber-800 dark:text-amber-200">
                  Esta acción archivará todos los datos de la organización
                </p>
                <p className="text-amber-700 dark:text-amber-300">
                  Útil para comenzar de nuevo con una cuenta limpia. Los datos no se eliminan permanentemente.
                </p>
              </div>
            </div>
          </div>

          <Button
            variant="outline"
            onClick={() => setResetDialogOpen(true)}
            className="border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-950"
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Reiniciar Datos
          </Button>
        </CardContent>
      </Card>

      {/* Production Verification Checklist */}
      <Card className="border-primary/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-primary">
            <ClipboardCheck className="h-5 w-5" />
            Lista de Verificación de Producción
          </CardTitle>
          <CardDescription>
            Pasos de verificación manual para confirmar el correcto funcionamiento del sistema.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="p-4 bg-muted/50 rounded-lg space-y-3">
            <p className="text-sm font-medium">Verificaciones recomendadas:</p>
            <ul className="text-sm text-muted-foreground space-y-2">
              <li className="flex items-start gap-2">
                <span className="text-primary mt-1">1.</span>
                <span><strong>Purga de Auditoría:</strong> Vista previa → logs DATA_PURGE_PREVIEWED y job_runs creados</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary mt-1">2.</span>
                <span><strong>Ejecución de Purga:</strong> Confirmar → logs DATA_PURGED y system_health_events OK</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary mt-1">3.</span>
                <span><strong>Bloqueo de Reintento:</strong> Correos con failed_permanent=true requieren confirmación de anulación</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary mt-1">4.</span>
                <span><strong>Alertas Admin:</strong> DB_MEMBERSHIP_DELETED y DB_SUBSCRIPTION_UPDATED aparecen en campana</span>
              </li>
            </ul>
          </div>
          
          <Separator />
          
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-sm">Documentación Completa</p>
              <p className="text-xs text-muted-foreground">
                Ver checklist detallado con queries SQL y pasos específicos.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                // Open docs in new tab (would be internal link in real deployment)
                window.open('https://github.com/your-org/atenia/blob/main/docs/production-verification.md', '_blank');
                toast.info("Documento de verificación: docs/production-verification.md");
              }}
            >
              <ExternalLink className="h-4 w-4 mr-2" />
              Ver Documentación
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Reset Confirmation Dialog */}
      <AlertDialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Reiniciar Datos de Demostración
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-4">
              <p>
                Esto archivará <strong>todos los procesos y clientes</strong> de la organización <strong>{organization.name}</strong>.
                Los datos quedarán en la Papelera de Reciclaje por si deseas restaurarlos.
              </p>

              <div className="space-y-2">
                <p className="text-sm">
                  Escribe <code className="bg-muted px-1.5 py-0.5 rounded font-mono">REINICIAR</code> para confirmar:
                </p>
                <Input
                  value={confirmReset}
                  onChange={(e) => setConfirmReset(e.target.value.toUpperCase())}
                  placeholder="REINICIAR"
                />
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmReset("")}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => resetDemoData.mutate()}
              disabled={confirmReset !== "REINICIAR" || resetDemoData.isPending}
              className="bg-amber-600 hover:bg-amber-700"
            >
              {resetDemoData.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4 mr-2" />
              )}
              Reiniciar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
