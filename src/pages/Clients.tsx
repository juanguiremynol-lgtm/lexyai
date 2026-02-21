import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";
import { useDisabledDocTypes } from "@/hooks/useDisabledDocTypes";
import { PostClientCreationPrompt } from "@/components/clients/PostClientCreationPrompt";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Plus, Search, Users, Eye, Trash2 } from "lucide-react";
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
import { toast } from "sonner";
import { formatDateColombia } from "@/lib/constants";
import { Link } from "react-router-dom";
import type { Client } from "@/types/client";

export default function Clients() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const queryClient = useQueryClient();
  const { organization } = useOrganization();
  const disabledDocTypes = useDisabledDocTypes();

  const { data: clients, isLoading } = useQuery({
    queryKey: ["clients"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("*")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data as Client[];
    },
  });

  // Post-creation prompt state
  const [showContractPrompt, setShowContractPrompt] = useState(false);
  const [createdClientId, setCreatedClientId] = useState<string>("");
  const [createdClientName, setCreatedClientName] = useState<string>("");

  const createClient = useMutation({
    mutationFn: async (form: FormData) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");

      const name = form.get("name") as string;
      const { data, error } = await supabase.from("clients").insert({
        owner_id: user.id,
        organization_id: organization?.id || null,
        name,
        id_number: form.get("id_number") as string || null,
        address: form.get("address") as string || null,
        city: form.get("city") as string || null,
        email: form.get("email") as string || null,
        notes: form.get("notes") as string || null,
      }).select("id, name").single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      setOpen(false);
      setCreatedClientId(data.id);
      setCreatedClientName(data.name);
      setShowContractPrompt(true);
    },
    onError: (error: any) => {
      const msg = error?.message || String(error);
      if (msg.includes('limit reached') || msg.includes('maximum') || msg.includes('Client limit')) {
        // Extract count/limit from message like "Client limit reached: 25/25 clients..."
        const match = msg.match(/(\d+)\/(\d+)/);
        const detail = match ? ` (${match[1]}/${match[2]})` : '';
        toast.error(`Has alcanzado el límite de clientes para tu plan${detail}. Elimina un cliente existente o mejora tu plan.`);
      } else {
        toast.error("Error al crear cliente: " + msg);
      }
    },
  });

  const deleteClient = useMutation({
    mutationFn: async (clientId: string) => {
      const { error } = await supabase
        .from("clients")
        .delete()
        .eq("id", clientId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      toast.success("Cliente eliminado");
    },
    onError: (error) => {
      toast.error("Error al eliminar: " + error.message);
    },
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    createClient.mutate(new FormData(e.currentTarget));
  };

  const filteredClients = clients?.filter((c) => {
    const matchesSearch =
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.id_number?.toLowerCase().includes(search.toLowerCase()) ||
      c.email?.toLowerCase().includes(search.toLowerCase());
    return matchesSearch;
  });

  return (
    <>
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-serif font-bold">Clientes</h1>
          <p className="text-muted-foreground">
            Gestiona tus clientes y sus radicaciones/procesos
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" /> Nuevo Cliente
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Crear Nuevo Cliente</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Nombre del Cliente *</Label>
                <Input
                  id="name"
                  name="name"
                  required
                  placeholder="Ej: Juan Pérez"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="id_number">Cédula / NIT</Label>
                <Input
                  id="id_number"
                  name="id_number"
                  placeholder="Ej: 1234567890"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Correo Electrónico</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="Ej: cliente@email.com"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="city">Ciudad</Label>
                  <Input
                    id="city"
                    name="city"
                    placeholder="Ej: Bogotá"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="address">Dirección</Label>
                  <Input
                    id="address"
                    name="address"
                    placeholder="Ej: Calle 123 #45-67"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="notes">Notas</Label>
                <Textarea
                  id="notes"
                  name="notes"
                  placeholder="Notas adicionales..."
                />
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={createClient.isPending}
              >
                {createClient.isPending ? "Creando..." : "Crear Cliente"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por nombre, cédula o correo..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">
              Cargando...
            </div>
          ) : filteredClients?.length === 0 ? (
            <div className="text-center py-12">
              <Users className="mx-auto h-12 w-12 text-muted-foreground/50" />
              <h3 className="mt-4 text-lg font-medium">No hay clientes</h3>
              <p className="text-muted-foreground">
                Crea tu primer cliente para comenzar
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Cédula/NIT</TableHead>
                  <TableHead>Ciudad</TableHead>
                  <TableHead>Correo</TableHead>
                  <TableHead>Actualizado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredClients?.map((client) => (
                  <TableRow key={client.id}>
                    <TableCell className="font-medium">{client.name}</TableCell>
                    <TableCell>
                      {client.id_number || (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {client.city || (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {client.email || (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {formatDateColombia(client.updated_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button variant="ghost" size="sm" asChild>
                          <Link to={`/app/clients/${client.id}`}>
                            <Eye className="h-4 w-4 mr-1" />
                            Ver
                          </Link>
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>¿Eliminar cliente?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Esta acción eliminará permanentemente a "{client.name}" y no se puede deshacer.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancelar</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => deleteClient.mutate(client.id)}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                Eliminar
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>

    <PostClientCreationPrompt
      open={showContractPrompt}
      onOpenChange={setShowContractPrompt}
      clientId={createdClientId}
      clientName={createdClientName}
      disabledDocTypes={disabledDocTypes}
    />
    </>
  );
}
