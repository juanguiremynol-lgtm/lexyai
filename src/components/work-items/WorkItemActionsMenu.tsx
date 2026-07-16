/**
 * WorkItemActionsMenu — shared lifecycle-aware action dropdown for
 * dashboard/pipeline cards, list rows and detail headers.
 *
 * Delegates all business logic to `useWorkItemActions`. Renders confirmation
 * dialogs inline and handles the orphan-client prompt after a successful
 * soft-delete.
 */

import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import {
  MoreVertical,
  Pause,
  Play,
  Lock,
  Trash2,
  RotateCcw,
  AlertOctagon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useWorkItemActions,
  checkClientOrphaned,
  deleteClientById,
  type WorkItemActionInput,
  type WorkItemActionKey,
} from "@/hooks/use-work-item-actions";
import { DeleteWorkItemDialog } from "@/components/shared/DeleteWorkItemDialog";
import { OrphanClientDialog } from "@/components/shared/OrphanClientDialog";
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
import { toast } from "sonner";

interface Props {
  workItem: WorkItemActionInput;
  clientName?: string | null;
  variant?: "dropdown" | "inline";
  onAfter?: () => void;
  /** Suppress client-orphan prompt (e.g. bulk flows). */
  skipClientPrompt?: boolean;
}

type Confirm = null | "pausar" | "cerrar" | "reactivar" | "eliminar_definitivo";

export function WorkItemActionsMenu({
  workItem,
  clientName,
  variant = "dropdown",
  onAfter,
  skipClientPrompt,
}: Props) {
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [orphanOpen, setOrphanOpen] = useState(false);

  const { state, available, isPending, actions } = useWorkItemActions(workItem, {
    onSoftDeleted: async (wi) => {
      onAfter?.();
      if (skipClientPrompt || !wi.client_id) return;
      try {
        const orphaned = await checkClientOrphaned(wi.client_id, wi.id);
        if (orphaned) setOrphanOpen(true);
      } catch {
        /* silent */
      }
    },
    onSuccess: () => onAfter?.(),
  });

  const runConfirm = async () => {
    switch (confirm) {
      case "pausar":
        await actions.pausar();
        break;
      case "reactivar":
        await actions.reactivar();
        break;
      case "cerrar":
        await actions.cerrar();
        break;
      case "eliminar_definitivo":
        await actions.eliminarDefinitivo();
        break;
    }
    setConfirm(null);
  };

  const items: Array<{ key: WorkItemActionKey; label: string; icon: any; destructive?: boolean; onClick: () => void }> = [];
  if (available.includes("pausar")) items.push({ key: "pausar", label: "Pausar monitoreo", icon: Pause, onClick: () => setConfirm("pausar") });
  if (available.includes("reactivar")) items.push({ key: "reactivar", label: state === "CLOSED" ? "Reabrir radicado" : "Reactivar monitoreo", icon: state === "CLOSED" ? RotateCcw : Play, onClick: () => setConfirm("reactivar") });
  if (available.includes("cerrar")) items.push({ key: "cerrar", label: "Cerrar radicado", icon: Lock, onClick: () => setConfirm("cerrar") });
  if (available.includes("eliminar")) items.push({ key: "eliminar", label: "Eliminar", icon: Trash2, destructive: true, onClick: () => setDeleteOpen(true) });
  if (available.includes("restaurar")) items.push({ key: "restaurar", label: "Restaurar", icon: RotateCcw, onClick: () => actions.restaurar() });
  if (available.includes("eliminar_definitivo")) items.push({ key: "eliminar_definitivo", label: "Eliminar definitivamente", icon: AlertOctagon, destructive: true, onClick: () => setConfirm("eliminar_definitivo") });

  const confirmCopy: Record<Exclude<Confirm, null>, { title: string; description: string; label: string; destructive?: boolean }> = {
    pausar: {
      title: "Pausar monitoreo",
      description: "Se detendrá la sincronización automática. Podrás reactivarla en cualquier momento.",
      label: "Pausar",
    },
    reactivar: {
      title: state === "CLOSED" ? "Reabrir radicado" : "Reactivar monitoreo",
      description: state === "CLOSED"
        ? "El radicado volverá a estado activo y se retomará la sincronización."
        : "Se retomará la sincronización automática de este asunto.",
      label: state === "CLOSED" ? "Reabrir" : "Reactivar",
    },
    cerrar: {
      title: "Cerrar radicado",
      description: "Se marcará como cerrado (proceso terminado) y se detendrá la sincronización. Puede reabrirse después.",
      label: "Cerrar radicado",
    },
    eliminar_definitivo: {
      title: "Eliminar definitivamente",
      description: "Esta acción es IRREVERSIBLE. El asunto y todos sus datos serán borrados de la base de datos.",
      label: "Eliminar definitivamente",
      destructive: true,
    },
  };

  const currentConfirm = confirm ? confirmCopy[confirm] : null;

  const menu = variant === "dropdown" ? (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 hover:bg-muted"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          disabled={isPending}
        >
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {items.map((it, i) => (
          <div key={it.key}>
            {it.destructive && i > 0 && <DropdownMenuSeparator />}
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                it.onClick();
              }}
              className={cn(it.destructive && "text-destructive focus:text-destructive focus:bg-destructive/10")}
            >
              <it.icon className="h-4 w-4 mr-2" />
              {it.label}
            </DropdownMenuItem>
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  ) : (
    <div className="flex flex-wrap gap-2">
      {items.map((it) => (
        <Button
          key={it.key}
          variant={it.destructive ? "destructive" : "secondary"}
          size="sm"
          onClick={it.onClick}
          disabled={isPending}
          className="gap-1.5"
        >
          <it.icon className="h-3.5 w-3.5" />
          {it.label}
        </Button>
      ))}
    </div>
  );

  return (
    <>
      {menu}

      <DeleteWorkItemDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onConfirm={async () => {
          try {
            await actions.eliminar();
          } finally {
            setDeleteOpen(false);
          }
        }}
        isDeleting={isPending}
        itemInfo={{
          title: workItem.title ?? null,
          radicado: workItem.radicado ?? null,
          workflowType: workItem.workflow_type ?? undefined,
        }}
      />

      {currentConfirm && (
        <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{currentConfirm.title}</AlertDialogTitle>
              <AlertDialogDescription>{currentConfirm.description}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isPending}>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={runConfirm}
                disabled={isPending}
                className={cn(currentConfirm.destructive && "bg-destructive text-destructive-foreground hover:bg-destructive/90")}
              >
                {isPending ? "Procesando..." : currentConfirm.label}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {workItem.client_id && (
        <OrphanClientDialog
          open={orphanOpen}
          onOpenChange={setOrphanOpen}
          clientName={clientName ?? "este cliente"}
          onConfirm={async () => {
            const r = await deleteClientById(workItem.client_id!);
            if (r.ok) toast.success("Cliente eliminado");
            else toast.error(r.error || "No se pudo eliminar el cliente");
            setOrphanOpen(false);
          }}
        />
      )}
    </>
  );
}