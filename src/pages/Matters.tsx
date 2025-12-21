import { useState } from "react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, Search, Briefcase, FileText } from "lucide-react";
import { toast } from "sonner";
import { PRACTICE_AREAS, formatDateColombia } from "@/lib/constants";
import type { Matter } from "@/types/database";

export default function Matters() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [filterArea, setFilterArea] = useState<string>("all");
  const queryClient = useQueryClient();

  const { data: matters, isLoading } = useQuery({
    queryKey: ["matters"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("matters")
        .select("*")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data as Matter[];
    },
  });

  const createMatter = useMutation({
    mutationFn: async (form: FormData) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");

      const { error } = await supabase.from("matters").insert({
        owner_id: user.id,
        client_name: form.get("client_name") as string,
        client_id_number: form.get("client_id_number") as string || null,
        matter_name: form.get("matter_name") as string,
        practice_area: form.get("practice_area") as string || null,
        notes: form.get("notes") as string || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["matters"] });
      setOpen(false);
      toast.success("Asunto creado exitosamente");
    },
    onError: (error) => {
      toast.error("Error al crear asunto: " + error.message);
    },
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    createMatter.mutate(new FormData(e.currentTarget));
  };

  const filteredMatters = matters?.filter((m) => {
    const matchesSearch =
      m.client_name.toLowerCase().includes(search.toLowerCase()) ||
      m.matter_name.toLowerCase().includes(search.toLowerCase());
    const matchesArea = filterArea === "all" || m.practice_area === filterArea;
    return matchesSearch && matchesArea;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-serif font-bold">Asuntos</h1>
          <p className="text-muted-foreground">
            Gestiona tus asuntos y clientes
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" /> Nuevo Asunto
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Crear Nuevo Asunto</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="client_name">Nombre del Cliente *</Label>
                <Input
                  id="client_name"
                  name="client_name"
                  required
                  placeholder="Ej: Juan Pérez"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="client_id_number">Cédula / NIT</Label>
                <Input
                  id="client_id_number"
                  name="client_id_number"
                  placeholder="Ej: 1234567890"
                />
              </div>
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
                <Select name="practice_area">
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccionar área" />
                  </SelectTrigger>
                  <SelectContent>
                    {PRACTICE_AREAS.map((area) => (
                      <SelectItem key={area} value={area}>
                        {area}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
                disabled={createMatter.isPending}
              >
                {createMatter.isPending ? "Creando..." : "Crear Asunto"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por cliente o asunto..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={filterArea} onValueChange={setFilterArea}>
              <SelectTrigger className="w-full sm:w-48">
                <SelectValue placeholder="Filtrar por área" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas las áreas</SelectItem>
                {PRACTICE_AREAS.map((area) => (
                  <SelectItem key={area} value={area}>
                    {area}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">
              Cargando...
            </div>
          ) : filteredMatters?.length === 0 ? (
            <div className="text-center py-12">
              <Briefcase className="mx-auto h-12 w-12 text-muted-foreground/50" />
              <h3 className="mt-4 text-lg font-medium">No hay asuntos</h3>
              <p className="text-muted-foreground">
                Crea tu primer asunto para comenzar
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Asunto</TableHead>
                  <TableHead>Área</TableHead>
                  <TableHead>Actualizado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredMatters?.map((matter) => (
                  <TableRow key={matter.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{matter.client_name}</p>
                        {matter.client_id_number && (
                          <p className="text-sm text-muted-foreground">
                            {matter.client_id_number}
                          </p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{matter.matter_name}</TableCell>
                    <TableCell>
                      {matter.practice_area || (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {formatDateColombia(matter.updated_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" asChild>
                        <a href={`/filings?matter=${matter.id}`}>
                          <FileText className="h-4 w-4 mr-1" />
                          Ver Radicaciones
                        </a>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
