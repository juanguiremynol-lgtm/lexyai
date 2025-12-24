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
  Gavel,
  Plus,
  Edit,
  AlertTriangle,
  Trash2,
  Scale,
  Eye,
} from "lucide-react";
import { toast } from "sonner";
import { formatDateColombia } from "@/lib/constants";
import { StatusBadge } from "@/components/ui/status-badge";
import type { Client } from "@/types/client";

// Statuses that indicate a radicación (before radicado confirmed)
const RADICACION_STATUSES = [
  'DRAFTED',
  'SENT_TO_REPARTO',
  'RECEIPT_CONFIRMED',
  'ACTA_PENDING',
  'ACTA_RECEIVED_PARSED',
  'COURT_EMAIL_DRAFTED',
  'COURT_EMAIL_SENT',
  'RADICADO_PENDING',
];

// Statuses that indicate a proceso (after radicado confirmed)
const PROCESO_STATUSES = [
  'RADICADO_CONFIRMED',
  'ICARUS_SYNC_PENDING',
  'MONITORING_ACTIVE',
  'CLOSED',
];

interface Matter {
  id: string;
  matter_name: string;
  practice_area: string | null;
  created_at: string;
  updated_at: string;
  filings: Filing[];
}

interface Filing {
  id: string;
  filing_type: string;
  status: string;
  radicado: string | null;
  court_name: string | null;
  created_at: string;
  updated_at: string;
}

