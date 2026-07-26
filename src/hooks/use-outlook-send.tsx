/**
 * use-outlook-send — THE ONLY path allowed to invoke the `outlook-send` edge
 * function.
 *
 * Control 1 (ratified, enforced structurally): the raw mutation is module
 * private. Consumers get `requestSend(payload)`, which merely *stages* the
 * message and opens the two-step confirmation screen owned by this hook.
 * The network call happens exclusively inside the confirmation dialog's
 * "Confirmar y enviar" handler. A component that forgets to render
 * `confirmationDialog` simply cannot send (fail-closed).
 *
 * Do not export the mutation, and do not call `supabase.functions.invoke
 * ("outlook-send")` anywhere else — a regression test enforces both.
 */
import { useCallback, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
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

export interface OutlookSendPayload {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  content_type?: "Text" | "HTML";
  work_item_id?: string;
  as_memorial?: boolean;
  attachments?: { name: string; contentType?: string; contentBytes: string }[];
}

/** Extra context rendered in the confirmation screen. */
export interface OutlookSendContext {
  /** Mailbox the message leaves from, shown to the user. */
  senderEmail?: string | null;
  /** Human label for the linked work item, when the id alone is opaque. */
  workItemLabel?: string | null;
}

function useRawOutlookSendMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: OutlookSendPayload) => {
      const { data, error } = await supabase.functions.invoke("outlook-send", { body: payload });
      if (error) {
        let detail: string | null = null;
        try {
          const parsed = await (error as { context?: { json?: () => Promise<{ error?: string }> } })
            .context?.json?.();
          detail = parsed?.error ?? null;
        } catch { /* ignore */ }
        throw new Error(detail ?? error.message);
      }
      if (data?.error) throw new Error(data.error);
      return data as { ok: boolean; sent_from?: string | null; link_id?: string | null };
    },
    onSuccess: (_data, variables) => {
      toast.success("Correo enviado desde tu Outlook");
      void queryClient.invalidateQueries({ queryKey: ["email-connection"] });
      void queryClient.invalidateQueries({ queryKey: ["outlook-send-audit-log"] });
      if (variables.work_item_id) {
        void queryClient.invalidateQueries({ queryKey: ["work-item-email-links"] });
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export interface UseOutlookSendResult {
  /** Stages the message and opens the mandatory confirmation screen. */
  requestSend: (payload: OutlookSendPayload, context?: OutlookSendContext) => Promise<boolean>;
  isPending: boolean;
  /** MUST be rendered by the consumer; without it nothing can be sent. */
  confirmationDialog: JSX.Element;
}

export function useOutlookSend(): UseOutlookSendResult {
  const send = useRawOutlookSendMutation();
  const [staged, setStaged] = useState<
    { payload: OutlookSendPayload; context: OutlookSendContext } | null
  >(null);
  const resolverRef = useRef<((sent: boolean) => void) | null>(null);

  const settle = useCallback((sent: boolean) => {
    resolverRef.current?.(sent);
    resolverRef.current = null;
    setStaged(null);
  }, []);

  const requestSend = useCallback(
    (payload: OutlookSendPayload, context: OutlookSendContext = {}) => {
      resolverRef.current?.(false);
      setStaged({ payload, context });
      return new Promise<boolean>((resolve) => {
        resolverRef.current = resolve;
      });
    },
    [],
  );

  const payload = staged?.payload;
  const attachments = payload?.attachments ?? [];

  const confirmationDialog = (
    <AlertDialog
      open={staged !== null}
      onOpenChange={(open) => {
        if (!open && !send.isPending) settle(false);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Confirmar envío</AlertDialogTitle>
          <AlertDialogDescription>
            Revisa los datos: el correo saldrá de tu buzón
            {staged?.context.senderEmail ? ` ${staged.context.senderEmail}` : ""} y quedará
            registrado en tu historial de envíos.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <dl className="space-y-2 rounded-md border p-3 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Para</dt>
            <dd className="break-words font-medium">{payload?.to.join(", ")}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">CC</dt>
            <dd className="break-words">{payload?.cc?.length ? payload.cc.join(", ") : "—"}</dd>
          </div>
          {payload?.bcc?.length ? (
            <div>
              <dt className="text-xs text-muted-foreground">BCC</dt>
              <dd className="break-words">{payload.bcc.join(", ")}</dd>
            </div>
          ) : null}
          <div>
            <dt className="text-xs text-muted-foreground">Asunto</dt>
            <dd className="break-words font-medium">{payload?.subject}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Expediente vinculado</dt>
            <dd>
              {payload?.work_item_id
                ? `${staged?.context.workItemLabel ?? "Sí"}${
                  payload.as_memorial ? " · se registrará como memorial enviado" : ""
                }`
                : "Sin vínculo a expediente"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Adjuntos</dt>
            <dd>
              {attachments.length === 0
                ? "Ninguno"
                : `${attachments.length}: ${attachments.map((a) => a.name).join(", ")}`}
            </dd>
          </div>
        </dl>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={send.isPending}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              if (!payload) return;
              void send
                .mutateAsync(payload)
                .then(() => settle(true))
                .catch(() => settle(false));
            }}
            disabled={send.isPending}
          >
            {send.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden />}
            Confirmar y enviar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { requestSend, isPending: send.isPending, confirmationDialog };
}
