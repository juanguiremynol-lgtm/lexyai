import { supabase } from "@/integrations/supabase/client";
import { saveAs } from "file-saver";
import type { Database, Tables } from "@/integrations/supabase/types";

export const REPARTO_VENTANILLA = "https://siugj.ramajudicial.gov.co/principalPortal/ventanilla.php";
export const REPARTO_PDF_LIMIT = 10 * 1024 * 1024;
export const REPARTO_WORKFLOWS = ["CGP", "EJECUTIVO", "CPACA", "LABORAL", "TUTELA"] as const;
export const REPARTO_LABELS = {
  RECEPCION: "Constancia de recepción",
  REPARTO: "Reparto",
};

export type RepartoKind = keyof typeof REPARTO_LABELS;
export type RepartoField =
  "kind" | "radicado" | "external_reference" | "authority_name" |
  "demandantes" | "demandados" | "receipt_on" | "assigned_on";

interface RepartoSuggestion {
  value: string;
  source: "PDF" | "OUTLOOK";
}

export type RepartoDraft = Pick<Tables<"judicial_reparto_imports">,
  "id" | "work_item_id" | "source" | "message_subject" | "message_sender" | "message_received_at" |
  "message_url" | "pdf_name" | "pdf_path" | "pdf_sha256" | "suggestions" | "created_at">;
export const REPARTO_DRAFT_FIELDS = "id,work_item_id,source,message_subject,message_sender,message_received_at,message_url,pdf_name,pdf_path,pdf_sha256,suggestions,created_at";
export const REPARTO_EVIDENCE_FIELDS = "id,kind,external_reference,radicado,authority_name,event_on,confirmed_at,pdf_name,pdf_path,message_subject,message_url";
export type RepartoConfirmArgs = Database["public"]["Functions"]["confirm_judicial_reparto"]["Args"];
export type RepartoMatch = Database["public"]["Functions"]["find_judicial_reparto_matches"]["Returns"][number];

export interface RepartoMail {
  id: string;
  subject: string | null;
  sender: string | null;
  received_at: string | null;
  web_link: string | null;
  has_attachments: boolean;
}

export interface RepartoMailPreview {
  mail: RepartoMail;
  pdfs: { id: string; name: string; size: number }[];
}

export type RepartoMailChoice = { detection_id: string } | { message_id: string };

export async function invokeReparto<T>(body: Record<string, unknown> | FormData): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>("import-judicial-reparto", { body });
  if (error) {
    const response = "context" in error ? error.context : null;
    const detail = response instanceof Response ? await response.json().catch(() => null) : null;
    throw new Error(detail?.error || "No se pudo abrir la importación. Intenta de nuevo.");
  }
  if (!data) throw new Error("La importación no devolvió un resultado.");
  return data;
}

export function repartoSuggestions(draft: RepartoDraft) {
  return (draft.suggestions ?? {}) as {
    fields?: Partial<Record<RepartoField, RepartoSuggestion>>;
    conflicts?: RepartoField[];
    pdf_text_read?: boolean;
  };
}

export function normalizeIntakeRadicado(value: string): string | null {
  const trimmed = value.trim();
  if (!/^[0-9 -]+$/.test(trimmed)) return null;
  const digits = trimmed.replace(/[ -]/g, "");
  return /^\d{23}$/.test(digits) && !/^0{23}$/.test(digits) ? digits : null;
}

export function formatIntakeDate(value: string): string {
  return value.slice(0, 10).split("-").reverse().join("/");
}

export async function downloadRepartoPdf(path: string, name: string | null) {
  const { data, error } = await supabase.storage.from("judicial-reparto").download(path);
  if (error || !data) throw new Error("No se pudo descargar el PDF original.");
  saveAs(data, name || "comprobante-rama-judicial.pdf");
}
