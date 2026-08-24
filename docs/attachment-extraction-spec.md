# Attachment text extraction — specification (Fase 3, B.8; not implemented)

## Scope now vs. later
Implemented in Fase 3: `attachment_names` as a matching signal (`ATTACHMENT_IDENTIFIER`,
strong class) — the identifier is looked for inside the filename after the same
normalisation used for radicados. No file is opened.

Not implemented: reading the content of the attachment. This document specifies it.

## Formats
| Format | Share (expected) | Method |
|---|---|---|
| PDF nativo (text layer) | majority of resoluciones and oficios | text-layer extraction |
| PDF escaneado | most constancias de notificación | OCR (Spanish, 300 dpi) |
| DOCX | occasional pliegos and respuestas | XML text extraction |
| XLSX / images / ZIP | rare | out of scope for phase one |

## Storage policy
Andromeda does not become an email archive; Outlook remains the system of record.
Therefore:
- Store **extracted text only**, capped (proposal: first 20 000 characters), plus a
  content hash and the Outlook reference.
- Never store the binary attachment itself for email-borne documents.
- Retention follows the matter's retention policy; text is deleted with the matter.

## Where extraction runs
An edge function invoked from the email pipeline, queued and idempotent on
`(internet_message_id, attachment_name, content_hash)` — the same durable-queue
pattern already used by `estado_attachment_queue`. Never inline in `outlook-sync`:
extraction latency must not delay linking.

## Cost
Text-layer PDFs and DOCX are effectively free (CPU only). OCR is the cost driver;
budget must be per-organisation and metered, with a monthly ceiling and a visible
counter. A per-document cap and a page cap are required before enabling OCR.

## Entry into the signal taxonomy
- Identifier found in extracted text → `IDENTIFIER_EXACT` **only** when the
  identifier is authority-assigned and normalises exactly; otherwise
  `IDENTIFIER_FUZZY` (strong).
- Notification date read from a constancia → evidence that may set a deadline
  anchor, always as a suggestion requiring confirmation (invariant I1).
- Document-type classification (resolución / pliego de cargos / respuesta de
  fondo) → weak signal for matching, and a stage *suggestion* only.

## Inferences impossible without extraction
1. The actual notification date inside a constancia de notificación — today the
   anchor must be entered by hand.
2. Whether a respuesta is de fondo or parcial when the body is a one-line
   covering note and the substance is attached.
3. The resolución/acto number and its issuing authority when they appear only in
   the document.
4. Whether a pliego de cargos was formulated, and against whom.
5. Whether a recurso was resolved, and its outcome.

Until extraction exists, all five remain manual, and the system must say so
rather than guess.
