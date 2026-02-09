import { useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { EntityEmailTab } from "@/components/email";
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
  ArrowLeft,
  Save,
  Trash2,
  
  Loader2,
  Scale,
} from "lucide-react";
import { parseColombianDate, computeActuacionHash, normalizeActuacionText } from "@/lib/rama-judicial-api";
import { toast } from "sonner";
import {
  COLOMBIAN_DEPARTMENTS,
  formatDateColombia,
} from "@/lib/constants";

// CGP Phase types
type CGPPhase = "FILING" | "PROCESS";

interface CGPItemData {
  id: string;
  owner_id: string;
  client_id: string | null;
  matter_id: string | null;
  radicado: string | null;
  court_name: string | null;
  court_email: string | null;
  court_city: string | null;
  court_department: string | null;
  demandantes: string | null;
  demandados: string | null;
  description: string | null;
  notes: string | null;
  phase: CGPPhase;
  status: string;
  monitoring_enabled: boolean;
  email_linking_enabled: boolean;
  expediente_url: string | null;
  total_actuaciones: number;
  last_crawled_at: string | null;
  created_at: string;
  updated_at: string;
  client: { id: string; name: string } | null;
  _isWorkItem?: boolean;
}

export default function CGPDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Fetch CGP item - supports cgp_items and work_items tables
  const { data: cgpItem, isLoading } = useQuery({
    queryKey: ["cgp-item", id],
    queryFn: async (): Promise<CGPItemData | null> => {
      // 1. First try cgp_items table
      const { data: cgpData } = await supabase
        .from("cgp_items")
        .select(`
          *,
          client:clients(id, name)
        `)
        .eq("id", id!)
        .maybeSingle();
      
      if (cgpData) {
        return {
          ...cgpData,
          client: cgpData.client as any,
        } as CGPItemData;
      }
      
      // 2. If not in cgp_items, try work_items table (unified model)
      const { data: workItemData } = await supabase
        .from("work_items")
        .select(`
          *,
          client:clients(id, name)
        `)
        .eq("id", id!)
        .maybeSingle();
      
      if (workItemData) {
        const cgpPhaseValue = String(workItemData.cgp_phase || '');
        const isProcessPhase = cgpPhaseValue === 'PROCESO' || cgpPhaseValue === 'PROCESS';
        
        return {
          id: workItemData.id,
          owner_id: workItemData.owner_id,
          client_id: workItemData.client_id,
          matter_id: workItemData.matter_id,
          radicado: workItemData.radicado,
          court_name: workItemData.authority_name,
          court_email: workItemData.authority_email,
          court_city: workItemData.authority_city,
          court_department: workItemData.authority_department,
          demandantes: workItemData.demandantes,
          demandados: workItemData.demandados,
          description: workItemData.description,
          notes: workItemData.notes,
          phase: isProcessPhase ? 'PROCESS' : 'FILING',
          status: workItemData.status,
          monitoring_enabled: workItemData.monitoring_enabled,
          email_linking_enabled: workItemData.email_linking_enabled,
          expediente_url: workItemData.expediente_url,
          total_actuaciones: workItemData.total_actuaciones,
          last_crawled_at: workItemData.last_crawled_at,
          created_at: workItemData.created_at,
          updated_at: workItemData.updated_at,
          client: workItemData.client as any,
          _isWorkItem: true,
        };
      }
      
      return null;
    },
    enabled: !!id,
  });

  // Update CGP item mutation
  const updateCGPItem = useMutation({
    mutationFn: async (updates: Record<string, unknown>) => {
      const isWorkItem = cgpItem?._isWorkItem;
      
      if (isWorkItem) {
        const workItemUpdates: Record<string, unknown> = {};
        const fieldMap: Record<string, string> = {
          court_name: 'authority_name',
          court_email: 'authority_email',
          court_city: 'authority_city',
          court_department: 'authority_department',
          phase: 'cgp_phase',
        };
        
        for (const [key, value] of Object.entries(updates)) {
          const mappedKey = fieldMap[key] || key;
          if (key === 'phase') {
            workItemUpdates[mappedKey] = value === 'PROCESS' ? 'PROCESS' : 'FILING';
          } else {
            workItemUpdates[mappedKey] = value;
          }
        }
        workItemUpdates.updated_at = new Date().toISOString();
        
        const { error } = await (supabase.from("work_items") as any)
          .update(workItemUpdates)
          .eq("id", id!);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("cgp_items")
          .update(updates as any)
          .eq("id", id!);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cgp-item", id] });
      queryClient.invalidateQueries({ queryKey: ["work-items"] });
      toast.success("Caso CGP actualizado");
    },
    onError: (error) => {
      toast.error("Error: " + error.message);
    },
  });

  // CLEANUP: Removed orphan "Actualizar API" sync button per ATENIA sync policy.
  // Sync is automatic: daily cron 7AM COT + login sync (3/day max).

  // Delete mutation
  const deleteCGPItem = useMutation({
    mutationFn: async () => {
      const isWorkItem = cgpItem?._isWorkItem;
      const tableName = isWorkItem ? "work_items" : "cgp_items";
      const { error } = await (supabase.from(tableName) as any).delete().eq("id", id!);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Caso CGP eliminado");
      navigate("/app/cgp");
    },
    onError: (error) => {
      toast.error("Error: " + error.message);
    },
  });

  const handleFormSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    
    const updates: Record<string, unknown> = {
      radicado: formData.get("radicado"),
      court_name: formData.get("court_name"),
      court_email: formData.get("court_email"),
      court_city: formData.get("court_city"),
      court_department: formData.get("court_department"),
      demandantes: formData.get("demandantes"),
      demandados: formData.get("demandados"),
      description: formData.get("description"),
      notes: formData.get("notes"),
      expediente_url: formData.get("expediente_url"),
    };

    updateCGPItem.mutate(updates);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!cgpItem) {
    return (
      <div className="container py-8 text-center">
        <h1 className="text-2xl font-bold mb-4">Caso no encontrado</h1>
        <p className="text-muted-foreground mb-4">
          El caso CGP que buscas no existe o no tienes acceso.
        </p>
        <Button asChild>
          <Link to="/app/cgp">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Volver a CGP
          </Link>
        </Button>
      </div>
    );
  }

  const isProcessPhase = cgpItem.phase === "PROCESS";

  return (
    <div className="container py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link to="/app/cgp">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-display font-bold flex items-center gap-2">
              <Scale className="h-6 w-6 text-blue-600" />
              Caso CGP
              {cgpItem.radicado && (
                <Badge variant="outline" className="ml-2 font-mono">
                  {cgpItem.radicado}
                </Badge>
              )}
            </h1>
            <p className="text-muted-foreground text-sm">
              {cgpItem.client?.name || "Sin cliente"} • {cgpItem.court_name || "Sin juzgado"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant={isProcessPhase ? "default" : "secondary"}>
            {isProcessPhase ? "En Proceso" : "Radicación"}
          </Badge>
          
          {cgpItem.last_crawled_at && (
            <span className="text-xs text-muted-foreground">
              Última sync: {new Date(cgpItem.last_crawled_at).toLocaleDateString('es-CO')}
            </span>
          )}
          
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm">
                <Trash2 className="h-4 w-4 mr-2" />
                Eliminar
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>¿Eliminar este caso?</AlertDialogTitle>
                <AlertDialogDescription>
                  Esta acción no se puede deshacer. Se eliminarán todos los datos asociados.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => deleteCGPItem.mutate()}
                  className="bg-destructive text-destructive-foreground"
                >
                  Eliminar
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* Main content */}
      <Tabs defaultValue="details" className="space-y-6">
        <TabsList>
          <TabsTrigger value="details">Detalles</TabsTrigger>
          <TabsTrigger value="emails">Emails</TabsTrigger>
        </TabsList>

        <TabsContent value="details" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Main form */}
            <div className="lg:col-span-2">
              <Card>
                <CardHeader>
                  <CardTitle>Información del Caso</CardTitle>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleFormSubmit} className="space-y-6">
                    <div className="space-y-2">
                      <Label htmlFor="radicado">Radicado (23 dígitos)</Label>
                      <Input
                        id="radicado"
                        name="radicado"
                        defaultValue={cgpItem.radicado || ""}
                        placeholder="00000000000000000000000"
                        className="font-mono"
                      />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="court_name">Juzgado</Label>
                        <Input
                          id="court_name"
                          name="court_name"
                          defaultValue={cgpItem.court_name || ""}
                          placeholder="Nombre del juzgado"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="court_email">Email del Juzgado</Label>
                        <Input
                          id="court_email"
                          name="court_email"
                          type="email"
                          defaultValue={cgpItem.court_email || ""}
                          placeholder="correo@juzgado.gov.co"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="court_city">Ciudad</Label>
                        <Input
                          id="court_city"
                          name="court_city"
                          defaultValue={cgpItem.court_city || ""}
                          placeholder="Ciudad"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="court_department">Departamento</Label>
                        <Select name="court_department" defaultValue={cgpItem.court_department || ""}>
                          <SelectTrigger>
                            <SelectValue placeholder="Seleccionar" />
                          </SelectTrigger>
                          <SelectContent>
                            {COLOMBIAN_DEPARTMENTS.map((dept) => (
                              <SelectItem key={dept} value={dept}>
                                {dept}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="demandantes">Demandante(s)</Label>
                        <Input
                          id="demandantes"
                          name="demandantes"
                          defaultValue={cgpItem.demandantes || ""}
                          placeholder="Nombre del demandante"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="demandados">Demandado(s)</Label>
                        <Input
                          id="demandados"
                          name="demandados"
                          defaultValue={cgpItem.demandados || ""}
                          placeholder="Nombre del demandado"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="description">Descripción</Label>
                      <Textarea
                        id="description"
                        name="description"
                        defaultValue={cgpItem.description || ""}
                        placeholder="Descripción del caso"
                        rows={3}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="notes">Notas</Label>
                      <Textarea
                        id="notes"
                        name="notes"
                        defaultValue={cgpItem.notes || ""}
                        placeholder="Notas adicionales"
                        rows={3}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="expediente_url">URL Expediente Electrónico</Label>
                      <Input
                        id="expediente_url"
                        name="expediente_url"
                        type="url"
                        defaultValue={cgpItem.expediente_url || ""}
                        placeholder="https://..."
                      />
                    </div>

                    <Button type="submit" disabled={updateCGPItem.isPending}>
                      {updateCGPItem.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <Save className="h-4 w-4 mr-2" />
                      )}
                      Guardar Cambios
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </div>

            {/* Sidebar */}
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Estado</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Fase</span>
                    <Badge variant={isProcessPhase ? "default" : "secondary"}>
                      {isProcessPhase ? "Proceso" : "Radicación"}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Monitoreo</span>
                    <Badge variant={cgpItem.monitoring_enabled ? "default" : "outline"}>
                      {cgpItem.monitoring_enabled ? "Activo" : "Inactivo"}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Actuaciones</span>
                    <span className="font-mono">{cgpItem.total_actuaciones || 0}</span>
                  </div>
                  {cgpItem.last_crawled_at && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Última sync</span>
                      <span className="text-sm">{formatDateColombia(cgpItem.last_crawled_at)}</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="emails">
          <EntityEmailTab
            entityType="CGP_CASE"
            entityId={id!}
            entityTable="work_items"
            emailLinkingEnabled={cgpItem.email_linking_enabled}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
