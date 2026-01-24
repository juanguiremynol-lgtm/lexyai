import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { 
  AlertTriangle, 
  Loader2, 
  Trash2, 
  Scale, 
  FileText, 
  Gavel, 
  Building2, 
  Users,
  Search,
  X
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type DeleteMode = "all" | "pipeline" | "client" | "specific";
type PipelineType = "cgp" | "cpaca" | "peticiones" | "tutelas" | "admin" | "work_items";

const PIPELINE_OPTIONS: { value: PipelineType; label: string; icon: React.ElementType }[] = [
  { value: "work_items", label: "Work Items", icon: FileText },
  { value: "cgp", label: "Procesos CGP", icon: Scale },
  { value: "cpaca", label: "Procesos CPACA", icon: Scale },
  { value: "peticiones", label: "Peticiones", icon: FileText },
  { value: "tutelas", label: "Tutelas", icon: Gavel },
  { value: "admin", label: "Administrativos", icon: Building2 },
];

export function MasterDeleteSection() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleteMode, setDeleteMode] = useState<DeleteMode>("all");
  const [selectedPipeline, setSelectedPipeline] = useState<PipelineType>("work_items");
  const [selectedClientId, setSelectedClientId] = useState<string>("");
  const [specificItemId, setSpecificItemId] = useState("");

  // Fetch clients for client-based deletion
  const { data: clients } = useQuery({
    queryKey: ["clients-for-deletion"],
    queryFn: async () => {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) return [];
      const { data } = await supabase
        .from("clients")
        .select("id, name")
        .eq("owner_id", user.user.id)
        .order("name");
      return data || [];
    },
  });

  // Fetch counts for each pipeline
  const { data: counts } = useQuery({
    queryKey: ["deletion-counts"],
    queryFn: async () => {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) return { work_items: 0, cgp: 0, cpaca: 0, peticiones: 0, tutelas: 0, admin: 0 };

      const [workItems, cgp, cpaca, peticiones, tutelas, admin] = await Promise.all([
        supabase.from("work_items").select("id", { count: "exact", head: true }).eq("owner_id", user.user.id),
        supabase.from("cgp_items").select("id", { count: "exact", head: true }).eq("owner_id", user.user.id),
        supabase.from("cpaca_processes").select("id", { count: "exact", head: true }).eq("owner_id", user.user.id),
        supabase.from("peticiones").select("id", { count: "exact", head: true }).eq("owner_id", user.user.id),
        supabase.from("filings").select("id", { count: "exact", head: true }).eq("owner_id", user.user.id).eq("filing_type", "TUTELA"),
        supabase.from("monitored_processes").select("id", { count: "exact", head: true }).eq("owner_id", user.user.id).eq("process_type", "ADMINISTRATIVE"),
      ]);

      return {
        work_items: workItems.count || 0,
        cgp: cgp.count || 0,
        cpaca: cpaca.count || 0,
        peticiones: peticiones.count || 0,
        tutelas: tutelas.count || 0,
        admin: admin.count || 0,
      };
    },
  });

  const totalCount = useMemo(() => {
    if (!counts) return 0;
    return counts.work_items + counts.cgp + counts.cpaca + counts.peticiones + counts.tutelas + counts.admin;
  }, [counts]);

  const getRequiredText = () => {
    switch (deleteMode) {
      case "all": return "ELIMINAR TODO";
      case "pipeline": return `ELIMINAR ${selectedPipeline.toUpperCase()}`;
      case "client": return "ELIMINAR CLIENTE";
      case "specific": return "ELIMINAR";
      default: return "ELIMINAR";
    }
  };

  const requiredText = getRequiredText();
  const isValid = understood && confirmText === requiredText;

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");

      let idsToDelete: string[] = [];

      if (deleteMode === "all") {
        // Fetch all IDs from all tables
        const [workItems, cgp, peticiones, processes, cpaca, filings] = await Promise.all([
          supabase.from("work_items").select("id").eq("owner_id", user.id),
          supabase.from("cgp_items").select("id").eq("owner_id", user.id),
          supabase.from("peticiones").select("id").eq("owner_id", user.id),
          supabase.from("monitored_processes").select("id").eq("owner_id", user.id),
          supabase.from("cpaca_processes").select("id").eq("owner_id", user.id),
          supabase.from("filings").select("id").eq("owner_id", user.id),
        ]);

        idsToDelete = [
          ...(workItems.data || []).map(w => w.id),
          ...(cgp.data || []).map(c => c.id),
          ...(peticiones.data || []).map(p => p.id),
          ...(processes.data || []).map(p => p.id),
          ...(cpaca.data || []).map(c => c.id),
          ...(filings.data || []).map(f => f.id),
        ];
      } else if (deleteMode === "pipeline") {
        switch (selectedPipeline) {
          case "work_items": {
            const { data } = await supabase.from("work_items").select("id").eq("owner_id", user.id);
            idsToDelete = (data || []).map(w => w.id);
            break;
          }
          case "cgp": {
            const { data } = await supabase.from("cgp_items").select("id").eq("owner_id", user.id);
            idsToDelete = (data || []).map(c => c.id);
            break;
          }
          case "cpaca": {
            const { data } = await supabase.from("cpaca_processes").select("id").eq("owner_id", user.id);
            idsToDelete = (data || []).map(c => c.id);
            break;
          }
          case "peticiones": {
            const { data } = await supabase.from("peticiones").select("id").eq("owner_id", user.id);
            idsToDelete = (data || []).map(p => p.id);
            break;
          }
          case "tutelas": {
            const { data } = await supabase.from("filings").select("id").eq("owner_id", user.id).eq("filing_type", "TUTELA");
            idsToDelete = (data || []).map(f => f.id);
            break;
          }
          case "admin": {
            const { data } = await supabase.from("monitored_processes").select("id").eq("owner_id", user.id).eq("process_type", "ADMINISTRATIVE");
            idsToDelete = (data || []).map(p => p.id);
            break;
          }
        }
      } else if (deleteMode === "client" && selectedClientId) {
        // Get all items linked to this client
        const [workItems, cgp, cpaca, peticiones, filings] = await Promise.all([
          supabase.from("work_items").select("id").eq("owner_id", user.id).eq("client_id", selectedClientId),
          supabase.from("cgp_items").select("id").eq("owner_id", user.id).eq("client_id", selectedClientId),
          supabase.from("cpaca_processes").select("id").eq("owner_id", user.id).eq("client_id", selectedClientId),
          supabase.from("peticiones").select("id").eq("owner_id", user.id).eq("client_id", selectedClientId),
          supabase.from("filings").select("id").eq("owner_id", user.id).eq("client_id", selectedClientId),
        ]);

        idsToDelete = [
          ...(workItems.data || []).map(w => w.id),
          ...(cgp.data || []).map(c => c.id),
          ...(cpaca.data || []).map(c => c.id),
          ...(peticiones.data || []).map(p => p.id),
          ...(filings.data || []).map(f => f.id),
        ];
      } else if (deleteMode === "specific" && specificItemId.trim()) {
        idsToDelete = [specificItemId.trim()];
      }

      if (idsToDelete.length === 0) {
        return { deleted_count: 0 };
      }

      // Call the delete edge function
      const { data, error } = await supabase.functions.invoke("delete-work-items", {
        body: { work_item_ids: idsToDelete, mode: "HARD_DELETE" },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries();
      setDialogOpen(false);
      setUnderstood(false);
      setConfirmText("");
      setSpecificItemId("");
      toast.success(`Se eliminaron ${result?.deleted_count || 0} elementos y todos sus datos asociados`);
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

  const getDeleteDescription = () => {
    switch (deleteMode) {
      case "all":
        return `Esta acción eliminará TODOS los ${totalCount} elementos de tu cuenta.`;
      case "pipeline":
        return `Eliminar todos los elementos de ${PIPELINE_OPTIONS.find(p => p.value === selectedPipeline)?.label} (${counts?.[selectedPipeline] || 0} elementos).`;
      case "client":
        return `Eliminar todos los asuntos vinculados al cliente seleccionado.`;
      case "specific":
        return `Eliminar un elemento específico por su ID.`;
      default:
        return "";
    }
  };

  return (
    <Card className="border-destructive/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-destructive">
          <AlertTriangle className="h-5 w-5" />
          Zona de Peligro
        </CardTitle>
        <CardDescription>
          Acciones irreversibles que afectan tus datos. Selecciona qué deseas eliminar.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Mode selector */}
        <div className="space-y-4">
          <Label className="text-base font-medium">Tipo de eliminación</Label>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Button
              variant={deleteMode === "all" ? "destructive" : "outline"}
              size="sm"
              onClick={() => setDeleteMode("all")}
              className="justify-start"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Todo
            </Button>
            <Button
              variant={deleteMode === "pipeline" ? "destructive" : "outline"}
              size="sm"
              onClick={() => setDeleteMode("pipeline")}
              className="justify-start"
            >
              <Scale className="h-4 w-4 mr-2" />
              Por pipeline
            </Button>
            <Button
              variant={deleteMode === "client" ? "destructive" : "outline"}
              size="sm"
              onClick={() => setDeleteMode("client")}
              className="justify-start"
            >
              <Users className="h-4 w-4 mr-2" />
              Por cliente
            </Button>
            <Button
              variant={deleteMode === "specific" ? "destructive" : "outline"}
              size="sm"
              onClick={() => setDeleteMode("specific")}
              className="justify-start"
            >
              <Search className="h-4 w-4 mr-2" />
              Específico
            </Button>
          </div>
        </div>

        <Separator />

        {/* Conditional options based on mode */}
        {deleteMode === "pipeline" && (
          <div className="space-y-3">
            <Label>Seleccionar pipeline</Label>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {PIPELINE_OPTIONS.map((option) => {
                const Icon = option.icon;
                const count = counts?.[option.value] || 0;
                return (
                  <Button
                    key={option.value}
                    variant={selectedPipeline === option.value ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSelectedPipeline(option.value)}
                    className="justify-between"
                  >
                    <span className="flex items-center gap-2">
                      <Icon className="h-4 w-4" />
                      {option.label}
                    </span>
                    <Badge variant="secondary" className="ml-2">
                      {count}
                    </Badge>
                  </Button>
                );
              })}
            </div>
          </div>
        )}

        {deleteMode === "client" && (
          <div className="space-y-3">
            <Label>Seleccionar cliente</Label>
            <Select value={selectedClientId} onValueChange={setSelectedClientId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecciona un cliente..." />
              </SelectTrigger>
              <SelectContent>
                {clients?.map((client) => (
                  <SelectItem key={client.id} value={client.id}>
                    {client.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {clients?.length === 0 && (
              <p className="text-sm text-muted-foreground">No hay clientes registrados.</p>
            )}
          </div>
        )}

        {deleteMode === "specific" && (
          <div className="space-y-3">
            <Label>ID del elemento</Label>
            <div className="flex gap-2">
              <Input
                placeholder="Pegar UUID del elemento..."
                value={specificItemId}
                onChange={(e) => setSpecificItemId(e.target.value)}
                className="font-mono text-sm"
              />
              {specificItemId && (
                <Button variant="ghost" size="icon" onClick={() => setSpecificItemId("")}>
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Puedes encontrar el ID en la URL cuando abres el detalle del elemento.
            </p>
          </div>
        )}

        {/* Summary of what will be deleted */}
        <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-4">
          <p className="text-sm text-muted-foreground">
            {getDeleteDescription()}
          </p>
        </div>

        {/* Delete button */}
        <AlertDialog open={dialogOpen} onOpenChange={handleClose}>
          <AlertDialogTrigger asChild>
            <Button 
              variant="destructive" 
              className="w-full sm:w-auto"
              disabled={
                (deleteMode === "client" && !selectedClientId) ||
                (deleteMode === "specific" && !specificItemId.trim())
              }
            >
              <Trash2 className="h-4 w-4 mr-2" />
              {deleteMode === "all" ? "Eliminar todos mis datos" : "Eliminar seleccionados"}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent className="max-w-md">
            <AlertDialogHeader>
              <div className="flex items-center gap-3 text-destructive">
                <div className="h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center">
                  <AlertTriangle className="h-6 w-6" />
                </div>
                <AlertDialogTitle className="text-xl">
                  Confirmar eliminación
                </AlertDialogTitle>
              </div>
              <AlertDialogDescription asChild>
                <div className="space-y-4 pt-4">
                  <p className="text-base">
                    {getDeleteDescription()}
                  </p>

                  <div className="bg-destructive/10 border border-destructive/20 rounded-md p-4 space-y-2">
                    <p className="font-medium text-destructive text-sm">
                      Esta acción eliminará permanentemente:
                    </p>
                    <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
                      <li>Todos los datos asociados (documentos, alertas, tareas)</li>
                      <li>Archivos almacenados en la nube</li>
                      <li>Historial de actuaciones y eventos</li>
                      <li>Términos, plazos y recordatorios</li>
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
                        Entiendo que esta acción es <strong>permanente e irreversible</strong>
                      </Label>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="master-confirm-text" className="text-sm">
                        Escribe{" "}
                        <code className="bg-muted px-1.5 py-0.5 rounded text-destructive font-mono font-bold">
                          {requiredText}
                        </code>{" "}
                        para confirmar:
                      </Label>
                      <Input
                        id="master-confirm-text"
                        value={confirmText}
                        onChange={(e) => setConfirmText(e.target.value.toUpperCase())}
                        placeholder={requiredText}
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
                    Eliminando...
                  </>
                ) : (
                  <>
                    <Trash2 className="h-4 w-4 mr-2" />
                    Confirmar eliminación
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
