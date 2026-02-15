/**
 * Dialog for creating a Courtesy Voucher (Enterprise 1 year at COP 0)
 */

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, CheckCircle2, Copy, Link as LinkIcon } from "lucide-react";
import { toast } from "sonner";

interface CourtesyVoucherDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface CreateVoucherResult {
  ok: boolean;
  voucher_id?: string;
  code?: string;
  recipient_email?: string;
  status?: string;
  expires_at?: string;
  raw_token?: string;
  error?: string;
  code_error?: string;
}

export function CourtesyVoucherDialog({ open, onOpenChange }: CourtesyVoucherDialogProps) {
  const queryClient = useQueryClient();
  const [recipientEmail, setRecipientEmail] = useState("");
  const [note, setNote] = useState("");
  const [expiresDays, setExpiresDays] = useState(30);
  const [createdVoucher, setCreatedVoucher] = useState<CreateVoucherResult | null>(null);

  const createVoucher = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("platform_create_courtesy_voucher", {
        p_recipient_email: recipientEmail,
        p_note: note || null,
        p_expires_days: expiresDays,
      });

      if (error) throw error;
      return data as unknown as CreateVoucherResult;
    },
    onSuccess: (data) => {
      if (data.ok) {
        setCreatedVoucher(data);
        queryClient.invalidateQueries({ queryKey: ["platform-courtesy-vouchers"] });
        toast.success("Voucher de cortesía creado exitosamente");
      } else {
        toast.error(data.error || "Error al crear voucher");
      }
    },
    onError: (error: Error) => {
      toast.error("Error: " + error.message);
    },
  });

  const handleClose = () => {
    setRecipientEmail("");
    setNote("");
    setExpiresDays(30);
    setCreatedVoucher(null);
    onOpenChange(false);
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copiado al portapapeles`);
  };

  const getRedeemUrl = () => {
    if (!createdVoucher?.raw_token) return "";
    return `https://andromeda.legal/v/redeem/${createdVoucher.raw_token}`;
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Crear Voucher de Cortesía</DialogTitle>
          <DialogDescription>
            Enterprise por 1 año a COP $0 (IVA incluido)
          </DialogDescription>
        </DialogHeader>

        {!createdVoucher ? (
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="recipient-email">Email del destinatario *</Label>
              <Input
                id="recipient-email"
                type="email"
                value={recipientEmail}
                onChange={(e) => setRecipientEmail(e.target.value)}
                placeholder="cliente@ejemplo.com"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="expires-days">Válido por (días)</Label>
              <Input
                id="expires-days"
                type="number"
                min={1}
                max={180}
                value={expiresDays}
                onChange={(e) => setExpiresDays(parseInt(e.target.value) || 30)}
              />
              <p className="text-xs text-muted-foreground">
                El voucher debe canjearse dentro de este plazo (1-180 días)
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="note">Nota (opcional)</Label>
              <Textarea
                id="note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Ej: Cortesía para demostración de producto"
                rows={2}
              />
            </div>
          </div>
        ) : (
          <div className="space-y-4 py-4">
            <div className="rounded-lg border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/20 p-4 space-y-3">
              <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
                <CheckCircle2 className="h-5 w-5" />
                <span className="font-medium">Voucher creado exitosamente</span>
              </div>

              <div className="space-y-2">
                <Label className="text-sm text-muted-foreground">Código</Label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 px-3 py-2 bg-muted rounded text-sm font-mono">
                    {createdVoucher.code}
                  </code>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => copyToClipboard(createdVoucher.code || "", "Código")}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-sm text-muted-foreground">Enlace de canje</Label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 px-3 py-2 bg-muted rounded text-xs font-mono truncate">
                    {getRedeemUrl()}
                  </code>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => copyToClipboard(getRedeemUrl(), "Enlace")}
                  >
                    <LinkIcon className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="text-sm text-muted-foreground">
                <p>Destinatario: <strong>{createdVoucher.recipient_email}</strong></p>
                <p>Expira: <strong>{new Date(createdVoucher.expires_at || "").toLocaleDateString("es-CO")}</strong></p>
              </div>
            </div>

            <p className="text-sm text-amber-600 dark:text-amber-400">
              ⚠️ Este enlace solo se muestra una vez. Cópielo ahora para enviarlo al destinatario.
            </p>
          </div>
        )}

        <DialogFooter>
          {!createdVoucher ? (
            <>
              <Button variant="outline" onClick={handleClose}>
                Cancelar
              </Button>
              <Button
                onClick={() => createVoucher.mutate()}
                disabled={createVoucher.isPending || !recipientEmail}
              >
                {createVoucher.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                )}
                Crear Voucher
              </Button>
            </>
          ) : (
            <Button onClick={handleClose}>Cerrar</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
