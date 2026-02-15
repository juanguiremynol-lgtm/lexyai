/**
 * ControlRadicadosManager — Super-admin panel to manage known-good radicados
 * per category for ghost verification control runs.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2, RefreshCw, Loader2, FlaskConical, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

const CATEGORIES = ["CGP", "LABORAL", "PENAL_906", "CPACA", "TUTELA"] as const;

interface ControlRadicado {
  id: string;
  category: string;
  radicado: string;
  dane_code: string | null;
  city: string | null;
  jurisdiction_hint: string | null;
  last_verified_at: string | null;
  last_verified_status: string | null;
  is_active: boolean;
  notes: string | null;
  created_at: string;
}

export function ControlRadicadosManager() {
  const queryClient = useQueryClient();
  const [newCategory, setNewCategory] = useState<string>("CGP");
  const [newRadicado, setNewRadicado] = useState("");
  const [newCity, setNewCity] = useState("");

  const { data: radicados, isLoading } = useQuery({
    queryKey: ["control-radicados"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("control_radicados")
        .select("*")
        .order("category", { ascending: true })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as ControlRadicado[];
    },
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      const cleaned = newRadicado.replace(/[^0-9]/g, "");
      if (cleaned.length !== 23) throw new Error("El radicado debe tener 23 dígitos");

      const { error } = await (supabase as any)
        .from("control_radicados")
        .insert({
          category: newCategory,
          radicado: cleaned,
          city: newCity || null,
          is_active: true,
        });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["control-radicados"] });
      setNewRadicado("");
      setNewCity("");
      toast.success("Radicado de control agregado");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from("control_radicados")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["control-radicados"] });
      toast.success("Eliminado");
    },
  });

  const verifyMutation = useMutation({
    mutationFn: async (rad: ControlRadicado) => {
      const { data, error } = await supabase.functions.invoke("sync-by-radicado", {
        body: {
          radicado: rad.radicado,
          workflow_type: rad.category,
          _scheduled: true,
          _ghost_verify_control: true,
        },
      });
      if (error) throw error;

      const status = data?.ok
        ? data.inserted_count > 0 || data.skipped_count > 0
          ? "FOUND_COMPLETE"
          : "FOUND_PARTIAL"
        : "NOT_FOUND";

      await (supabase as any)
        .from("control_radicados")
        .update({
          last_verified_at: new Date().toISOString(),
          last_verified_status: status,
        })
        .eq("id", rad.id);

      return status;
    },
    onSuccess: (status, rad) => {
      queryClient.invalidateQueries({ queryKey: ["control-radicados"] });
      toast.success(`Verificación: ${status} para ${rad.radicado}`);
    },
    onError: (e: Error) => toast.error(`Error: ${e.message}`),
  });

  const statusBadge = (status: string | null) => {
    if (!status) return <Badge variant="outline" className="text-xs">Sin verificar</Badge>;
    if (status === "FOUND_COMPLETE") return <Badge className="bg-emerald-500/10 text-emerald-600 text-xs gap-1"><CheckCircle2 className="h-3 w-3" />Completo</Badge>;
    if (status === "FOUND_PARTIAL") return <Badge className="bg-yellow-500/10 text-yellow-600 text-xs">Parcial</Badge>;
    return <Badge variant="destructive" className="text-xs gap-1"><XCircle className="h-3 w-3" />{status}</Badge>;
  };

  const grouped = CATEGORIES.reduce((acc, cat) => {
    acc[cat] = (radicados || []).filter((r) => r.category === cat);
    return acc;
  }, {} as Record<string, ControlRadicado[]>);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <FlaskConical className="h-4 w-4 text-primary" />
          Radicados de Control (Ghost Verification)
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Radicados de procesos conocidos usados como "control" para verificar que las rutas de sync funcionan antes de clasificar un item como fantasma.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Add new */}
        <div className="flex items-end gap-2 flex-wrap">
          <div>
            <label className="text-xs text-muted-foreground">Categoría</label>
            <Select value={newCategory} onValueChange={setNewCategory}>
              <SelectTrigger className="w-[140px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="text-xs text-muted-foreground">Radicado (23 dígitos)</label>
            <Input
              value={newRadicado}
              onChange={(e) => setNewRadicado(e.target.value)}
              placeholder="05001310500120230012300"
              className="h-8 text-xs font-mono"
            />
          </div>
          <div className="w-[120px]">
            <label className="text-xs text-muted-foreground">Ciudad</label>
            <Input
              value={newCity}
              onChange={(e) => setNewCity(e.target.value)}
              placeholder="Medellín"
              className="h-8 text-xs"
            />
          </div>
          <Button
            size="sm"
            className="h-8 gap-1"
            onClick={() => addMutation.mutate()}
            disabled={addMutation.isPending}
          >
            <Plus className="h-3 w-3" />
            Agregar
          </Button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-3">
            {CATEGORIES.map((cat) => {
              const items = grouped[cat];
              if (items.length === 0) return (
                <div key={cat} className="text-xs text-muted-foreground border rounded p-2">
                  <span className="font-medium">{cat}</span>: Sin radicados de control configurados
                </div>
              );
              return (
                <div key={cat}>
                  <Badge variant="outline" className="mb-1 text-xs">{cat} ({items.length})</Badge>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Radicado</TableHead>
                        <TableHead className="text-xs">Ciudad</TableHead>
                        <TableHead className="text-xs">Estado</TableHead>
                        <TableHead className="text-xs">Última verificación</TableHead>
                        <TableHead className="text-xs w-[100px]">Acciones</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell className="font-mono text-xs">{r.radicado}</TableCell>
                          <TableCell className="text-xs">{r.city || "—"}</TableCell>
                          <TableCell>{statusBadge(r.last_verified_status)}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {r.last_verified_at
                              ? formatDistanceToNow(new Date(r.last_verified_at), { addSuffix: true, locale: es })
                              : "Nunca"}
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                onClick={() => verifyMutation.mutate(r)}
                                disabled={verifyMutation.isPending}
                                title="Verificar ahora"
                              >
                                <RefreshCw className="h-3 w-3" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-destructive"
                                onClick={() => deleteMutation.mutate(r.id)}
                                disabled={deleteMutation.isPending}
                                title="Eliminar"
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
