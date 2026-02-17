import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Search, MapPin, ExternalLink } from "lucide-react";
import { fetchApiColombia } from "@/lib/api-colombia";

interface ColombiaMap {
  id: number;
  name: string;
  description: string;
  departmentId: number | null;
  urlImages: string[];
  urlSource: string;
  department: unknown;
}

async function fetchMaps(): Promise<ColombiaMap[]> {
  return fetchApiColombia<ColombiaMap[]>("/api/v1/Map");
}

export function ColombiaMaps() {
  const [search, setSearch] = useState("");
  const [selectedMap, setSelectedMap] = useState<ColombiaMap | null>(null);

  const { data: maps, isLoading, error } = useQuery({
    queryKey: ["colombia-maps"],
    queryFn: fetchMaps,
    staleTime: 1000 * 60 * 30,
  });

  const filtered = maps
    ?.filter((m) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return m.name.toLowerCase().includes(q) || m.description.toLowerCase().includes(q);
    })
    .sort((a, b) => a.id - b.id);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Mapas de Colombia</CardTitle>
          </div>
          <CardDescription>
            Mapas oficiales del IGAC y otras fuentes. Fuente: api-colombia.com
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por nombre o descripción..."
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
          <span className="ml-2 text-muted-foreground">Cargando mapas…</span>
        </div>
      )}

      {error && (
        <Card className="border-destructive">
          <CardContent className="pt-6 text-destructive text-sm">
            Error al cargar los mapas. Intenta de nuevo más tarde.
          </CardContent>
        </Card>
      )}

      {selectedMap && (
        <Card className="border-primary">
          <CardContent className="pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-base">{selectedMap.name}</h3>
              <button
                onClick={() => setSelectedMap(null)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Cerrar ✕
              </button>
            </div>
            {selectedMap.urlImages?.[0] && (
              <img
                src={selectedMap.urlImages[0]}
                alt={selectedMap.name}
                className="w-full max-h-[70vh] object-contain rounded-md border bg-muted"
              />
            )}
            <p className="text-sm text-muted-foreground">{selectedMap.description}</p>
            <a
              href={selectedMap.urlSource}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              Ver fuente original <ExternalLink className="h-3 w-3" />
            </a>
          </CardContent>
        </Card>
      )}

      {filtered && !selectedMap && (
        <ScrollArea className="h-[60vh]">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pr-4">
            {filtered.map((m) => (
              <Card
                key={m.id}
                className="cursor-pointer transition-all hover:shadow-md hover:border-primary/50"
                onClick={() => setSelectedMap(m)}
              >
                {m.urlImages?.[0] && (
                  <div className="aspect-[4/3] overflow-hidden rounded-t-lg bg-muted">
                    <img
                      src={m.urlImages[0]}
                      alt={m.name}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  </div>
                )}
                <CardHeader className="pb-2 pt-3 px-4">
                  <CardTitle className="text-sm leading-tight">{m.name}</CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <p className="text-xs text-muted-foreground line-clamp-2">{m.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
