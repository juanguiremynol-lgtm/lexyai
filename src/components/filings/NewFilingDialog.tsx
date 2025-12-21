import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { FILING_TYPES } from "@/lib/constants";

interface NewFilingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (filingId: string) => void;
}

interface Matter {
  id: string;
  matter_name: string;
  client_name: string;
}

export function NewFilingDialog({ open, onOpenChange, onSuccess }: NewFilingDialogProps) {
  const [matters, setMatters] = useState<Matter[]>([]);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    matter_id: "",
    filing_type: "",
    reparto_email_to: "",
    sent_at: new Date().toISOString().split('T')[0],
  });

  useEffect(() => {
    if (open) {
      fetchMatters();
    }
  }, [open]);

  const fetchMatters = async () => {
    const { data } = await supabase
      .from('matters')
      .select('id, matter_name, client_name')
      .order('created_at', { ascending: false });
    
    setMatters(data || []);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.matter_id || !formData.filing_type) {
      toast.error("Por favor complete los campos requeridos");
      return;
    }

    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");

      const sentAt = new Date(formData.sent_at);
      const slaActaDueAt = new Date(sentAt);
      slaActaDueAt.setDate(slaActaDueAt.getDate() + 5);

      const { data, error } = await supabase
        .from('filings')
        .insert({
          owner_id: user.id,
          matter_id: formData.matter_id,
          filing_type: formData.filing_type,
          reparto_email_to: formData.reparto_email_to || null,
          sent_at: sentAt.toISOString(),
          status: 'SENT_TO_REPARTO',
          sla_acta_due_at: slaActaDueAt.toISOString(),
        })
        .select()
        .single();

      if (error) throw error;

      // Create initial task
      await supabase.from('tasks').insert({
        owner_id: user.id,
        filing_id: data.id,
        type: 'FOLLOW_UP_REPARTO',
        title: 'Seguimiento a reparto - Acta pendiente',
        due_at: slaActaDueAt.toISOString(),
      });

      // Create alert
      await supabase.from('alerts').insert({
        owner_id: user.id,
        filing_id: data.id,
        severity: 'INFO',
        message: `Radicación creada: pendiente acta de reparto`,
      });

      toast.success("Radicación creada exitosamente");
      onSuccess(data.id);
    } catch (error: any) {
      toast.error(error.message || "Error al crear la radicación");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">Nueva Radicación</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="matter">Asunto *</Label>
            <Select value={formData.matter_id} onValueChange={(v) => setFormData(p => ({ ...p, matter_id: v }))}>
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar asunto..." />
              </SelectTrigger>
              <SelectContent>
                {matters.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.client_name} - {m.matter_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="filing_type">Tipo de Radicación *</Label>
            <Select value={formData.filing_type} onValueChange={(v) => setFormData(p => ({ ...p, filing_type: v }))}>
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar tipo..." />
              </SelectTrigger>
              <SelectContent>
                {FILING_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="reparto_email">Correo de Reparto</Label>
            <Input
              id="reparto_email"
              type="email"
              value={formData.reparto_email_to}
              onChange={(e) => setFormData(p => ({ ...p, reparto_email_to: e.target.value }))}
              placeholder="reparto@ejemplo.gov.co"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="sent_at">Fecha de Envío</Label>
            <Input
              id="sent_at"
              type="date"
              value={formData.sent_at}
              onChange={(e) => setFormData(p => ({ ...p, sent_at: e.target.value }))}
            />
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Creando..." : "Crear Radicación"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
