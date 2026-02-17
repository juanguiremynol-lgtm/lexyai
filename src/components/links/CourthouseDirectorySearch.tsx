/**
 * CourthouseDirectorySearch — searchable, filterable courthouse email directory
 * powered by the courthouse_directory table (7,900+ records).
 */

import { useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
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
import { Search, Mail, Copy, Check, Filter, X, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";

const PAGE_SIZE = 25;

const COURT_CLASS_LABELS: Record<string, string> = {
  juzgado: "Juzgado",
  tribunal_superior: "Tribunal Superior",
  tribunal_administrativo: "Tribunal Administrativo",
  direccion_seccional: "Dirección Seccional",
  centro_servicios: "Centro de Servicios",
  consejo_seccional: "Consejo Seccional",
  comision_disciplina: "Comisión de Disciplina",
  otro: "Otro",
};

type DirectoryRow = {
  id: number;
  email: string;
  nombre_raw: string;
  departamento_raw: string;
  ciudad_raw: string;
  especialidad_area_raw: string;
  corporacion_area_raw: string;
  court_class: string;
  codigo_despacho_raw: string;
};

export function CourthouseDirectorySearch() {
  const [search, setSearch] = useState("");
  const [dept, setDept] = useState("__all__");
  const [city, setCity] = useState("__all__");
  const [specialty, setSpecialty] = useState("__all__");
  const [courtClass, setCourtClass] = useState("__all__");
  const [page, setPage] = useState(0);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  // Fetch all records (cached aggressively — static data)
  const { data: allRecords, isLoading } = useQuery({
    queryKey: ["courthouse-directory-all"],
    queryFn: async () => {
      const results: DirectoryRow[] = [];
      let from = 0;
      const batchSize = 1000;
      while (true) {
        const { data, error } = await supabase
          .from("courthouse_directory")
          .select("id, email, nombre_raw, departamento_raw, ciudad_raw, especialidad_area_raw, corporacion_area_raw, court_class, codigo_despacho_raw")
          .order("departamento_raw")
          .order("ciudad_raw")
          .order("nombre_raw")
          .range(from, from + batchSize - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        results.push(...(data as DirectoryRow[]));
        if (data.length < batchSize) break;
        from += batchSize;
      }
      return results;
    },
    staleTime: 1000 * 60 * 60, // 1 hour
    gcTime: 1000 * 60 * 60 * 2,
  });

  // Derive filter options
  const departments = useMemo(() => {
    if (!allRecords) return [];
    return [...new Set(allRecords.map((r) => r.departamento_raw))].sort();
  }, [allRecords]);

  const cities = useMemo(() => {
    if (!allRecords) return [];
    const filtered = dept !== "__all__" ? allRecords.filter((r) => r.departamento_raw === dept) : allRecords;
    return [...new Set(filtered.map((r) => r.ciudad_raw))].sort();
  }, [allRecords, dept]);

  const specialties = useMemo(() => {
    if (!allRecords) return [];
    return [...new Set(allRecords.map((r) => r.especialidad_area_raw).filter(Boolean))].sort();
  }, [allRecords]);

  // Filter + search
  const filtered = useMemo(() => {
    if (!allRecords) return [];
    const q = search.toLowerCase().trim();
    return allRecords.filter((r) => {
      if (dept !== "__all__" && r.departamento_raw !== dept) return false;
      if (city !== "__all__" && r.ciudad_raw !== city) return false;
      if (specialty !== "__all__" && r.especialidad_area_raw !== specialty) return false;
      if (courtClass !== "__all__" && r.court_class !== courtClass) return false;
      if (q) {
        const haystack = `${r.nombre_raw} ${r.email} ${r.ciudad_raw} ${r.departamento_raw} ${r.codigo_despacho_raw}`.toLowerCase();
        return haystack.includes(q);
      }
      return true;
    });
  }, [allRecords, search, dept, city, specialty, courtClass]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const handleCopy = useCallback((email: string, id: number) => {
    navigator.clipboard.writeText(email);
    setCopiedId(id);
    toast.success("Email copiado");
    setTimeout(() => setCopiedId(null), 2000);
  }, []);

  const clearFilters = () => {
    setSearch("");
    setDept("__all__");
    setCity("__all__");
    setSpecialty("__all__");
    setCourtClass("__all__");
    setPage(0);
  };

  const hasFilters = search || dept !== "__all__" || city !== "__all__" || specialty !== "__all__" || courtClass !== "__all__";

  // Reset page when filters change
  const updateFilter = (setter: (v: string) => void) => (v: string) => {
    setter(v);
    setPage(0);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm">Cargando directorio…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Search bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar por nombre, email, ciudad o código de despacho…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(0); }}
          className="pl-10 h-11"
        />
      </div>

      {/* Filters row */}
      <div className="flex flex-wrap items-center gap-2">
        <Filter className="h-4 w-4 text-muted-foreground shrink-0" />

        <Select value={dept} onValueChange={(v) => { updateFilter(setDept)(v); setCity("__all__"); }}>
          <SelectTrigger className="w-[180px] h-9 text-xs">
            <SelectValue placeholder="Departamento" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todos los departamentos</SelectItem>
            {departments.map((d) => (
              <SelectItem key={d} value={d}>{d}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={city} onValueChange={updateFilter(setCity)}>
          <SelectTrigger className="w-[180px] h-9 text-xs">
            <SelectValue placeholder="Ciudad" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todas las ciudades</SelectItem>
            {cities.map((c) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={specialty} onValueChange={updateFilter(setSpecialty)}>
          <SelectTrigger className="w-[180px] h-9 text-xs">
            <SelectValue placeholder="Especialidad" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todas las especialidades</SelectItem>
            {specialties.map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={courtClass} onValueChange={updateFilter(setCourtClass)}>
          <SelectTrigger className="w-[160px] h-9 text-xs">
            <SelectValue placeholder="Tipo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todos los tipos</SelectItem>
            {Object.entries(COURT_CLASS_LABELS).map(([k, label]) => (
              <SelectItem key={k} value={k}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters} className="h-9 text-xs gap-1">
            <X className="h-3 w-3" /> Limpiar
          </Button>
        )}
      </div>

      {/* Results summary */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {filtered.length.toLocaleString()} resultado{filtered.length !== 1 ? "s" : ""}
          {hasFilters && " (filtrado)"}
        </p>
        {totalPages > 1 && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" className="h-8 w-8" disabled={page === 0} onClick={() => setPage(page - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-xs text-muted-foreground tabular-nums">
              {page + 1} / {totalPages}
            </span>
            <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[280px]">Despacho</TableHead>
                <TableHead className="min-w-[120px]">Departamento</TableHead>
                <TableHead className="min-w-[120px]">Ciudad</TableHead>
                <TableHead className="min-w-[120px]">Especialidad</TableHead>
                <TableHead className="min-w-[250px]">Email</TableHead>
                <TableHead className="w-[50px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {paged.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                    No se encontraron resultados. Intente con otros filtros.
                  </TableCell>
                </TableRow>
              ) : (
                paged.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <div className="space-y-1">
                        <p className="font-medium text-sm leading-tight">{r.nombre_raw}</p>
                        <div className="flex items-center gap-1.5">
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                            {COURT_CLASS_LABELS[r.court_class] || r.court_class}
                          </Badge>
                          {r.codigo_despacho_raw && (
                            <span className="text-[10px] text-muted-foreground font-mono">
                              {r.codigo_despacho_raw}
                            </span>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{r.departamento_raw}</TableCell>
                    <TableCell className="text-sm">{r.ciudad_raw}</TableCell>
                    <TableCell className="text-sm">{r.especialidad_area_raw}</TableCell>
                    <TableCell>
                      <a
                        href={`mailto:${r.email}`}
                        className="text-sm text-primary hover:underline flex items-center gap-1.5"
                      >
                        <Mail className="h-3.5 w-3.5 shrink-0" />
                        {r.email}
                      </a>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => handleCopy(r.email as string, r.id)}
                      >
                        {copiedId === r.id ? (
                          <Check className="h-4 w-4 text-primary" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Bottom pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-2">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)} className="gap-1">
            <ChevronLeft className="h-4 w-4" /> Anterior
          </Button>
          <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)} className="gap-1">
            Siguiente <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
