import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Search, Building } from "lucide-react";

interface Department {
  id: number;
  name: string;
  description: string;
  cityCapitalId: number;
  municipalities: number;
  surface: number;
  population: number;
  phonePrefix: string;
  countryId: number;
  cityCapital?: { name?: string } | null;
  country?: { name?: string } | null;
  regionId?: number;
  region?: { name?: string } | null;
  naturalAreas?: unknown[];
  maps?: unknown[];
}

async function fetchDepartments(): Promise<Department[]> {
  const res = await fetch("https://api-colombia.com/api/v1/Department");
  if (!res.ok) throw new Error("Error al consultar la API");
  return res.json();
}

export function ColombiaDepartments() {
  const [search, setSearch] = useState("");

  const { data: departments, isLoading, error } = useQuery({
    queryKey: ["colombia-departments"],
    queryFn: fetchDepartments,
    staleTime: 1000 * 60 * 30,
  });

  const filtered = departments
    ?.filter((d) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        d.name?.toLowerCase().includes(q) ||
        d.description?.toLowerCase().includes(q) ||
        d.cityCapital?.name?.toLowerCase().includes(q) ||
        d.region?.name?.toLowerCase().includes(q) ||
        d.phonePrefix?.includes(q)
      );
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const fmt = (n: number) => n?.toLocaleString("es-CO") ?? "—";

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Building className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Departamentos de Colombia</CardTitle>
          </div>
          <CardDescription>
            Información geográfica y demográfica de los 32 departamentos. Fuente: api-colombia.com
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por nombre, capital o región..."
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
          <span className="ml-2 text-muted-foreground">Cargando departamentos…</span>
        </div>
      )}

      {error && (
        <Card className="border-destructive">
          <CardContent className="pt-6 text-destructive text-sm">
            Error al cargar los departamentos. Intenta de nuevo más tarde.
          </CardContent>
        </Card>
      )}

      {filtered && (
        <div className="text-sm text-muted-foreground">
          {filtered.length} departamento{filtered.length !== 1 ? "s" : ""} encontrado{filtered.length !== 1 ? "s" : ""}
        </div>
      )}

      <ScrollArea className="h-[60vh]">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 pr-4">
          {filtered?.map((dept) => (
            <Card key={dept.id} className="transition-colors hover:border-primary/30">
              <CardHeader className="pb-2 pt-4 px-4">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-sm leading-tight">{dept.name}</CardTitle>
                  {dept.phonePrefix && (
                    <Badge variant="secondary" className="font-mono shrink-0 text-xs">
                      +{dept.phonePrefix}
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-2">
                <div className="flex flex-wrap gap-1.5">
                  {dept.cityCapital?.name && (
                    <Badge variant="outline" className="text-xs">Capital: {dept.cityCapital.name}</Badge>
                  )}
                  {dept.region?.name && (
                    <Badge variant="outline" className="text-xs">{dept.region.name}</Badge>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>Población: {fmt(dept.population)}</span>
                  <span>Superficie: {fmt(dept.surface)} km²</span>
                  <span>Municipios: {dept.municipalities}</span>
                </div>
                {dept.description && (
                  <p className="text-xs text-muted-foreground line-clamp-2">{dept.description}</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
