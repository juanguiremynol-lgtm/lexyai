/**
 * CourthouseEmailDisplay - Shows resolved courthouse email with review/override UI
 * 
 * States:
 * - Verified: auto-resolved, needs_review=false → green badge + email
 * - Needs Review: shows top candidates for user selection
 * - Not Found: no match in directory
 * - Not Resolved: hasn't been run yet
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  Mail,
  CheckCircle2,
  AlertTriangle,
  Search,
  Copy,
  Loader2,
  RefreshCw,
  XCircle,
  Building2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { WorkItem } from "@/types/work-item";

interface CourthouseEmailDisplayProps {
  workItem: WorkItem & {
    courthouse_directory_id?: number | null;
    resolved_email?: string | null;
    resolution_method?: string | null;
    resolution_confidence?: number | null;
    courthouse_needs_review?: boolean | null;
    resolved_at?: string | null;
    raw_courthouse_input?: Record<string, unknown> | null;
  };
}

interface Candidate {
  id: number;
  email: string;
  name: string;
  dept: string;
  city: string;
  specialty: string;
  score: number;
}

export function CourthouseEmailDisplay({ workItem }: CourthouseEmailDisplayProps) {
  const queryClient = useQueryClient();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const resolvedEmail = workItem.resolved_email || (workItem as any).resolved_email;
  const needsReview = workItem.courthouse_needs_review || (workItem as any).courthouse_needs_review;
  const method = workItem.resolution_method || (workItem as any).resolution_method;
  const confidence = workItem.resolution_confidence || (workItem as any).resolution_confidence;
  const rawInput = (workItem.raw_courthouse_input || (workItem as any).raw_courthouse_input) as Record<string, unknown> | null;
  const candidates = (rawInput?._candidates || []) as Candidate[];

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

  // ─── Not yet resolved ───
  if (!method) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Mail className="h-4 w-4" />
              <span className="text-sm">Email del despacho no resuelto</span>
            </div>
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
          </div>
        </CardContent>
      </Card>
    );
  }

  // ─── Not found ───
  if (method === "not_found") {
    return (
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
    );
  }

  // ─── Needs review ───
  if (needsReview) {
    return (
      <Card className="border-amber-300 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            Email del despacho requiere revisión
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Se encontraron múltiples despachos posibles. Confirma el correcto.
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
      </Card>
    );
  }

  // ─── Verified / Resolved ───
  return (
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
                  {method === "exact_code" ? "Código exacto" :
                   method === "exact_name" ? "Nombre exacto" :
                   method === "manual_override" ? "Manual" :
                   method === "alias" ? "Alias" :
                   "Resuelto"}
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
    </Card>
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
