import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Search, Loader2, AlertCircle } from "lucide-react";
import { API_BASE_URL } from "@/config/api";
import { toast } from "sonner";

interface ProcesoResult {
  radicado?: string;
  despacho?: string;
  departamento?: string;
  ciudad?: string;
  tipo_proceso?: string;
  clase?: string;
  subclase?: string;
  fecha_radicacion?: string;
  fecha_ultimo_movimiento?: string;
  demandante?: string;
  demandado?: string;
  [key: string]: string | undefined;
}

export function BuscarProceso() {
  const [radicado, setRadicado] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<ProcesoResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async () => {
    if (!radicado.trim()) {
      toast.error("Ingrese un número de radicación");
      return;
    }

    setLoading(true);
    setError(null);
    setResults(null);

    try {
      const response = await fetch(`${API_BASE_URL}/buscar`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ radicado: radicado.trim() }),
      });

      if (!response.ok) {
        throw new Error(`Error ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      
      // Handle different response formats
      if (Array.isArray(data)) {
        setResults(data);
      } else if (data.procesos && Array.isArray(data.procesos)) {
        setResults(data.procesos);
      } else if (data.resultado) {
        setResults(Array.isArray(data.resultado) ? data.resultado : [data.resultado]);
      } else {
        setResults([data]);
      }

      if (results?.length === 0) {
        toast.info("No se encontraron resultados");
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Error al buscar proceso";
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSearch();
    }
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Search className="h-5 w-5" />
          Buscar Proceso Judicial
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Search Input */}
        <div className="flex gap-2">
          <Input
            placeholder="Ingrese número de radicación..."
            value={radicado}
            onChange={(e) => setRadicado(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
            className="flex-1"
          />
          <Button onClick={handleSearch} disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Buscando...
              </>
            ) : (
              <>
                <Search className="mr-2 h-4 w-4" />
                Buscar
              </>
            )}
          </Button>
        </div>

        {/* Error State */}
        {error && (
          <div className="flex items-center gap-2 p-4 rounded-md bg-destructive/10 text-destructive">
            <AlertCircle className="h-5 w-5" />
            <span>{error}</span>
          </div>
        )}

        {/* Results */}
        {results && results.length > 0 && (
          <div className="mt-4">
            <h3 className="text-lg font-semibold mb-3">
              Resultados ({results.length})
            </h3>
            
            {/* Mobile: Cards */}
            <div className="block md:hidden space-y-3">
              {results.map((proceso, index) => (
                <Card key={index} className="bg-muted/50">
                  <CardContent className="pt-4 space-y-2">
                    {proceso.radicado && (
                      <div>
                        <span className="font-medium text-muted-foreground">Radicado:</span>{" "}
                        <span className="font-mono">{proceso.radicado}</span>
                      </div>
                    )}
                    {proceso.despacho && (
                      <div>
                        <span className="font-medium text-muted-foreground">Despacho:</span>{" "}
                        {proceso.despacho}
                      </div>
                    )}
                    {proceso.tipo_proceso && (
                      <div>
                        <span className="font-medium text-muted-foreground">Tipo:</span>{" "}
                        {proceso.tipo_proceso}
                      </div>
                    )}
                    {proceso.demandante && (
                      <div>
                        <span className="font-medium text-muted-foreground">Demandante:</span>{" "}
                        {proceso.demandante}
                      </div>
                    )}
                    {proceso.demandado && (
                      <div>
                        <span className="font-medium text-muted-foreground">Demandado:</span>{" "}
                        {proceso.demandado}
                      </div>
                    )}
                    {proceso.fecha_radicacion && (
                      <div>
                        <span className="font-medium text-muted-foreground">Fecha:</span>{" "}
                        {proceso.fecha_radicacion}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Desktop: Table */}
            <div className="hidden md:block overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Radicado</TableHead>
                    <TableHead>Despacho</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Demandante</TableHead>
                    <TableHead>Demandado</TableHead>
                    <TableHead>Fecha</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results.map((proceso, index) => (
                    <TableRow key={index}>
                      <TableCell className="font-mono">
                        {proceso.radicado || "-"}
                      </TableCell>
                      <TableCell>{proceso.despacho || "-"}</TableCell>
                      <TableCell>{proceso.tipo_proceso || "-"}</TableCell>
                      <TableCell>{proceso.demandante || "-"}</TableCell>
                      <TableCell>{proceso.demandado || "-"}</TableCell>
                      <TableCell>{proceso.fecha_radicacion || "-"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        {/* Empty State */}
        {results && results.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            No se encontraron resultados para esta búsqueda
          </div>
        )}
      </CardContent>
    </Card>
  );
}
