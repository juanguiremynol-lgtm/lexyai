import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Search, Plane } from "lucide-react";
import { fetchApiColombia } from "@/lib/api-colombia";

interface Airport {
  id: number;
  name: string;
  iataCode: string;
  oaciCode: string;
  type: string;
  departmentId: number;
  cityId: number;
  city?: { name?: string } | null;
  department?: { name?: string } | null;
}

async function fetchAirports(): Promise<Airport[]> {
  return fetchApiColombia<Airport[]>("/api/v1/Airport");
}

export function ColombiaAirports() {
  const [search, setSearch] = useState("");

  const { data: airports, isLoading, error } = useQuery({
    queryKey: ["colombia-airports"],
    queryFn: fetchAirports,
    staleTime: 1000 * 60 * 30,
  });

  const filtered = airports
    ?.filter((a) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        a.name?.toLowerCase().includes(q) ||
        a.iataCode?.toLowerCase().includes(q) ||
        a.oaciCode?.toLowerCase().includes(q) ||
        a.type?.toLowerCase().includes(q) ||
        a.city?.name?.toLowerCase().includes(q) ||
        a.department?.name?.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Plane className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Aeropuertos de Colombia</CardTitle>
          </div>
          <CardDescription>
            Directorio de aeropuertos con códigos IATA/OACI. Fuente: api-colombia.com
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por nombre, código IATA, ciudad o departamento..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </CardContent>
      </Card>

      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-muted-foreground">Cargando aeropuertos…</span>
        </div>
      )}

      {error && (
        <Card className="border-destructive">
          <CardContent className="pt-6 text-destructive text-sm">
            Error al cargar los aeropuertos. Intenta de nuevo más tarde.
          </CardContent>
        </Card>
      )}

      {filtered && (
        <div className="text-sm text-muted-foreground">
          {filtered.length} aeropuerto{filtered.length !== 1 ? "s" : ""} encontrado{filtered.length !== 1 ? "s" : ""}
        </div>
      )}

      <ScrollArea className="h-[60vh]">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 pr-4">
          {filtered?.map((airport) => (
            <Card key={airport.id} className="transition-colors hover:border-primary/30">
              <CardHeader className="pb-2 pt-4 px-4">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-sm leading-tight">{airport.name}</CardTitle>
                  {airport.iataCode && (
                    <Badge variant="secondary" className="font-mono shrink-0">
                      {airport.iataCode}
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-1">
                <div className="flex flex-wrap gap-1.5">
                  {airport.oaciCode && (
                    <Badge variant="outline" className="text-xs">OACI: {airport.oaciCode}</Badge>
                  )}
                  {airport.type && (
                    <Badge variant="outline" className="text-xs">{airport.type}</Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {[airport.city?.name, airport.department?.name].filter(Boolean).join(", ") || "—"}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
