/**
 * OutlookComposeDialog — Compose and send from the user's OWN Outlook mailbox.
 *
 * Used by the email client, the "Correos" tab (replies) and the memorial
 * generator. Andromeda transmits the body to Microsoft but never stores it:
 * only metadata and the work-item link are persisted.
 */
import { useEffect, useState } from "react";
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
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2, Paperclip, Send, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import { useEmailConnection, useOutlookSend } from "@/hooks/use-email-connection";

const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024;

export interface OutlookComposeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultTo?: string[];
  defaultSubject?: string;
  defaultBody?: string;
  workItemId?: string;
  /** Marks the message as procedural evidence (memorial) for the deadline engine. */
  asMemorial?: boolean;
  title?: string;
  onSent?: () => void;
}

async function fileToBase64(file: File): Promise<string> {
  const buffer = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < buffer.length; i += 0x8000) {
    binary += String.fromCharCode(...buffer.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function OutlookComposeDialog({
  open,
  onOpenChange,
  defaultTo = [],
  defaultSubject = "",
  defaultBody = "",
  workItemId,
  asMemorial = false,
  title = "Enviar desde mi Outlook",
  onSent,
}: OutlookComposeDialogProps) {
  const { connection, canSend, needsReconnectForSend, connect } = useEmailConnection();
  const send = useOutlookSend();

  const [to, setTo] = useState(defaultTo.join(", "));
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState(defaultSubject);
  const [body, setBody] = useState(defaultBody);
  const [files, setFiles] = useState<File[]>([]);
  /**
   * Control 1 (ratified): no send may fire without the user seeing and
   * confirming this screen — including pre-filled memorial flows.
   */
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTo(defaultTo.join(", "));
    setSubject(defaultSubject);
    setBody(defaultBody);
    setCc("");
    setFiles([]);
    setConfirmOpen(false);
  }, [open, defaultSubject, defaultBody, defaultTo.join(",")]);

  const parseList = (value: string) =>
    value.split(/[,;\s]+/).map((v) => v.trim()).filter((v) => v.includes("@"));

  const totalBytes = files.reduce((acc, f) => acc + f.size, 0);

  const toList = parseList(to);
  const ccList = parseList(cc);

  const handleReview = () => {
    if (toList.length === 0) return toast.error("Agrega al menos un destinatario válido");
    if (!subject.trim()) return toast.error("Agrega un asunto");
    if (!body.trim()) return toast.error("El mensaje está vacío");
    if (totalBytes > MAX_ATTACHMENT_BYTES) {
      return toast.error("Los adjuntos superan 3 MB. Comparte un enlace en su lugar.");
    }
    setConfirmOpen(true);
  };

  const handleConfirmedSend = async () => {
    const attachments = await Promise.all(
      files.map(async (f) => ({
        name: f.name,
        contentType: f.type || "application/octet-stream",
        contentBytes: await fileToBase64(f),
      })),
    );

    await send.mutateAsync({
      to: toList,
      cc: ccList,
      subject: subject.trim(),
      body,
      content_type: "Text",
      work_item_id: workItemId,
      as_memorial: asMemorial,
      attachments,
    });
    setConfirmOpen(false);
    onOpenChange(false);
    onSent?.();
  };

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {canSend
              ? `Se enviará desde ${connection?.ms_account_email ?? "tu buzón"} y quedará en tus Elementos enviados.`
              : "Necesitas autorizar el envío en tu buzón de Outlook."}
          </DialogDescription>
        </DialogHeader>

        {!canSend ? (
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              {needsReconnectForSend
                ? "Tu conexión fue autorizada solo para lectura. Vuelve a conectar Outlook para habilitar el envío."
                : "Conecta tu buzón de Outlook para enviar correos desde tu propia cuenta."}
            </p>
            <Button size="sm" onClick={() => connect.mutate()} disabled={connect.isPending}>
              {connect.isPending ? "Abriendo Microsoft…" : "Conectar Outlook"}
            </Button>
          </div>
        ) : (
          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <Label className="text-xs">Para</Label>
              <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="juzgado@ejemplo.gov.co" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">CC</Label>
              <Input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="opcional" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Asunto</Label>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Mensaje</Label>
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={10}
                className="resize-none"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" asChild>
                  <label className="cursor-pointer">
                    <Paperclip className="mr-1 h-4 w-4" aria-hidden />
                    Adjuntar
                    <input
                      type="file"
                      multiple
                      className="hidden"
                      onChange={(e) => setFiles([...files, ...Array.from(e.target.files ?? [])])}
                    />
                  </label>
                </Button>
                <span className="text-xs text-muted-foreground">Máximo 3 MB en total</span>
              </div>
              {files.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {files.map((f) => (
                    <Badge key={f.name} variant="secondary" className="gap-1">
                      {f.name}
                      <button
                        type="button"
                        onClick={() => setFiles(files.filter((x) => x !== f))}
                        aria-label={`Quitar ${f.name}`}
                      >
                        <X className="h-3 w-3" aria-hidden />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            {workItemId && (
              <p className="flex items-start gap-2 rounded-md border border-dashed p-2 text-xs text-muted-foreground">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
                Se guardará el vínculo con el expediente
                {asMemorial ? " como memorial enviado" : ""}; el contenido del correo no se almacena.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleReview} disabled={!canSend || send.isPending}>
            {send.isPending
              ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden />
              : <Send className="mr-1 h-4 w-4" aria-hidden />}
            Revisar y enviar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <AlertDialog open={confirmOpen} onOpenChange={(o) => !send.isPending && setConfirmOpen(o)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Confirmar envío</AlertDialogTitle>
          <AlertDialogDescription>
            Revisa los datos: el correo saldrá de tu buzón {connection?.ms_account_email ?? ""} y
            quedará registrado en tu historial de envíos.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <dl className="space-y-2 rounded-md border p-3 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Para</dt>
            <dd className="break-words font-medium">{toList.join(", ")}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">CC</dt>
            <dd className="break-words">{ccList.length ? ccList.join(", ") : "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Asunto</dt>
            <dd className="break-words font-medium">{subject.trim()}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Expediente vinculado</dt>
            <dd>
              {workItemId
                ? `Sí${asMemorial ? " · se registrará como memorial enviado" : ""}`
                : "Sin vínculo a expediente"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Adjuntos</dt>
            <dd>
              {files.length === 0
                ? "Ninguno"
                : `${files.length}: ${files.map((f) => f.name).join(", ")}`}
            </dd>
          </div>
        </dl>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={send.isPending}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              void handleConfirmedSend();
            }}
            disabled={send.isPending}
          >
            {send.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden />}
            Confirmar y enviar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
