/**
 * CourthouseEmailDisplay - Shows resolved courthouse email with review/override UI
 * 
 * States:
 * - Verified: auto-resolved, needs_review=false → green badge + email
 * - Needs Review: shows top candidates for user selection
 * - Not Found: no match in directory
 * - Not Available: hasn't been run yet — shows action buttons
 * 
 * Only visible for judicial workflow types (CGP, LABORAL, CPACA, TUTELA, PENAL_906)
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Mail,
  CheckCircle2,
  AlertTriangle,
  Search,
  Copy,
  Loader2,
  RefreshCw,
  XCircle,
  Building2,
  Plus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { WorkItem } from "@/types/work-item";

// Judicial workflow types that should show courthouse resolution
const JUDICIAL_TYPES = new Set(["CGP", "LABORAL", "CPACA", "TUTELA", "PENAL_906"]);

interface CourthouseEmailDisplayProps {
  workItem: WorkItem & {
    courthouse_directory_id?: number | null;
    resolved_email?: string | null;
    resolution_method?: string | null;
    resolution_confidence?: number | null;
    courthouse_needs_review?: boolean | null;
    resolution_candidates?: CandidateRecord[] | null;
    resolved_at?: string | null;
    raw_courthouse_input?: Record<string, unknown> | null;
  };
}

interface CandidateRecord {
  id: number;
  email: string;
  nombre_despacho: string;
  ciudad: string;
  departamento: string;
  specialty: string;
  tipo_cuenta: string;
  similarity_score: number;
}

// Normalize CandidateRecord to internal Candidate shape
interface Candidate {
  id: number;
  email: string;
  name: string;
  dept: string;
  city: string;
  specialty: string;
  score: number;
}

function toCandidates(records: CandidateRecord[] | null | undefined): Candidate[] {
  if (!records || !Array.isArray(records)) return [];
  return records.map((r) => ({
    id: r.id,
    email: r.email,
    name: r.nombre_despacho,
    dept: r.departamento,
    city: r.ciudad,
    specialty: r.specialty,
    score: r.similarity_score,
  }));
}

export function CourthouseEmailDisplay({ workItem }: CourthouseEmailDisplayProps) {
  const queryClient = useQueryClient();
  const [searchOpen, setSearchOpen] = useState(false);
  const [addDataOpen, setAddDataOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const resolvedEmail = workItem.resolved_email || (workItem as any).resolved_email;
  const needsReview = workItem.courthouse_needs_review || (workItem as any).courthouse_needs_review;
  const method = workItem.resolution_method || (workItem as any).resolution_method;
  const confidence = workItem.resolution_confidence || (workItem as any).resolution_confidence;

  // Use resolution_candidates column (new), fallback to raw_courthouse_input._candidates (legacy)
  const rawInput = (workItem.raw_courthouse_input || (workItem as any).raw_courthouse_input) as Record<string, unknown> | null;
  const candidatesFromColumn = workItem.resolution_candidates;
  const candidatesFromLegacy = (rawInput?._candidates || []) as CandidateRecord[];
  const candidates = toCandidates(candidatesFromColumn || candidatesFromLegacy);

  // Trigger resolution
  const resolveMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("resolve-courthouse-email", {
        body: { work_item_id: workItem.id },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      if (data?.needs_review) {
        toast.info("Se encontraron candidatos. Por favor revisa y confirma.");
      } else if (data?.method === "not_found") {
        toast.warning("No se encontró un despacho coincidente en el directorio.");
      } else {
        toast.success("Email del despacho resuelto automáticamente.");
      }
      queryClient.invalidateQueries({ queryKey: ["work-item-detail", workItem.id] });
    },
    onError: (err: Error) => {
      toast.error("Error al resolver: " + err.message);
    },
  });

  // Manual override
  const overrideMutation = useMutation({
    mutationFn: async (candidate: Candidate) => {
      const { error } = await supabase
        .from("work_items")
        .update({
          courthouse_directory_id: candidate.id,
          resolved_email: candidate.email,
          resolution_method: "manual_override",
          resolution_confidence: 1.0,
          courthouse_needs_review: false,
          authority_email: candidate.email,
          resolved_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", workItem.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Despacho confirmado manualmente.");
      setSearchOpen(false);
      queryClient.invalidateQueries({ queryKey: ["work-item-detail", workItem.id] });
    },
    onError: (err: Error) => {
      toast.error("Error: " + err.message);
    },
  });

  // Save courthouse data and resolve
  const saveAndResolveMutation = useMutation({
    mutationFn: async (courtData: { name: string; city: string; department: string; court_class: string; specialty: string }) => {
      // First update work_items with the manual data
      await supabase
        .from("work_items")
        .update({
          authority_name: courtData.name || undefined,
          authority_city: courtData.city || undefined,
          authority_department: courtData.department || undefined,
          raw_courthouse_input: {
            name: courtData.name,
            city: courtData.city,
            department: courtData.department,
            court_class: courtData.court_class,
            specialty: courtData.specialty,
          },
          updated_at: new Date().toISOString(),
        })
        .eq("id", workItem.id);

      // Then invoke resolver with overrides
      const { data, error } = await supabase.functions.invoke("resolve-courthouse-email", {
        body: {
          work_item_id: workItem.id,
          courthouse_name: courtData.name,
          city: courtData.city,
          department: courtData.department,
          court_class: courtData.court_class,
          specialty: courtData.specialty,
        },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      setAddDataOpen(false);
      if (data?.needs_review) {
        toast.info("Se encontraron candidatos. Por favor revisa y confirma.");
      } else if (data?.method === "not_found") {
        toast.warning("No se encontró coincidencia en el directorio.");
      } else {
        toast.success("Email del despacho resuelto.");
      }
      queryClient.invalidateQueries({ queryKey: ["work-item-detail", workItem.id] });
    },
    onError: (err: Error) => {
      toast.error("Error: " + err.message);
    },
  });

  // Directory search
  const { data: searchResults, isFetching: isSearching } = useQuery({
    queryKey: ["courthouse-search", searchQuery],
    queryFn: async () => {
      if (!searchQuery || searchQuery.length < 3) return [];
      const { data } = await supabase
        .from("courthouse_directory")
        .select("id, email, nombre_raw, dept_norm, city_norm, specialty_norm")
        .or(`name_norm_soft.ilike.%${searchQuery.toLowerCase()}%,nombre_raw.ilike.%${searchQuery}%`)
        .limit(10);
      return (data || []).map((r) => ({
        id: r.id,
        email: r.email,
        name: r.nombre_raw,
        dept: r.dept_norm,
        city: r.city_norm,
        specialty: r.specialty_norm,
        score: 0,
      }));
    },
    enabled: searchQuery.length >= 3,
  });

  const copyEmail = (email: string) => {
    navigator.clipboard.writeText(email);
    toast.success("Email copiado");
  };

  // Only show for judicial workflow types (after all hooks)
  if (!JUDICIAL_TYPES.has(workItem.workflow_type)) {
    return null;
  }

  // ─── Not yet resolved (Not Available) ───
  if (!method) {
    return (
      <>
        <Card className="border-dashed">
          <CardContent className="py-4">
            <div className="flex items-center gap-2 mb-3">
              <Mail className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Email del Despacho</span>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              No disponible — Agregue el número de radicado o los datos del despacho para resolver el email automáticamente.
            </p>
            <div className="flex gap-2 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                className="gap-1"
                onClick={() => setAddDataOpen(true)}
              >
                <Plus className="h-3 w-3" />
                Agregar datos del despacho
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-1"
                onClick={() => resolveMutation.mutate()}
                disabled={resolveMutation.isPending}
              >
                {resolveMutation.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Search className="h-3 w-3" />
                )}
                Resolver email
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="gap-1"
                onClick={() => setSearchOpen(true)}
              >
                <Search className="h-3 w-3" />
                Buscar en directorio
              </Button>
            </div>
          </CardContent>
        </Card>
        <AddCourthouseDataDialog
          open={addDataOpen}
          onOpenChange={setAddDataOpen}
          onSave={(data) => saveAndResolveMutation.mutate(data)}
          isPending={saveAndResolveMutation.isPending}
          defaultValues={{
            name: workItem.authority_name || "",
            city: workItem.authority_city || "",
            department: workItem.authority_department || "",
          }}
        />
        <SearchDialog
          open={searchOpen}
          onOpenChange={setSearchOpen}
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
          results={searchResults || []}
          isSearching={isSearching}
          onSelect={(c) => overrideMutation.mutate(c)}
          isPending={overrideMutation.isPending}
        />
      </>
    );
  }

  // ─── Not found ───
  if (method === "not_found") {
    return (
      <>
        <Card className="border-dashed border-amber-300 dark:border-amber-800">
          <CardContent className="py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
                <XCircle className="h-4 w-4" />
                <span className="text-sm">No se encontró el despacho en el directorio</span>
              </div>
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  onClick={() => setAddDataOpen(true)}
                >
                  <Plus className="h-3 w-3" />
                  Agregar datos
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  onClick={() => setSearchOpen(true)}
                >
                  <Search className="h-3 w-3" />
                  Buscar
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1"
                  onClick={() => resolveMutation.mutate()}
                  disabled={resolveMutation.isPending}
                >
                  <RefreshCw className="h-3 w-3" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
        <AddCourthouseDataDialog
          open={addDataOpen}
          onOpenChange={setAddDataOpen}
          onSave={(data) => saveAndResolveMutation.mutate(data)}
          isPending={saveAndResolveMutation.isPending}
          defaultValues={{
            name: workItem.authority_name || "",
            city: workItem.authority_city || "",
            department: workItem.authority_department || "",
          }}
        />
        <SearchDialog
          open={searchOpen}
          onOpenChange={setSearchOpen}
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
          results={searchResults || []}
          isSearching={isSearching}
          onSelect={(c) => overrideMutation.mutate(c)}
          isPending={overrideMutation.isPending}
        />
      </>
    );
  }

  // ─── Needs review ───
  if (needsReview) {
    return (
      <>
        <Card className="border-amber-300 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Email del Despacho — Requiere revisión
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Se encontraron múltiples coincidencias — Seleccione el despacho correcto.
            </p>
            
            <div className="space-y-2">
              {candidates.map((c, i) => (
                <div
                  key={c.id}
                  className={cn(
                    "flex items-center justify-between p-2 rounded-lg border text-sm",
                    i === 0 ? "border-primary/50 bg-primary/5" : "border-muted"
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{c.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {c.city}, {c.dept} • {c.specialty}
                    </p>
                    <p className="text-xs font-mono text-primary">{c.email}</p>
                  </div>
                  <div className="flex items-center gap-2 ml-2 shrink-0">
                    <Badge variant="outline" className="text-[10px]">
                      {Math.round(c.score * 100)}%
                    </Badge>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => overrideMutation.mutate(c)}
                      disabled={overrideMutation.isPending}
                    >
                      Confirmar
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            <Button
              variant="ghost"
              size="sm"
              className="text-xs gap-1"
              onClick={() => setSearchOpen(true)}
            >
              <Search className="h-3 w-3" />
              Buscar en directorio
            </Button>
          </CardContent>
        </Card>

        <SearchDialog
          open={searchOpen}
          onOpenChange={setSearchOpen}
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
          results={searchResults || []}
          isSearching={isSearching}
          onSelect={(c) => overrideMutation.mutate(c)}
          isPending={overrideMutation.isPending}
        />
      </>
    );
  }

  // ─── Verified / Resolved ───
  const methodLabel =
    method === "auto_code" ? "Código exacto" :
    method === "auto_fuzzy" ? "Resolución automática" :
    method === "exact_code" ? "Código exacto" :
    method === "exact_name" ? "Nombre exacto" :
    method === "manual_override" ? "Selección manual" :
    method === "alias" ? "Alias" :
    "Resuelto";

  return (
    <>
      <Card className="border-emerald-200 dark:border-emerald-800/50 bg-emerald-50/30 dark:bg-emerald-950/10">
        <CardContent className="py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate font-mono">{resolvedEmail}</span>
                  <button
                    onClick={() => copyEmail(resolvedEmail!)}
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                    title="Copiar email"
                  >
                    <Copy className="h-3 w-3" />
                  </button>
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <Badge variant="outline" className="text-[10px] border-emerald-500/50 text-emerald-600">
                    ✓ Verificado — {methodLabel}
                  </Badge>
                  {confidence !== null && confidence !== undefined && (
                    <span className="text-[10px] text-muted-foreground">
                      {Math.round((confidence as number) * 100)}% confianza
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex gap-1 shrink-0">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={() => setSearchOpen(true)}
              >
                <Building2 className="h-3 w-3" />
                Cambiar
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => resolveMutation.mutate()}
                disabled={resolveMutation.isPending}
                title="Re-resolver"
              >
                {resolveMutation.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <RefreshCw className="h-3 w-3" />
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <SearchDialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        results={searchResults || []}
        isSearching={isSearching}
        onSelect={(c) => overrideMutation.mutate(c)}
        isPending={overrideMutation.isPending}
      />
    </>
  );
}

// ─── Add Courthouse Data Dialog ───
function AddCourthouseDataDialog({
  open,
  onOpenChange,
  onSave,
  isPending,
  defaultValues,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSave: (data: { name: string; city: string; department: string; court_class: string; specialty: string }) => void;
  isPending: boolean;
  defaultValues: { name: string; city: string; department: string };
}) {
  const [name, setName] = useState(defaultValues.name);
  const [city, setCity] = useState(defaultValues.city);
  const [department, setDepartment] = useState(defaultValues.department);
  const [courtClass, setCourtClass] = useState("");
  const [specialty, setSpecialty] = useState("");

  const handleSave = () => {
    if (!name.trim()) {
      toast.error("El nombre del despacho es requerido");
      return;
    }
    onSave({ name, city, department, court_class: courtClass, specialty });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Agregar datos del despacho
          </DialogTitle>
          <DialogDescription>
            Ingrese los datos del juzgado o despacho para resolver el email automáticamente.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Nombre del despacho *</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: Juzgado 3° Civil del Circuito"
              autoFocus
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Ciudad</Label>
              <Input
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="Ej: Medellín"
              />
            </div>
            <div className="space-y-2">
              <Label>Departamento</Label>
              <Input
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                placeholder="Ej: Antioquia"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Clase</Label>
              <Select value={courtClass} onValueChange={setCourtClass}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="juzgado">Juzgado</SelectItem>
                  <SelectItem value="tribunal">Tribunal</SelectItem>
                  <SelectItem value="sala">Sala</SelectItem>
                  <SelectItem value="otro">Otro</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Especialidad</Label>
              <Select value={specialty} onValueChange={setSpecialty}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="civil">Civil</SelectItem>
                  <SelectItem value="penal">Penal</SelectItem>
                  <SelectItem value="laboral">Laboral</SelectItem>
                  <SelectItem value="administrativo">Administrativo</SelectItem>
                  <SelectItem value="familia">Familia</SelectItem>
                  <SelectItem value="promiscuo">Promiscuo</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={isPending}>
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Resolviendo...
              </>
            ) : (
              "Guardar y resolver"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Search Dialog ───
function SearchDialog({
  open,
  onOpenChange,
  searchQuery,
  onSearchQueryChange,
  results,
  isSearching,
  onSelect,
  isPending,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  searchQuery: string;
  onSearchQueryChange: (v: string) => void;
  results: Candidate[];
  isSearching: boolean;
  onSelect: (c: Candidate) => void;
  isPending: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Buscar en Directorio de Despachos</DialogTitle>
          <DialogDescription>
            Escribe el nombre del juzgado o despacho para buscar su email.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Input
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            placeholder="Ej: Juzgado 01 Civil Municipal Bogotá..."
            autoFocus
          />
          {isSearching && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Buscando...
            </div>
          )}
          {results.length > 0 && (
            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {results.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between p-2 rounded border text-sm hover:bg-muted/50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{r.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {r.city}, {r.dept}
                    </p>
                    <p className="text-xs font-mono text-primary">{r.email}</p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs ml-2 shrink-0"
                    onClick={() => onSelect(r)}
                    disabled={isPending}
                  >
                    Seleccionar
                  </Button>
                </div>
              ))}
            </div>
          )}
          {searchQuery.length >= 3 && !isSearching && results.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">
              No se encontraron resultados
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
