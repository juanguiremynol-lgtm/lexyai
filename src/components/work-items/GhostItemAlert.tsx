/**
 * GhostItemAlert — Role-based alert component shown on work item detail
 * when a ghost verification has been completed.
 *
 * Adapts messaging and available actions based on user tier:
 * - Basic tier: simple explanation + edit radicado
 * - Business org admin: full diagnostics + admin actions
 * - Business org member: limited view + "contact admin"
 *
 * NOTE: Manual per-item sync buttons have been removed.
 * All sync calls must originate from:
 *   1. SuperAdmin Toolbar (admin's own items)
 *   2. Sincronización Maestra (Debug) — Platform Console
 *   3. Sincronización Global (Override Manual) — Platform Console
 */

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle,
  Bot,
  Pencil,
  ShieldAlert,
  MessageSquare,
  Info,
} from "lucide-react";
import { toast } from "sonner";

interface GhostItemAlertProps {
  workItem: {
    id: string;
    organization_id?: string;
    radicado?: string | null;
    workflow_type?: string;
    ghost_verification_status?: string | null;
    ghost_verification_run_id?: string | null;
    monitoring_mode?: string | null;
    consecutive_404_count?: number;
  };
  userRole: "basic" | "org_admin" | "org_member";
  onRetry?: () => void;
  onEditRadicado?: () => void;
  onUpdate?: () => void;
}

export function GhostItemAlert({
  workItem,
  userRole,
  onEditRadicado,
}: GhostItemAlertProps) {
  const status = workItem.ghost_verification_status;

  if (!status || status === "RESOLVED") return null;

  // ── SYSTEM_ISSUE: Not the user's fault ──
  if (status === "SYSTEM_ISSUE") {
    return (
      <Card className="border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-950/20">
        <CardContent className="py-3 px-4 space-y-2">
          <div className="flex items-start gap-2">
            <ShieldAlert className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
            <div className="space-y-1 flex-1">
              <p className="text-sm font-medium text-red-700 dark:text-red-400">
                Problema detectado en el sistema de sincronización
              </p>
              <p className="text-xs text-muted-foreground">
                Estamos investigando un problema interno que afecta la sincronización de este tipo de proceso ({workItem.workflow_type}).
                No se requiere acción de su parte — el equipo técnico ya fue notificado.
              </p>
              {userRole === "org_admin" && (
                <div className="mt-2 p-2 rounded bg-muted/50 text-xs space-y-1">
                  <p className="font-medium">Diagnóstico técnico (solo admin):</p>
                  <p>Un radicado de control para la categoría {workItem.workflow_type} también falló, lo que indica un problema en la ruta de sincronización, no en este radicado específico.</p>
                  <p>Fallos consecutivos: {workItem.consecutive_404_count || "N/A"}</p>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── ITEM_SPECIFIC: Likely a radicado/court issue ──
  if (status === "ITEM_SPECIFIC") {
    return (
      <Card className="border-yellow-200 bg-yellow-50 dark:border-yellow-900/50 dark:bg-yellow-950/20">
        <CardContent className="py-3 px-4 space-y-2">
          <div className="flex items-start gap-2">
            <Bot className="h-4 w-4 text-yellow-600 mt-0.5 shrink-0" />
            <div className="space-y-1 flex-1">
              <p className="text-sm font-medium text-yellow-700 dark:text-yellow-400">
                Este proceso no se ha podido sincronizar
              </p>
              <p className="text-xs text-muted-foreground">
                {userRole === "basic" || userRole === "org_admin" ? (
                  <>
                    Nuestro sistema funciona correctamente para otros procesos {workItem.workflow_type},
                    por lo que este caso parece ser específico de este radicado.
                    El juzgado podría no estar publicando actuaciones digitales, o el
                    número de radicado podría necesitar corrección.
                  </>
                ) : (
                  <>
                    Este asunto requiere atención. Contacte al administrador de su organización
                    para revisar el radicado y tomar acciones correctivas.
                  </>
                )}
              </p>

              {/* Possible reasons */}
              <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
                <p>Posibles causas:</p>
                <ul className="list-disc list-inside ml-1">
                  <li>El radicado fue digitado incorrectamente</li>
                  <li>El juzgado no publica actuaciones en formato digital</li>
                  <li>El proceso fue archivado o migrado</li>
                  <li>La categoría del proceso no corresponde</li>
                </ul>
              </div>

              <p className="text-xs text-muted-foreground mt-2 italic">
                La sincronización se ejecutará automáticamente en el próximo ciclo programado.
              </p>

              {userRole === "org_admin" && (
                <div className="mt-2 p-2 rounded bg-muted/50 text-xs space-y-1">
                  <p className="font-medium">Evidencia de verificación (solo admin):</p>
                  <p>Se ejecutó un control-run con un radicado conocido de la misma categoría y fue exitoso.</p>
                  <p>Fallos consecutivos: {workItem.consecutive_404_count || "N/A"}</p>
                </div>
              )}
            </div>
          </div>

          {/* Actions based on role — sync buttons removed, only radicado edit */}
          <div className="flex gap-2 ml-6 flex-wrap">
            {(userRole === "basic" || userRole === "org_admin") && (
              <Button
                size="sm"
                variant="outline"
                onClick={onEditRadicado}
                className="gap-1"
              >
                <Pencil className="h-3 w-3" />
                Verificar Radicado
              </Button>
            )}

            {userRole === "org_member" && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => toast.info("Contacte al administrador de su organización para gestionar este asunto.")}
                className="gap-1"
              >
                <MessageSquare className="h-3 w-3" />
                Solicitar Revisión al Admin
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── INCONCLUSIVE ──
  if (status === "INCONCLUSIVE") {
    return (
      <Card className="border-muted">
        <CardContent className="py-3 px-4">
          <div className="flex items-start gap-2">
            <Info className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">
                No se pudo determinar la causa del fallo de sincronización (no hay radicados de control configurados para {workItem.workflow_type}).
              </p>
              <p className="text-xs text-muted-foreground italic">
                La sincronización se reintentará automáticamente en el próximo ciclo programado.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return null;
}