/**
 * HearingTypesTable — Platform admin CRUD table for hearing types
 */
import { useState } from "react";
import { useAllHearingTypes, JURISDICTION_LABELS, type HearingType } from "@/hooks/use-hearing-catalog";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Pencil, Trash2, AlertTriangle, Search } from "lucide-react";
import { HearingTypeEditModal } from "./HearingTypeEditModal";

export function HearingTypesTable() {
  const { data: types = [], isLoading } = useAllHearingTypes();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState("");
  const [jurisdictionFilter, setJurisdictionFilter] = useState<string>("all");
  const [editTarget, setEditTarget] = useState<HearingType | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<HearingType | null>(null);
  const [saving, setSaving] = useState(false);

  const filtered = types.filter(t => {
    if (jurisdictionFilter !== "all" && t.jurisdiction !== jurisdictionFilter) return false;
    if (filter) {
      const q = filter.toLowerCase();
      return t.name.toLowerCase().includes(q) || t.short_name.toLowerCase().includes(q) || t.legal_basis?.toLowerCase().includes(q);
    }
    return true;
  });

  const handleSave = async (data: any) => {
    setSaving(true);
    try {
      if (editTarget) {
        const { error } = await supabase.from("hearing_types").update(data).eq("id", editTarget.id);
        if (error) throw error;
        toast.success("Tipo actualizado");
      } else {
        const { error } = await supabase.from("hearing_types").insert(data);
        if (error) throw error;
        toast.success("Tipo creado");
      }
      queryClient.invalidateQueries({ queryKey: ["hearing-types-all"] });
      setEditTarget(null);
      setShowCreate(false);
    } catch (e: any) {
      toast.error(e.message || "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const { error } = await supabase.from("hearing_types").update({ is_active: false }).eq("id", deleteTarget.id);
    if (error) toast.error(error.message);
    else {
      toast.success("Tipo desactivado");
      queryClient.invalidateQueries({ queryKey: ["hearing-types-all"] });
    }
    setDeleteTarget(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
          <Input
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Buscar por nombre o base legal..."
            className="pl-9 bg-white/5 border-white/10 text-white"
          />
        </div>
        <Select value={jurisdictionFilter} onValueChange={setJurisdictionFilter}>
          <SelectTrigger className="w-[200px] bg-white/5 border-white/10 text-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las jurisdicciones</SelectItem>
            {Object.entries(JURISDICTION_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button onClick={() => setShowCreate(true)} className="bg-cyan-500 hover:bg-cyan-600 text-black">
          <Plus className="h-4 w-4 mr-1" /> Nuevo tipo
        </Button>
      </div>

      <div className="border border-white/10 rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-white/10 hover:bg-transparent">
              <TableHead className="text-white/50">Jurisdicción</TableHead>
              <TableHead className="text-white/50">Subtipo</TableHead>
              <TableHead className="text-white/50">Nombre</TableHead>
              <TableHead className="text-white/50">Base legal</TableHead>
              <TableHead className="text-white/50 text-center">Orden</TableHead>
              <TableHead className="text-white/50 text-center">Estado</TableHead>
              <TableHead className="text-white/50 text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={7} className="text-center text-white/40 py-8">Cargando...</TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center text-white/40 py-8">Sin resultados</TableCell></TableRow>
            ) : filtered.map(t => (
              <TableRow key={t.id} className="border-white/10 hover:bg-white/5">
                <TableCell>
                  <Badge variant="outline" className="border-white/20 text-white/70 text-xs">
                    {JURISDICTION_LABELS[t.jurisdiction] || t.jurisdiction}
                  </Badge>
                </TableCell>
                <TableCell className="text-white/60 text-sm">{t.process_subtype || "—"}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span className="text-white text-sm">{t.short_name}</span>
                    {t.needs_admin_review && (
                      <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-[10px]">
                        <AlertTriangle className="h-3 w-3 mr-1" /> Revisar
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-white/60 text-sm">{t.legal_basis || "—"}</TableCell>
                <TableCell className="text-center text-white/60 text-sm">{t.default_stage_order}</TableCell>
                <TableCell className="text-center">
                  <Badge className={t.is_active ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" : "bg-red-500/20 text-red-400 border-red-500/30"}>
                    {t.is_active ? "Activo" : "Inactivo"}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button variant="ghost" size="icon" onClick={() => setEditTarget(t)} className="text-white/40 hover:text-cyan-400 h-8 w-8">
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(t)} className="text-white/40 hover:text-red-400 h-8 w-8">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <HearingTypeEditModal
        open={showCreate || !!editTarget}
        onOpenChange={o => { if (!o) { setShowCreate(false); setEditTarget(null); } }}
        hearingType={editTarget}
        onSave={handleSave}
        saving={saving}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={o => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent className="bg-black border-white/10 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle>Desactivar tipo de audiencia</AlertDialogTitle>
            <AlertDialogDescription className="text-white/60">
              Se desactivará "{deleteTarget?.short_name}". No se eliminará de la base de datos pero dejará de aparecer en los flujos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-white/10 text-white/70">Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">Desactivar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
