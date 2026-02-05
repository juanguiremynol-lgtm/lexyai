import { useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  ArrowLeft,
  User,
  Mail,
  MapPin,
  CreditCard,
  FileText,
  Plus,
  Edit,
  Trash2,
  Scale,
  Eye,
  Wallet,
  Shield,
  Building2,
  ScrollText,
} from "lucide-react";
import { toast } from "sonner";
import { formatDateColombia } from "@/lib/constants";
import { StatusBadge } from "@/components/ui/status-badge";
import { ContractsTab, ClientDocumentsTab } from "@/components/clients";
import { CreateWorkItemWizard } from "@/components/workflow";
import type { Client } from "@/types/client";

interface WorkItemRow {
  id: string;
  workflow_type: string;
  stage: string;
  status: string;
  radicado: string | null;
  authority_name: string | null;
  demandantes: string | null;
  demandados: string | null;
  monitoring_enabled: boolean;
  created_at: string;
  updated_at: string;
  title: string | null;
  matters: { id: string; matter_name: string } | null;
}

export default function ClientDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [editOpen, setEditOpen] = useState(false);
  const [newFilingOpen, setNewFilingOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data: client, isLoading: clientLoading } = useQuery({
    queryKey: ["client", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("*")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data as Client;
    },
    enabled: !!id,
  });

  // Fetch all work_items linked to this client
  const { data: workItems, isLoading: workItemsLoading } = useQuery({
    queryKey: ["client-work-items", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("work_items")
        .select(`
          id,
          workflow_type,
          stage,
          status,
          radicado,
          authority_name,
          demandantes,
          demandados,
          monitoring_enabled,
          created_at,
          updated_at,
          title,
          matters (id, matter_name)
        `)
        .eq("client_id", id)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data as unknown as WorkItemRow[];
    },
    enabled: !!id,
  });

  // Fetch peticiones linked to this client
  const { data: clientPeticiones } = useQuery({
    queryKey: ["client-peticiones", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("peticiones")
        .select("id, entity_name, subject, phase, radicado, deadline_at, filed_at, updated_at")
        .eq("client_id", id)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const updateClient = useMutation({
    mutationFn: async (form: FormData) => {
      const { error } = await supabase
        .from("clients")
        .update({
          name: form.get("name") as string,
          id_number: form.get("id_number") as string || null,
          address: form.get("address") as string || null,
          city: form.get("city") as string || null,
          email: form.get("email") as string || null,
          notes: form.get("notes") as string || null,
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["client", id] });
      setEditOpen(false);
      toast.success("Cliente actualizado");
    },
    onError: (error) => {
      toast.error("Error: " + error.message);
    },
  });

  // Filter work items by workflow type
  const judicialItems = workItems?.filter(w => ["CGP", "LABORAL", "CPACA", "PENAL_906"].includes(w.workflow_type)) || [];
  const tutelas = workItems?.filter(w => w.workflow_type === "TUTELA") || [];
  const adminProcesses = workItems?.filter(w => w.workflow_type === "GOV_PROCEDURE") || [];

  const deleteClient = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("clients")
        .delete()
        .eq("id", id!);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Cliente eliminado");
      navigate("/clients");
    },
    onError: (error) => {
      toast.error("Error al eliminar: " + error.message);
    },
  });

  if (clientLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-muted-foreground">Cargando...</div>
      </div>
    );
  }

  if (!client) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-medium">Cliente no encontrado</h2>
        <Button asChild className="mt-4">
          <Link to="/clients">Volver a Clientes</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/clients">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex-1">
          <h1 className="text-3xl font-serif font-bold">{client.name}</h1>
          <p className="text-muted-foreground">Detalle del cliente</p>
        </div>
        <div className="flex items-center gap-2">
          <Dialog open={editOpen} onOpenChange={setEditOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <Edit className="mr-2 h-4 w-4" /> Editar
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Editar Cliente</DialogTitle>
              </DialogHeader>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  updateClient.mutate(new FormData(e.currentTarget));
                }}
                className="space-y-4"
              >
                <div className="space-y-2">
                  <Label htmlFor="name">Nombre *</Label>
                  <Input
                    id="name"
                    name="name"
                    required
                    defaultValue={client.name}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="id_number">Cédula / NIT</Label>
                  <Input
                    id="id_number"
                    name="id_number"
                    defaultValue={client.id_number || ""}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Correo</Label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    defaultValue={client.email || ""}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="city">Ciudad</Label>
                    <Input
                      id="city"
                      name="city"
                      defaultValue={client.city || ""}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="address">Dirección</Label>
                    <Input
                      id="address"
                      name="address"
                      defaultValue={client.address || ""}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="notes">Notas</Label>
                  <Textarea
                    id="notes"
                    name="notes"
                    defaultValue={client.notes || ""}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={updateClient.isPending}>
                  {updateClient.isPending ? "Guardando..." : "Guardar Cambios"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="icon" className="text-destructive hover:text-destructive">
                <Trash2 className="h-4 w-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>¿Eliminar cliente?</AlertDialogTitle>
                <AlertDialogDescription>
                  Esta acción eliminará permanentemente a "{client.name}" y todos sus asuntos asociados.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => deleteClient.mutate()}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Eliminar
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* Client Info Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            Información del Cliente
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="flex items-start gap-3">
              <CreditCard className="h-5 w-5 text-muted-foreground mt-0.5" />
              <div>
                <p className="text-sm text-muted-foreground">Cédula/NIT</p>
                <p className="font-medium">{client.id_number || "—"}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Mail className="h-5 w-5 text-muted-foreground mt-0.5" />
              <div>
                <p className="text-sm text-muted-foreground">Correo</p>
                <p className="font-medium">{client.email || "—"}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <MapPin className="h-5 w-5 text-muted-foreground mt-0.5" />
              <div>
                <p className="text-sm text-muted-foreground">Ciudad</p>
                <p className="font-medium">{client.city || "—"}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <MapPin className="h-5 w-5 text-muted-foreground mt-0.5" />
              <div>
                <p className="text-sm text-muted-foreground">Dirección</p>
                <p className="font-medium">{client.address || "—"}</p>
              </div>
            </div>
          </div>
          {client.notes && (
            <div className="mt-4 pt-4 border-t">
              <p className="text-sm text-muted-foreground mb-1">Notas</p>
              <p>{client.notes}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Work Items Tabs */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Trámites y Procesos</CardTitle>
            <CardDescription>
              Demandas, tutelas, peticiones y procesos administrativos vinculados a este cliente
            </CardDescription>
          </div>
          <Button size="sm" onClick={() => setNewFilingOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> Nuevo
          </Button>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="judicial">
            <TabsList className="mb-4 flex-wrap h-auto gap-1">
              <TabsTrigger value="judicial" className="flex items-center gap-2">
                <Scale className="h-4 w-4" />
                Procesos Judiciales ({judicialItems.length})
              </TabsTrigger>
              <TabsTrigger value="tutelas" className="flex items-center gap-2">
                <Shield className="h-4 w-4" />
                Tutelas ({tutelas.length})
              </TabsTrigger>
              <TabsTrigger value="peticiones" className="flex items-center gap-2">
                <ScrollText className="h-4 w-4" />
                Peticiones ({clientPeticiones?.length || 0})
              </TabsTrigger>
              <TabsTrigger value="admin" className="flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                Administrativos ({adminProcesses.length})
              </TabsTrigger>
              <TabsTrigger value="contracts" className="flex items-center gap-2">
                <Wallet className="h-4 w-4" />
                Contratos
              </TabsTrigger>
              <TabsTrigger value="documents" className="flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Documentos
              </TabsTrigger>
            </TabsList>

            {/* Procesos Judiciales Tab */}
            <TabsContent value="judicial">
              {judicialItems.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Scale className="mx-auto h-10 w-10 mb-2 opacity-50" />
                  <p>No hay procesos judiciales vinculados a este cliente</p>
                  <Button variant="outline" size="sm" className="mt-4" onClick={() => setNewFilingOpen(true)}>
                    <Plus className="mr-2 h-4 w-4" /> Crear Demanda
                  </Button>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Radicado</TableHead>
                      <TableHead>Despacho</TableHead>
                      <TableHead>Demandante(s)</TableHead>
                      <TableHead>Demandado(s)</TableHead>
                      <TableHead>Monitoreo</TableHead>
                      <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {judicialItems.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>
                          {item.radicado ? (
                            <code className="text-xs bg-muted px-2 py-1 rounded font-mono">
                              {item.radicado}
                            </code>
                          ) : (
                            <span className="text-muted-foreground">Pendiente</span>
                          )}
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate">
                          {item.authority_name || "—"}
                        </TableCell>
                        <TableCell className="max-w-[150px] truncate">
                          {item.demandantes || "—"}
                        </TableCell>
                        <TableCell className="max-w-[150px] truncate">
                          {item.demandados || "—"}
                        </TableCell>
                        <TableCell>
                          <Badge variant={item.monitoring_enabled ? "default" : "secondary"}>
                            {item.monitoring_enabled ? "Activo" : "Inactivo"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="sm" asChild>
                            <Link to={`/app/work-items/${item.id}`}>
                              <Eye className="h-4 w-4 mr-1" />
                              Ver
                            </Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </TabsContent>

            {/* Tutelas Tab */}
            <TabsContent value="tutelas">
              {tutelas.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Shield className="mx-auto h-10 w-10 mb-2 opacity-50" />
                  <p>No hay tutelas vinculadas a este cliente</p>
                  <Button variant="outline" size="sm" className="mt-4" onClick={() => setNewFilingOpen(true)}>
                    <Plus className="mr-2 h-4 w-4" /> Crear Tutela
                  </Button>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Título</TableHead>
                      <TableHead>Radicado</TableHead>
                      <TableHead>Juzgado</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tutelas.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">
                          {item.title || item.demandantes || "—"}
                        </TableCell>
                        <TableCell>
                          {item.radicado ? (
                            <code className="text-xs bg-muted px-2 py-1 rounded font-mono">
                              {item.radicado}
                            </code>
                          ) : (
                            <span className="text-muted-foreground">Pendiente</span>
                          )}
                        </TableCell>
                        <TableCell>{item.authority_name || "—"}</TableCell>
                        <TableCell>
                          <StatusBadge status={item.status as any} />
                        </TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="sm" asChild>
                            <Link to={`/app/work-items/${item.id}`}>
                              <Eye className="h-4 w-4 mr-1" />
                              Ver
                            </Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </TabsContent>

            {/* Peticiones Tab */}
            <TabsContent value="peticiones">
              {!clientPeticiones || clientPeticiones.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <ScrollText className="mx-auto h-10 w-10 mb-2 opacity-50" />
                  <p>No hay peticiones vinculadas a este cliente</p>
                  <Button variant="outline" size="sm" className="mt-4" onClick={() => setNewFilingOpen(true)}>
                    <Plus className="mr-2 h-4 w-4" /> Crear Petición
                  </Button>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Entidad</TableHead>
                      <TableHead>Asunto</TableHead>
                      <TableHead>Radicado</TableHead>
                      <TableHead>Fase</TableHead>
                      <TableHead>Vencimiento</TableHead>
                      <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {clientPeticiones.map((peticion) => (
                      <TableRow key={peticion.id}>
                        <TableCell className="font-medium">{peticion.entity_name}</TableCell>
                        <TableCell className="max-w-[200px] truncate">{peticion.subject}</TableCell>
                        <TableCell>
                          {peticion.radicado ? (
                            <code className="text-xs bg-muted px-2 py-1 rounded font-mono">
                              {peticion.radicado}
                            </code>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{peticion.phase}</Badge>
                        </TableCell>
                        <TableCell>
                          {peticion.deadline_at ? formatDateColombia(new Date(peticion.deadline_at)) : "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="sm" asChild>
                            <Link to={`/app/peticiones/${peticion.id}`}>
                              <Eye className="h-4 w-4 mr-1" />
                              Ver
                            </Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </TabsContent>

            {/* Admin Processes Tab */}
            <TabsContent value="admin">
              {adminProcesses.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Building2 className="mx-auto h-10 w-10 mb-2 opacity-50" />
                  <p>No hay procesos administrativos vinculados</p>
                  <Button variant="outline" size="sm" className="mt-4" onClick={() => setNewFilingOpen(true)}>
                    <Plus className="mr-2 h-4 w-4" /> Crear Proceso Administrativo
                  </Button>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Radicado</TableHead>
                      <TableHead>Autoridad</TableHead>
                      <TableHead>Etapa</TableHead>
                      <TableHead>Monitoreo</TableHead>
                      <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {adminProcesses.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>
                          {item.radicado ? (
                            <code className="text-xs bg-muted px-2 py-1 rounded font-mono">
                              {item.radicado}
                            </code>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate">
                          {item.authority_name || "—"}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{item.stage}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={item.monitoring_enabled ? "default" : "secondary"}>
                            {item.monitoring_enabled ? "Activo" : "Inactivo"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="sm" asChild>
                            <Link to={`/app/work-items/${item.id}`}>
                              <Eye className="h-4 w-4 mr-1" />
                              Ver
                            </Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </TabsContent>

            {/* Contracts Tab */}
            <TabsContent value="contracts">
              <ContractsTab clientId={id!} clientName={client.name} />
            </TabsContent>

            {/* Documents Tab */}
            <TabsContent value="documents">
              <ClientDocumentsTab client={{ id: id!, name: client.name, id_number: client.id_number, email: client.email }} />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Create Work Item Wizard */}
      <CreateWorkItemWizard
        open={newFilingOpen}
        onOpenChange={setNewFilingOpen}
        defaultClientId={id}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ["client-work-items", id] });
          setNewFilingOpen(false);
        }}
      />
    </div>
  );
}