export default function ClientDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [editOpen, setEditOpen] = useState(false);
  const [newMatterOpen, setNewMatterOpen] = useState(false);
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

  // Fetch monitored processes linked to this client
  const { data: monitoredProcesses, isLoading: processesLoading } = useQuery({
    queryKey: ["client-processes", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("monitored_processes")
        .select("*")
        .eq("client_id", id)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const { data: matters, isLoading: mattersLoading } = useQuery({
    queryKey: ["client-matters", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("matters")
        .select(`
          id,
          matter_name,
          practice_area,
          created_at,
          updated_at,
          filings (
            id,
            filing_type,
            status,
            radicado,
            court_name,
            created_at,
            updated_at
          )
        `)
        .eq("client_id", id)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data as Matter[];
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

  const createMatter = useMutation({
    mutationFn: async (form: FormData) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");

      const { error } = await supabase.from("matters").insert({
        owner_id: user.id,
        client_id: id,
        client_name: client?.name || "",
        matter_name: form.get("matter_name") as string,
        practice_area: form.get("practice_area") as string || null,
        notes: form.get("notes") as string || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["client-matters", id] });
      setNewMatterOpen(false);
      toast.success("Asunto creado");
    },
    onError: (error) => {
      toast.error("Error: " + error.message);
    },
  });

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

  // Separate filings into radicaciones and procesos
  const allFilings = matters?.flatMap(m => 
    m.filings.map(f => ({ ...f, matter_name: m.matter_name, matter_id: m.id }))
  ) || [];

  const radicaciones = allFilings.filter(f => 
    RADICACION_STATUSES.includes(f.status)
  );

  const procesos = allFilings.filter(f => 
    PROCESO_STATUSES.includes(f.status)
  );

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

      {/* Radicaciones & Procesos Tabs */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Radicaciones y Procesos</CardTitle>
            <CardDescription>
              Radicaciones son trámites previos. Procesos son aquellos con radicado confirmado y auto admisorio.
            </CardDescription>
          </div>
          <Dialog open={newMatterOpen} onOpenChange={setNewMatterOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="mr-2 h-4 w-4" /> Nuevo Asunto
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Crear Asunto para {client.name}</DialogTitle>
              </DialogHeader>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  createMatter.mutate(new FormData(e.currentTarget));
                }}
                className="space-y-4"
              >
                <div className="space-y-2">
                  <Label htmlFor="matter_name">Nombre del Asunto *</Label>
                  <Input
                    id="matter_name"
                    name="matter_name"
                    required
                    placeholder="Ej: Divorcio vs. María López"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="practice_area">Área de Práctica</Label>
                  <Input
                    id="practice_area"
                    name="practice_area"
                    placeholder="Ej: Familia"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="notes">Notas</Label>
                  <Textarea
                    id="notes"
                    name="notes"
                    placeholder="Notas adicionales..."
                  />
                </div>
                <Button type="submit" className="w-full" disabled={createMatter.isPending}>
                  {createMatter.isPending ? "Creando..." : "Crear Asunto"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="radicaciones">
            <TabsList className="mb-4">
              <TabsTrigger value="radicaciones" className="flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Radicaciones ({radicaciones.length})
              </TabsTrigger>
              <TabsTrigger value="procesos" className="flex items-center gap-2">
                <Gavel className="h-4 w-4" />
                Procesos Filings ({procesos.length})
              </TabsTrigger>
              <TabsTrigger value="monitored" className="flex items-center gap-2">
                <Scale className="h-4 w-4" />
                Procesos Monitoreados ({monitoredProcesses?.length || 0})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="radicaciones">
              {radicaciones.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <FileText className="mx-auto h-10 w-10 mb-2 opacity-50" />
                  <p>No hay radicaciones en trámite</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Asunto</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead>Creado</TableHead>
                      <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {radicaciones.map((filing) => (
                      <TableRow key={filing.id}>
                        <TableCell className="font-medium">
                          {(filing as any).matter_name}
                        </TableCell>
                        <TableCell>{filing.filing_type}</TableCell>
                        <TableCell>
                          <StatusBadge status={filing.status as any} />
                        </TableCell>
                        <TableCell>{formatDateColombia(filing.created_at)}</TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="sm" asChild>
                            <Link to={`/filings/${filing.id}`}>Ver</Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </TabsContent>

            <TabsContent value="procesos">
              {procesos.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Gavel className="mx-auto h-10 w-10 mb-2 opacity-50" />
                  <p>No hay procesos con radicado confirmado (desde radicaciones)</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Asunto</TableHead>
                      <TableHead>Radicado</TableHead>
                      <TableHead>Juzgado</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {procesos.map((filing) => (
                      <TableRow key={filing.id}>
                        <TableCell className="font-medium">
                          {(filing as any).matter_name}
                        </TableCell>
                        <TableCell>
                          <code className="text-xs bg-muted px-2 py-1 rounded">
                            {filing.radicado || "—"}
                          </code>
                        </TableCell>
                        <TableCell>{filing.court_name || "—"}</TableCell>
                        <TableCell>
                          <StatusBadge status={filing.status as any} />
                        </TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="sm" asChild>
                            <Link to={`/filings/${filing.id}`}>Ver</Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </TabsContent>

            <TabsContent value="monitored">
              {!monitoredProcesses || monitoredProcesses.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Scale className="mx-auto h-10 w-10 mb-2 opacity-50" />
                  <p>No hay procesos monitoreados vinculados a este cliente</p>
                  <p className="text-sm mt-2">
                    Vincule procesos desde la página de Procesos o al crear uno nuevo
                  </p>
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
                    {monitoredProcesses.map((process) => (
                      <TableRow key={process.id}>
                        <TableCell>
                          <code className="text-xs bg-muted px-2 py-1 rounded font-mono">
                            {process.radicado}
                          </code>
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate">
                          {process.despacho_name || "—"}
                        </TableCell>
                        <TableCell className="max-w-[150px] truncate">
                          {process.demandantes || "—"}
                        </TableCell>
                        <TableCell className="max-w-[150px] truncate">
                          {process.demandados || "—"}
                        </TableCell>
                        <TableCell>
                          <Badge variant={process.monitoring_enabled ? "default" : "secondary"}>
                            {process.monitoring_enabled ? "Activo" : "Inactivo"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="sm" asChild>
                            <Link to={`/processes/${process.id}`}>
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
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
