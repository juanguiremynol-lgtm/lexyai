
-- Drop the old check constraint that is missing new statuses
ALTER TABLE public.generated_documents DROP CONSTRAINT IF EXISTS generated_documents_status_check;

-- Re-create with ALL statuses used across the codebase
ALTER TABLE public.generated_documents ADD CONSTRAINT generated_documents_status_check
  CHECK (status = ANY (ARRAY[
    'draft',
    'generated',
    'ready_for_signature',
    'finalized',
    'delivered_to_lawyer',
    'sent_for_signature',
    'partially_signed',
    'signed',
    'signed_finalized',
    'declined',
    'expired',
    'revoked',
    'superseded'
  ]));

-- Backfill: bilateral contracts that were content-locked with old 'finalized' but never executed
UPDATE public.generated_documents
SET status = 'ready_for_signature'
WHERE document_type = 'contrato_servicios'
  AND status = 'finalized'
  AND finalized_at IS NULL;
