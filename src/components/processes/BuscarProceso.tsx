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
import { Progress } from "@/components/ui/progress";
import { Search, Loader2, AlertCircle, ChevronDown, ChevronUp, Scale, Calendar, User, Building2, FileText, Clock, Bell, Users, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
  fetchFromRamaJudicial,
  validateRadicadoFormat,
  type RamaJudicialApiResponse,
} from "@/lib/rama-judicial-api";

interface BuscarProcesoProps {
  onResultFound?: (data: RamaJudicialApiResponse, radicado: string) => void;
  showRegisterButton?: boolean;
}

export function BuscarProceso({ onResultFound, showRegisterButton = false }: BuscarProcesoProps) {
  const [radicado, setRadicado] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RamaJudicialApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isTimeoutError, setIsTimeoutError] = useState(false);
  const [actuacionesOpen, setActuacionesOpen] = useState(false);
  const [progress, setProgress] = useState(0);

  const handleSearch = async () => {
    const validation = validateRadicadoFormat(radicado);
    
    if (!validation.valid) {
      toast.error(validation.error);
      return;
    }

    setLoading(true);
    setError(null);
    setIsTimeoutError(false);
    setResult(null);
    setActuacionesOpen(false);
    setProgress(0);

    // Simulate progress for UX (the API takes 15-20 seconds)
    const progressInterval = setInterval(() => {
      setProgress(prev => {
        if (prev >= 90) return prev;
        return prev + (90 - prev) * 0.1;
      });
    }, 500);

    const fetchResult = await fetchFromRamaJudicial(validation.cleaned, 30000);

    clearInterval(progressInterval);
    setProgress(100);

    if (!fetchResult.success) {
      setError(fetchResult.error || "Error al buscar proceso");
      setIsTimeoutError(fetchResult.isTimeout || false);
      toast.error(fetchResult.error || "Error al buscar proceso");
    } else if (fetchResult.data) {
      setResult(fetchResult.data);
      toast.success(`Proceso encontrado con ${fetchResult.data.total_actuaciones} actuaciones`);
      onResultFound?.(fetchResult.data, validation.cleaned);
    }

    setLoading(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !loading) {
      handleSearch();
    }
  };

  const formatRadicadoInput = (value: string) => {
    return value.replace(/\D/g, "").slice(0, 23);
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
                onChange={(e) => setRadicado(formatRadicadoInput(e.target.value))}
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

          {/* Enhanced Loading State */}
          {loading && (
            <div className="space-y-4 p-4 rounded-lg bg-muted/50 border border-border">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-foreground">Consultando Rama Judicial...</p>
                  <p className="text-sm text-muted-foreground">
                    Esto puede tardar 15-20 segundos
                  </p>
                </div>
              </div>
              <Progress value={progress} className="h-2" />
              <p className="text-xs text-muted-foreground text-center">
                Extrayendo información del proceso judicial en tiempo real
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Error State */}
      {error && (
        <Card className="border-destructive bg-destructive/5">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-destructive mt-0.5" />
              <div className="flex-1">
                <p className="font-medium text-destructive">Error en la consulta</p>
                <p className="text-sm text-muted-foreground mt-1">{error}</p>
                {isTimeoutError && (
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="mt-3"
                    onClick={handleSearch}
                  >
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Reintentar
                  </Button>
                )}
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
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50 md:col-span-2 lg:col-span-3">
                    <Building2 className="h-5 w-5 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-sm text-muted-foreground">Despacho</p>
                      <p className="font-medium">{result.proceso["Despacho"]}</p>
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

          {/* Sujetos Procesales */}
          {result.sujetos_procesales && result.sujetos_procesales.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5 text-primary" />
                  Sujetos Procesales
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[200px]">Tipo</TableHead>
                      <TableHead>Nombre</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.sujetos_procesales.map((sujeto, index) => (
                      <TableRow key={index}>
                        <TableCell>
                          <Badge variant={sujeto.tipo.toLowerCase().includes('demandante') ? 'default' : 'secondary'}>
                            {sujeto.tipo}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-medium">{sujeto.nombre}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* Fallback: Show Demandante/Demandado from proceso if no sujetos_procesales */}
          {(!result.sujetos_procesales || result.sujetos_procesales.length === 0) && 
           (result.proceso["Demandante"] || result.proceso["Demandado"]) && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5 text-primary" />
                  Partes del Proceso
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                </div>
              </CardContent>
            </Card>
          )}

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
                            <TableHead className="w-[120px]">Fecha Actuación</TableHead>
                            <TableHead>Actuación</TableHead>
                            <TableHead className="hidden lg:table-cell">Anotación</TableHead>
                            <TableHead className="w-[100px] hidden md:table-cell">Inicia Término</TableHead>
                            <TableHead className="w-[100px] hidden md:table-cell">Finaliza Término</TableHead>
                            <TableHead className="w-[100px] hidden xl:table-cell">Fecha Registro</TableHead>
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
                              <TableCell className="hidden lg:table-cell text-muted-foreground text-sm max-w-md">
                                <div className="line-clamp-2">
                                  {actuacion["Anotación"] || "-"}
                                </div>
                              </TableCell>
                              <TableCell className="hidden md:table-cell text-sm">
                                {actuacion["Fecha inicia Término"] || "-"}
                              </TableCell>
                              <TableCell className="hidden md:table-cell text-sm">
                                {actuacion["Fecha finaliza Término"] || "-"}
                              </TableCell>
                              <TableCell className="hidden xl:table-cell text-sm">
                                {actuacion["Fecha de Registro"] || "-"}
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