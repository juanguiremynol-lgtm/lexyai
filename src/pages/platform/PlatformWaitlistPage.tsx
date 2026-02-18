/**
 * PlatformWaitlistPage — Super Admin management of waitlist_signups.
 * CRUD table: view all signups, add/edit/delete recipients, trigger manual notify.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Plus, Trash2, Send, RefreshCw, CheckCircle, Clock, Pencil, Loader2, Search,
} from "lucide-react";

interface WaitlistSignup {
  id: string;
  email: string;
  created_at: string;
  source_route: string | null;
  utm_source: string | null;
  utm_campaign: string | null;
  referrer: string | null;
  notified_at: string | null;
  launch_date_used: string | null;
}

export default function PlatformWaitlistPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [editItem, setEditItem] = useState<WaitlistSignup | null>(null);
  const [deleteItem, setDeleteItem] = useState<WaitlistSignup | null>(null);
  const [formEmail, setFormEmail] = useState("");
  const [triggeringNotify, setTriggeringNotify] = useState(false);

  // ── Fetch all signups ──
  const { data: signups = [], isLoading } = useQuery({
    queryKey: ["platform-waitlist", search],
    queryFn: async () => {
      let q = supabase
        .from("waitlist_signups")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);

      if (search) {
        q = q.ilike("email", `%${search}%`);
      }

      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as WaitlistSignup[];
    },
  });

  // ── Add signup ──
  const addMutation = useMutation({
    mutationFn: async (email: string) => {
      const { error } = await supabase.from("waitlist_signups").insert({
        email: email.trim().toLowerCase(),
        source_route: "/platform/waitlist",
      });
      if (error) {
        if (error.code === "23505") throw new Error("Este email ya está registrado.");
        throw error;
      }
    },
    onSuccess: () => {
      toast.success("Registro añadido a la lista de espera");
      qc.invalidateQueries({ queryKey: ["platform-waitlist"] });
      setAddOpen(false);
      setFormEmail("");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ── Edit signup email ──
  const editMutation = useMutation({
    mutationFn: async ({ id, email }: { id: string; email: string }) => {
      const { error } = await supabase
        .from("waitlist_signups")
        .update({ email: email.trim().toLowerCase(), notified_at: null, launch_date_used: null })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Email actualizado (se re-notificará al lanzamiento)");
      qc.invalidateQueries({ queryKey: ["platform-waitlist"] });
      setEditItem(null);
      setFormEmail("");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ── Delete signup ──
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("waitlist_signups").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Registro eliminado");
      qc.invalidateQueries({ queryKey: ["platform-waitlist"] });
      setDeleteItem(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ── Reset notification status (re-queue for notification) ──
  const resetMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("waitlist_signups")
        .update({ notified_at: null, launch_date_used: null })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Estado de notificación reseteado — será re-notificado");
      qc.invalidateQueries({ queryKey: ["platform-waitlist"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ── Manual trigger of notify-waitlist-launch ──
  const handleTriggerNotify = async () => {
    setTriggeringNotify(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("No session");

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/notify-waitlist-launch`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}),
        },
      );
      const json = await res.json();

      if (json.status === "prelaunch") {
        toast.info(`Aún en pre-lanzamiento. Lanzamiento: ${json.launchAt}`);
      } else if (json.notified != null) {
        toast.success(`Notificados: ${json.notified} registros (fecha: ${json.launchDate})`);
        qc.invalidateQueries({ queryKey: ["platform-waitlist"] });
      } else {
        toast.info(json.message || "Sin registros pendientes");
      }
    } catch (err: any) {
      toast.error(`Error: ${err.message}`);
    } finally {
      setTriggeringNotify(false);
    }
  };

  const notifiedCount = signups.filter((s) => s.notified_at).length;
  const pendingCount = signups.length - notifiedCount;

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Total registros", value: signups.length, color: "text-white" },
          { label: "Notificados", value: notifiedCount, color: "text-emerald-400" },
          { label: "Pendientes", value: pendingCount, color: "text-amber-400" },
        ].map((s) => (
          <div key={s.label} className="border border-white/10 rounded p-4 bg-white/5">
            <p className="text-xs text-white/40 uppercase tracking-wider font-mono">{s.label}</p>
            <p className={`text-2xl font-bold font-mono ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
          <Input
            placeholder="Buscar por email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-white/5 border-white/10 text-white placeholder:text-white/30"
          />
        </div>
        <Button variant="outline" size="sm" className="border-white/20 text-white/70 hover:text-white" onClick={() => { setFormEmail(""); setAddOpen(true); }}>
          <Plus className="h-4 w-4 mr-1.5" /> Añadir
        </Button>
        <Button variant="outline" size="sm" className="border-cyan-400/30 text-cyan-400 hover:bg-cyan-400/10" onClick={handleTriggerNotify} disabled={triggeringNotify}>
          {triggeringNotify ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Send className="h-4 w-4 mr-1.5" />}
          Disparar notificación ahora
        </Button>
        <Button variant="ghost" size="sm" className="text-white/40" onClick={() => qc.invalidateQueries({ queryKey: ["platform-waitlist"] })}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* Table */}
      <div className="border border-white/10 rounded overflow-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-white/10 hover:bg-transparent">
              <TableHead className="text-white/40 font-mono text-xs">Email</TableHead>
              <TableHead className="text-white/40 font-mono text-xs">Registrado</TableHead>
              <TableHead className="text-white/40 font-mono text-xs">Fuente</TableHead>
              <TableHead className="text-white/40 font-mono text-xs">UTM</TableHead>
              <TableHead className="text-white/40 font-mono text-xs">Estado</TableHead>
              <TableHead className="text-white/40 font-mono text-xs text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="text-center text-white/30 py-8"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></TableCell></TableRow>
            ) : signups.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center text-white/30 py-8">Sin registros</TableCell></TableRow>
            ) : signups.map((s) => (
              <TableRow key={s.id} className="border-white/5 hover:bg-white/5">
                <TableCell className="text-white/90 font-mono text-sm">{s.email}</TableCell>
                <TableCell className="text-white/50 text-xs">{format(new Date(s.created_at), "dd MMM yyyy HH:mm", { locale: es })}</TableCell>
                <TableCell className="text-white/40 text-xs">{s.source_route || "—"}</TableCell>
                <TableCell className="text-white/40 text-xs">{[s.utm_source, s.utm_campaign].filter(Boolean).join(" / ") || "—"}</TableCell>
                <TableCell>
                  {s.notified_at ? (
                    <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 text-xs">
                      <CheckCircle className="h-3 w-3 mr-1" /> Notificado
                    </Badge>
                  ) : (
                    <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/30 text-xs">
                      <Clock className="h-3 w-3 mr-1" /> Pendiente
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-right space-x-1">
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-white/30 hover:text-white" onClick={() => { setFormEmail(s.email); setEditItem(s); }}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  {s.notified_at && (
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-white/30 hover:text-cyan-400" title="Resetear notificación" onClick={() => resetMutation.mutate(s.id)}>
                      <RefreshCw className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-white/30 hover:text-red-400" onClick={() => setDeleteItem(s)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Add Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="bg-[#111] border-white/10 text-white">
          <DialogHeader><DialogTitle>Añadir a lista de espera</DialogTitle></DialogHeader>
          <Input placeholder="email@ejemplo.com" value={formEmail} onChange={(e) => setFormEmail(e.target.value)} className="bg-white/5 border-white/10 text-white" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)} className="border-white/20 text-white/70">Cancelar</Button>
            <Button onClick={() => addMutation.mutate(formEmail)} disabled={addMutation.isPending || !formEmail.includes("@")} className="bg-cyan-500 text-black hover:bg-cyan-400">
              {addMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null} Añadir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editItem} onOpenChange={(o) => { if (!o) setEditItem(null); }}>
        <DialogContent className="bg-[#111] border-white/10 text-white">
          <DialogHeader><DialogTitle>Editar email</DialogTitle></DialogHeader>
          <Input value={formEmail} onChange={(e) => setFormEmail(e.target.value)} className="bg-white/5 border-white/10 text-white" />
          <p className="text-xs text-white/40">Al cambiar el email, se reseteará el estado de notificación.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditItem(null)} className="border-white/20 text-white/70">Cancelar</Button>
            <Button onClick={() => editItem && editMutation.mutate({ id: editItem.id, email: formEmail })} disabled={editMutation.isPending || !formEmail.includes("@")} className="bg-cyan-500 text-black hover:bg-cyan-400">
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <AlertDialog open={!!deleteItem} onOpenChange={(o) => { if (!o) setDeleteItem(null); }}>
        <AlertDialogContent className="bg-[#111] border-white/10 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar registro?</AlertDialogTitle>
            <AlertDialogDescription className="text-white/50">
              Se eliminará <strong className="text-white">{deleteItem?.email}</strong> de la lista de espera permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-white/20 text-white/70">Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteItem && deleteMutation.mutate(deleteItem.id)} className="bg-red-600 hover:bg-red-500 text-white">
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
