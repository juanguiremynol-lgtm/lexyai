import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Search,
  Plus,
  RefreshCw,
  Download,
  Upload,
  Eye,
  Trash2,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  ExternalLink,
  FlaskConical,
  AlertTriangle,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { formatDateColombia, validateRadicado } from "@/lib/constants";
import { SOURCE_ADAPTERS, type DataSource } from "@/lib/source-adapters";
import { UnlinkedProcessesAlert } from "@/components/processes";

interface MonitoredProcess {
  id: string;
  radicado: string;
  despacho_name: string | null;
  department: string | null;
  municipality: string | null;
  sources_enabled: string[];
  monitoring_enabled: boolean;
  monitoring_schedule: string;
  last_checked_at: string | null;
  last_change_at: string | null;
  notes: string | null;
  created_at: string;
}

interface SearchResult {
  radicado: string;
  despacho: string;
  demandante?: string;
  demandado?: string;
  detail_url?: string;
}

export default function ProcessStatus() {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<{
    CPNU?: { results: SearchResult[]; events: unknown[]; run_id?: string; ok?: boolean; error?: string };
    PUBLICACIONES?: unknown;
    HISTORICO?: unknown;
  } | null>(null);
  const [searchError, setSearchError] = useState<{ message: string; run_id?: string } | null>(null);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [newProcessRadicado, setNewProcessRadicado] = useState("");
  const [newProcessDespacho, setNewProcessDespacho] = useState("");

  // Fetch monitored processes
  const { data: processes, isLoading } = useQuery({
    queryKey: ["monitored-processes"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");

      const { data, error } = await supabase
        .from("monitored_processes")
        .select("*")
        .eq("owner_id", user.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as MonitoredProcess[];
    },
  });

  // Search mutation
  const searchMutation = useMutation({
    mutationFn: async (radicado: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");

      const { data, error } = await supabase.functions.invoke("process-monitor", {
        body: {
          action: "search",
          radicado,
          owner_id: user.id,
        },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      setSearchError(null);
      setSearchResults(data.results);
      
      // Check for CPNU errors
      const cpnuResult = data.results?.CPNU;
      if (cpnuResult?.ok === false) {
        setSearchError({
          message: cpnuResult.error || "Error desconocido en CPNU",
          run_id: cpnuResult.run_id,
        });
        toast.error("Error en CPNU - Ver diagnóstico");
        return;
      }
      
      if (cpnuResult?.results?.length > 0) {
        toast.success(`Encontrados ${cpnuResult.results.length} resultado(s) en CPNU`);
      } else {
        toast.info("No se encontraron resultados. El proceso podría no estar en el sistema aún.");
      }
    },
    onError: (error) => {
      setSearchError({ message: error.message });
      toast.error("Error en la búsqueda: " + error.message);
    },
  });

  // Add process mutation
  const addProcessMutation = useMutation({
    mutationFn: async ({ radicado, despacho }: { radicado: string; despacho?: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");

      const { data, error } = await supabase
        .from("monitored_processes")
        .insert({
          owner_id: user.id,
          radicado,
          despacho_name: despacho || null,
          sources_enabled: ["CPNU"],
          monitoring_enabled: false,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["monitored-processes"] });
      toast.success("Proceso agregado a la lista de monitoreo");
      setAddDialogOpen(false);
      setNewProcessRadicado("");
      setNewProcessDespacho("");
      setSearchResults(null);
    },
    onError: (error) => {
      if (error.message.includes("duplicate")) {
        toast.error("Este radicado ya está en tu lista de monitoreo");
      } else {
        toast.error("Error: " + error.message);
      }
    },
  });

  // Toggle monitoring mutation
  const toggleMonitoringMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const { error } = await supabase
        .from("monitored_processes")
        .update({ monitoring_enabled: enabled })
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["monitored-processes"] });
      toast.success("Estado de monitoreo actualizado");
    },
    onError: (error) => {
      toast.error("Error: " + error.message);
    },
  });

  // Delete process mutation
  const deleteProcessMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("monitored_processes")
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["monitored-processes"] });
      toast.success("Proceso eliminado de la lista");
    },
    onError: (error) => {
      toast.error("Error: " + error.message);
    },
  });

  // Manual crawl mutation
  const crawlMutation = useMutation({
    mutationFn: async (processId: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");

      const { data, error } = await supabase.functions.invoke("process-monitor", {
        body: {
          action: "crawl",
          process_id: processId,
          owner_id: user.id,
        },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["monitored-processes"] });
      if (data.total_new_events > 0) {
        toast.success(`Se encontraron ${data.total_new_events} nuevas actuaciones`);
      } else {
        toast.info("No se encontraron nuevas actuaciones");
      }
    },
    onError: (error) => {
      toast.error("Error al consultar: " + error.message);
    },
  });

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      toast.error("Ingrese un radicado para buscar");
      return;
    }

    if (searchQuery.length === 23 && !validateRadicado(searchQuery)) {
      toast.error("El radicado debe tener exactamente 23 dígitos");
      return;
    }

    setIsSearching(true);
    try {
      await searchMutation.mutateAsync(searchQuery);
    } finally {
      setIsSearching(false);
    }
  };

  const handleAddFromSearch = (result: SearchResult) => {
    setNewProcessRadicado(result.radicado);
    setNewProcessDespacho(result.despacho);
    setAddDialogOpen(true);
  };

  const getSourceStatusBadge = (sources: string[]) => {
    return sources.map((source) => {
      const adapter = SOURCE_ADAPTERS[source as DataSource];
      return (
        <Badge key={source} variant="outline" className="text-xs">
          {adapter?.name.split(" ")[0] || source}
        </Badge>
      );
    });
  };

  return (
    <>
      {/* Add Process Dialog - Outside Tabs so it's accessible from search results */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Agregar Proceso a Monitoreo</DialogTitle>
            <DialogDescription>
              Ingrese los datos del proceso que desea monitorear
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="add-radicado">Radicado (23 dígitos)</Label>
              <Input
                id="add-radicado"
                placeholder="11001310301520230001200"
                value={newProcessRadicado}
                onChange={(e) => setNewProcessRadicado(e.target.value)}
                maxLength={23}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="add-despacho">Despacho (opcional)</Label>
              <Input
                id="add-despacho"
                placeholder="Juzgado 15 Civil del Circuito"
                value={newProcessDespacho}
                onChange={(e) => setNewProcessDespacho(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setAddDialogOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              onClick={() =>
                addProcessMutation.mutate({
                  radicado: newProcessRadicado,
                  despacho: newProcessDespacho,
                })
              }
              disabled={
                !newProcessRadicado ||
                newProcessRadicado.length !== 23 ||
                addProcessMutation.isPending
              }
            >
              {addProcessMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Plus className="h-4 w-4 mr-2" />
              )}
              Agregar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="space-y-6">
        <UnlinkedProcessesAlert />
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-serif font-bold">Estado de Procesos</h1>
            <p className="text-muted-foreground">
              Busque, agregue y monitoree procesos judiciales
            </p>
          </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to="/process-status/test">
              <FlaskConical className="h-4 w-4 mr-2" />
              Test Harness
            </Link>
          </Button>
          <Button variant="outline" size="sm">
            <Upload className="h-4 w-4 mr-2" />
            Importar Excel
          </Button>
          <Button variant="outline" size="sm">
            <Download className="h-4 w-4 mr-2" />
            Exportar
          </Button>
        </div>
      </div>

      <Tabs defaultValue="search" className="space-y-4">
        <TabsList>
          <TabsTrigger value="search">
            <Search className="h-4 w-4 mr-2" />
            Buscar Proceso
          </TabsTrigger>
          <TabsTrigger value="monitoring">
            <Eye className="h-4 w-4 mr-2" />
            Lista de Monitoreo ({processes?.length || 0})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="search" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Buscar Proceso</CardTitle>
              <CardDescription>
                Ingrese el número de radicado (23 dígitos) o nombre de parte para buscar
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-4">
                <div className="flex-1">
                  <Label htmlFor="search">Radicado o Nombre</Label>
                  <Input
                    id="search"
                    placeholder="Ej: 11001310301520230001200"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  />
                </div>
                <div className="flex items-end">
                  <Button onClick={handleSearch} disabled={isSearching}>
                    {isSearching ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Search className="h-4 w-4 mr-2" />
                    )}
                    Buscar
                  </Button>
                </div>
              </div>

              <div className="flex gap-2 text-xs text-muted-foreground">
                <span>Fuentes:</span>
                {Object.values(SOURCE_ADAPTERS).map((adapter) => (
                  <Badge
                    key={adapter.id}
                    variant={adapter.active ? "secondary" : "outline"}
                    className="text-xs"
                  >
                    {adapter.active ? (
                      <CheckCircle2 className="h-3 w-3 mr-1" />
                    ) : (
                      <XCircle className="h-3 w-3 mr-1" />
                    )}
                    {adapter.name.split(" ")[0]}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Error Alert with Diagnostics Link */}
          {searchError && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Error en la Búsqueda</AlertTitle>
              <AlertDescription className="flex items-center justify-between">
                <span>{searchError.message}</span>
                {searchError.run_id && (
                  <Button variant="outline" size="sm" asChild>
                    <Link to={`/process-status/diagnostics/${searchError.run_id}`}>
                      Ver Diagnóstico
                    </Link>
                  </Button>
                )}
              </AlertDescription>
            </Alert>
          )}

          {/* Search Results */}
          {searchResults && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Resultados de Búsqueda</CardTitle>
                  {searchResults.CPNU?.run_id && (
                    <Link to={`/process-status/diagnostics/${searchResults.CPNU.run_id}`}>
                      <Badge variant="secondary" className="cursor-pointer text-xs">
                        Run: {searchResults.CPNU.run_id.substring(0, 8)}...
                      </Badge>
                    </Link>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {searchResults.CPNU?.results?.length > 0 ? (
                  <div className="space-y-4">
                    <h4 className="font-medium flex items-center gap-2">
                      <Badge>CPNU</Badge>
                      {searchResults.CPNU.results.length} resultado(s)
                    </h4>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Radicado</TableHead>
                          <TableHead>Despacho</TableHead>
                          <TableHead className="text-right">Acciones</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {searchResults.CPNU.results.map((result, idx) => (
                          <TableRow key={idx}>
                            <TableCell className="font-mono text-sm">
                              {result.radicado}
                            </TableCell>
                            <TableCell>{result.despacho}</TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-2">
                                {result.detail_url && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    asChild
                                  >
                                    <a
                                      href={result.detail_url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                    >
                                      <ExternalLink className="h-4 w-4" />
                                    </a>
                                  </Button>
                                )}
                                <Button
                                  size="sm"
                                  onClick={() => handleAddFromSearch(result)}
                                >
                                  <Plus className="h-4 w-4 mr-1" />
                                  Agregar
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <Search className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>No se encontraron resultados</p>
                    <p className="text-sm mt-2">
                      Puede agregar el proceso manualmente si conoce el radicado
                    </p>
                    <Button
                      variant="outline"
                      className="mt-4"
                      onClick={() => {
                        setNewProcessRadicado(searchQuery);
                        setAddDialogOpen(true);
                      }}
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Agregar Manualmente
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="monitoring" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Procesos Monitoreados</CardTitle>
                <CardDescription>
                  Administre los procesos en su lista de seguimiento
                </CardDescription>
              </div>
              <Button onClick={() => setAddDialogOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Agregar Proceso
              </Button>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : processes?.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Eye className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No hay procesos en monitoreo</p>
                  <p className="text-sm mt-2">
                    Busque un proceso o agrégelo manualmente
                  </p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Radicado</TableHead>
                      <TableHead>Despacho</TableHead>
                      <TableHead>Fuentes</TableHead>
                      <TableHead>Última Consulta</TableHead>
                      <TableHead>Último Cambio</TableHead>
                      <TableHead>Monitoreo</TableHead>
                      <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {processes?.map((process) => (
                      <TableRow key={process.id}>
                        <TableCell className="font-mono text-sm">
                          <Link
                            to={`/process-status/${process.id}`}
                            className="hover:underline text-primary"
                          >
                            {process.radicado}
                          </Link>
                        </TableCell>
                        <TableCell className="max-w-48 truncate">
                          {process.despacho_name || "—"}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            {getSourceStatusBadge(process.sources_enabled || [])}
                          </div>
                        </TableCell>
                        <TableCell>
                          {process.last_checked_at ? (
                            <span className="text-sm flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {formatDateColombia(process.last_checked_at)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {process.last_change_at ? (
                            <span className="text-sm">
                              {formatDateColombia(process.last_change_at)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Switch
                            checked={process.monitoring_enabled}
                            onCheckedChange={(checked) =>
                              toggleMonitoringMutation.mutate({
                                id: process.id,
                                enabled: checked,
                              })
                            }
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => crawlMutation.mutate(process.id)}
                              disabled={crawlMutation.isPending}
                              title="Consultar ahora"
                            >
                              {crawlMutation.isPending ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <RefreshCw className="h-4 w-4" />
                              )}
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              asChild
                              title="Ver detalle"
                            >
                              <Link to={`/process-status/${process.id}`}>
                                <Eye className="h-4 w-4" />
                              </Link>
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => deleteProcessMutation.mutate(process.id)}
                              className="text-destructive hover:text-destructive"
                              title="Eliminar"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      </div>
    </>
  );
}
