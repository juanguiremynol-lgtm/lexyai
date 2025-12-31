import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { Search, Loader2, AlertCircle, ChevronDown, ChevronUp, Scale, Calendar, User, Building2, FileText, Clock, Bell } from "lucide-react";
import { API_BASE_URL } from "@/config/api";
import { toast } from "sonner";

interface Proceso {
  "Fecha de Radicación"?: string;
  "Tipo de Proceso"?: string;
  "Despacho"?: string;
  "Demandante"?: string;
  "Demandado"?: string;
  "Clase de Proceso"?: string;
  "Ubicación"?: string;
  [key: string]: string | undefined;
}

interface Actuacion {
  "Fecha de Actuación"?: string;
  "Actuación"?: string;
  "Anotación"?: string;
  "Fecha inicia Término"?: string;
  "Fecha finaliza Término"?: string;
  "Fecha de Registro"?: string;
}

interface ApiResponse {
  proceso: Proceso;
  actuaciones: Actuacion[];
  total_actuaciones: number;
  ultima_actuacion: Actuacion;
  contador_web: number;
}

export function BuscarProceso() {
  const [radicado, setRadicado] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actuacionesOpen, setActuacionesOpen] = useState(false);

  const validateRadicado = (value: string): boolean => {
    const cleanValue = value.replace(/\D/g, "");
    return cleanValue.length === 23;
  };

  const handleSearch = async () => {
    const cleanRadicado = radicado.replace(/\D/g, "");
    
    if (!cleanRadicado) {
      toast.error("Ingrese un número de radicación");
      return;
    }

    if (!validateRadicado(cleanRadicado)) {
      toast.error("El número de radicación debe tener 23 dígitos");
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);
    setActuacionesOpen(false);

    try {
      const response = await fetch(
        `${API_BASE_URL}/buscar?numero_radicacion=${encodeURIComponent(cleanRadicado)}`
      );

      if (!response.ok) {
        throw new Error(`Error ${response.status}: ${response.statusText}`);
      }

      const data: ApiResponse = await response.json();
      setResult(data);
      toast.success(`Proceso encontrado con ${data.total_actuaciones} actuaciones`);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Error al buscar proceso";
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !loading) {
      handleSearch();
    }
  };

  const formatRadicado = (value: string) => {
    const digits = value.replace(/\D/g, "").slice(0, 23);
    return digits;
  };

  return (
    <div className="space-y-6">
      {/* Search Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Scale className="h-5 w-5 text-primary" />
            Consulta de Procesos Judiciales
          </CardTitle>
          <CardDescription>
            Ingrese el número de radicación de 23 dígitos para consultar el estado del proceso
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <div className="flex-1 space-y-1">
              <Input
                placeholder="Ej: 05001310500120230012300"
                value={radicado}
                onChange={(e) => setRadicado(formatRadicado(e.target.value))}
                onKeyDown={handleKeyDown}
                disabled={loading}
                className="font-mono text-lg"
                maxLength={23}
              />
              <p className="text-xs text-muted-foreground">
                {radicado.length}/23 dígitos
                {radicado.length === 23 && (
                  <span className="text-green-600 ml-2">✓ Formato válido</span>
                )}
              </p>
            </div>
            <Button 
              onClick={handleSearch} 
              disabled={loading || radicado.length !== 23}
              size="lg"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Consultando...
                </>
              ) : (
                <>
                  <Search className="mr-2 h-4 w-4" />
                  Buscar
                </>
              )}
            </Button>
          </div>

          {loading && (
            <div className="flex items-center gap-3 p-4 rounded-lg bg-muted/50">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <div>
                <p className="font-medium">Consultando Rama Judicial...</p>
                <p className="text-sm text-muted-foreground">
                  Este proceso puede tardar 10-15 segundos
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Error State */}
      {error && (
        <Card className="border-destructive">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3 text-destructive">
              <AlertCircle className="h-5 w-5" />
              <div>
                <p className="font-medium">Error en la consulta</p>
                <p className="text-sm">{error}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-4">
          {/* Process Info Card */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5 text-primary" />
                  Información del Proceso
                </CardTitle>
                <Badge variant="outline" className="text-sm">
                  {result.total_actuaciones} actuaciones
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {result.proceso["Tipo de Proceso"] && (
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                    <Scale className="h-5 w-5 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-sm text-muted-foreground">Tipo de Proceso</p>
                      <p className="font-medium">{result.proceso["Tipo de Proceso"]}</p>
                    </div>
                  </div>
                )}
                
                {result.proceso["Clase de Proceso"] && (
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                    <FileText className="h-5 w-5 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-sm text-muted-foreground">Clase de Proceso</p>
                      <p className="font-medium">{result.proceso["Clase de Proceso"]}</p>
                    </div>
                  </div>
                )}

                {result.proceso["Fecha de Radicación"] && (
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                    <Calendar className="h-5 w-5 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-sm text-muted-foreground">Fecha de Radicación</p>
                      <p className="font-medium">{result.proceso["Fecha de Radicación"]}</p>
                    </div>
                  </div>
                )}

                {result.proceso["Despacho"] && (
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                    <Building2 className="h-5 w-5 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-sm text-muted-foreground">Despacho</p>
                      <p className="font-medium">{result.proceso["Despacho"]}</p>
                    </div>
                  </div>
                )}

                {result.proceso["Demandante"] && (
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                    <User className="h-5 w-5 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-sm text-muted-foreground">Demandante</p>
                      <p className="font-medium">{result.proceso["Demandante"]}</p>
                    </div>
                  </div>
                )}

                {result.proceso["Demandado"] && (
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                    <User className="h-5 w-5 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-sm text-muted-foreground">Demandado</p>
                      <p className="font-medium">{result.proceso["Demandado"]}</p>
                    </div>
                  </div>
                )}

                {result.proceso["Ubicación"] && (
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50 md:col-span-2 lg:col-span-3">
                    <Building2 className="h-5 w-5 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-sm text-muted-foreground">Ubicación</p>
                      <p className="font-medium">{result.proceso["Ubicación"]}</p>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Last Action Highlighted */}
          {result.ultima_actuacion && (
            <Card className="border-primary/50 bg-primary/5">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-primary">
                  <Bell className="h-5 w-5" />
                  Última Actuación
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Badge>{result.ultima_actuacion["Fecha de Actuación"]}</Badge>
                    <span className="font-semibold">{result.ultima_actuacion["Actuación"]}</span>
                  </div>
                  {result.ultima_actuacion["Anotación"] && (
                    <p className="text-muted-foreground bg-background/50 p-3 rounded-md">
                      {result.ultima_actuacion["Anotación"]}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                    {result.ultima_actuacion["Fecha inicia Término"] && (
                      <div className="flex items-center gap-1">
                        <Clock className="h-4 w-4" />
                        <span>Inicia: {result.ultima_actuacion["Fecha inicia Término"]}</span>
                      </div>
                    )}
                    {result.ultima_actuacion["Fecha finaliza Término"] && (
                      <div className="flex items-center gap-1">
                        <Clock className="h-4 w-4" />
                        <span>Finaliza: {result.ultima_actuacion["Fecha finaliza Término"]}</span>
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* All Actions - Collapsible */}
          {result.actuaciones && result.actuaciones.length > 0 && (
            <Collapsible open={actuacionesOpen} onOpenChange={setActuacionesOpen}>
              <Card>
                <CollapsibleTrigger asChild>
                  <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
                    <div className="flex items-center justify-between">
                      <CardTitle className="flex items-center gap-2">
                        <FileText className="h-5 w-5 text-primary" />
                        Historial de Actuaciones
                        <Badge variant="secondary">{result.total_actuaciones}</Badge>
                      </CardTitle>
                      {actuacionesOpen ? (
                        <ChevronUp className="h-5 w-5 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-5 w-5 text-muted-foreground" />
                      )}
                    </div>
                  </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-[120px]">Fecha</TableHead>
                            <TableHead>Actuación</TableHead>
                            <TableHead className="hidden lg:table-cell">Anotación</TableHead>
                            <TableHead className="w-[100px] hidden md:table-cell">Inicia</TableHead>
                            <TableHead className="w-[100px] hidden md:table-cell">Finaliza</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {result.actuaciones.map((actuacion, index) => (
                            <TableRow key={index}>
                              <TableCell className="font-mono text-sm">
                                {actuacion["Fecha de Actuación"] || "-"}
                              </TableCell>
                              <TableCell className="font-medium">
                                {actuacion["Actuación"] || "-"}
                                {/* Show anotación on mobile */}
                                {actuacion["Anotación"] && (
                                  <p className="text-sm text-muted-foreground mt-1 lg:hidden">
                                    {actuacion["Anotación"]}
                                  </p>
                                )}
                              </TableCell>
                              <TableCell className="hidden lg:table-cell text-muted-foreground text-sm max-w-md truncate">
                                {actuacion["Anotación"] || "-"}
                              </TableCell>
                              <TableCell className="hidden md:table-cell text-sm">
                                {actuacion["Fecha inicia Término"] || "-"}
                              </TableCell>
                              <TableCell className="hidden md:table-cell text-sm">
                                {actuacion["Fecha finaliza Término"] || "-"}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          )}
        </div>
      )}
    </div>
  );
}
