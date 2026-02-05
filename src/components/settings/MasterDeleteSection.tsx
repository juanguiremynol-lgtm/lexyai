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

type DeleteMode = "all" | "pipeline" | "client" | "specific";
type PipelineType = "work_items" | "cgp" | "cpaca" | "peticiones" | "tutelas" | "admin";

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

  const { data: counts } = useQuery({
    queryKey: ["deletion-counts"],
    queryFn: async () => {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) return { work_items: 0, cgp: 0, cpaca: 0, peticiones: 0, tutelas: 0, admin: 0 };

      const [workItems, cgp, cpaca, peticiones, tutelas, admin] = await Promise.all([
        supabase.from("work_items").select("id", { count: "exact", head: true }).eq("owner_id", user.user.id),
        supabase.from("work_items").select("id", { count: "exact", head: true }).eq("owner_id", user.user.id).eq("workflow_type", "CGP"),
        supabase.from("cpaca_processes").select("id", { count: "exact", head: true }).eq("owner_id", user.user.id),
        supabase.from("peticiones").select("id", { count: "exact", head: true }).eq("owner_id", user.user.id),
        supabase.from("work_items").select("id", { count: "exact", head: true }).eq("owner_id", user.user.id).eq("workflow_type", "TUTELA"),
        supabase.from("work_items").select("id", { count: "exact", head: true }).eq("owner_id", user.user.id).eq("workflow_type", "GOV_PROCEDURE"),
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
    return counts.work_items;
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
        const { data: workItems } = await supabase.from("work_items").select("id").eq("owner_id", user.id);
        idsToDelete = (workItems || []).map(w => w.id);
      } else if (deleteMode === "pipeline") {
        let query = supabase.from("work_items").select("id").eq("owner_id", user.id);
        
        switch (selectedPipeline) {
          case "cgp": query = query.eq("workflow_type", "CGP"); break;
          case "tutelas": query = query.eq("workflow_type", "TUTELA"); break;
          case "admin": query = query.eq("workflow_type", "GOV_PROCEDURE"); break;
          case "cpaca": query = query.eq("workflow_type", "CPACA"); break;
          case "peticiones": query = query.eq("workflow_type", "PETICION"); break;
        }
        
        const { data } = await query;
        idsToDelete = (data || []).map(w => w.id);
      } else if (deleteMode === "client" && selectedClientId) {
        const { data } = await supabase.from("work_items").select("id").eq("owner_id", user.id).eq("client_id", selectedClientId);
        idsToDelete = (data || []).map(w => w.id);
      } else if (deleteMode === "specific" && specificItemId.trim()) {
        idsToDelete = [specificItemId.trim()];
      }

      if (idsToDelete.length === 0) return { deleted_count: 0 };

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
      toast.success(`Se eliminaron ${result?.deleted_count || 0} elementos`);
    },
    onError: (error: Error) => {
      toast.error(`Error al eliminar: ${error.message}`);
    },
  });

  const handleClose = (open: boolean) => {
    if (!open) { setUnderstood(false); setConfirmText(""); }
    setDialogOpen(open);
  };

  return (
    <Card className="border-destructive/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-destructive">
          <AlertTriangle className="h-5 w-5" />
          Zona de Peligro
        </CardTitle>
        <CardDescription>Acciones irreversibles que afectan tus datos.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4">
          <Label className="text-base font-medium">Tipo de eliminación</Label>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {[
              { mode: "all" as DeleteMode, icon: Trash2, label: "Todo" },
              { mode: "pipeline" as DeleteMode, icon: Scale, label: "Por pipeline" },
              { mode: "client" as DeleteMode, icon: Users, label: "Por cliente" },
              { mode: "specific" as DeleteMode, icon: Search, label: "Específico" },
            ].map(({ mode, icon: Icon, label }) => (
              <Button
                key={mode}
                variant={deleteMode === mode ? "destructive" : "outline"}
                size="sm"
                onClick={() => setDeleteMode(mode)}
                className="justify-start"
              >
                <Icon className="h-4 w-4 mr-2" />
                {label}
              </Button>
            ))}
          </div>
        </div>

        <Separator />

        {deleteMode === "pipeline" && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {PIPELINE_OPTIONS.map((option) => {
              const Icon = option.icon;
              return (
                <Button
                  key={option.value}
                  variant={selectedPipeline === option.value ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelectedPipeline(option.value)}
                  className="justify-between"
                >
                  <span className="flex items-center gap-2"><Icon className="h-4 w-4" />{option.label}</span>
                  <Badge variant="secondary">{counts?.[option.value] || 0}</Badge>
                </Button>
              );
            })}
          </div>
        )}

        {deleteMode === "client" && (
          <Select value={selectedClientId} onValueChange={setSelectedClientId}>
            <SelectTrigger><SelectValue placeholder="Selecciona un cliente..." /></SelectTrigger>
            <SelectContent>
              {clients?.map((client) => (
                <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {deleteMode === "specific" && (
          <div className="flex gap-2">
            <Input placeholder="UUID del elemento..." value={specificItemId} onChange={(e) => setSpecificItemId(e.target.value)} className="font-mono text-sm" />
            {specificItemId && <Button variant="ghost" size="icon" onClick={() => setSpecificItemId("")}><X className="h-4 w-4" /></Button>}
          </div>
        )}

        <AlertDialog open={dialogOpen} onOpenChange={handleClose}>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" disabled={(deleteMode === "client" && !selectedClientId) || (deleteMode === "specific" && !specificItemId.trim())}>
              <Trash2 className="h-4 w-4 mr-2" />
              Eliminar
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Confirmar eliminación</AlertDialogTitle>
              <AlertDialogDescription>
                <div className="space-y-4">
                  <div className="flex items-start space-x-3 pt-4">
                    <Checkbox id="understand" checked={understood} onCheckedChange={(c) => setUnderstood(c === true)} />
                    <Label htmlFor="understand">Entiendo que esta acción es irreversible</Label>
                  </div>
                  <div className="space-y-2">
                    <Label>Escriba "{requiredText}" para confirmar:</Label>
                    <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
                  </div>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={() => deleteMutation.mutate()} disabled={!isValid || deleteMutation.isPending} className="bg-destructive">
                {deleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Eliminar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
