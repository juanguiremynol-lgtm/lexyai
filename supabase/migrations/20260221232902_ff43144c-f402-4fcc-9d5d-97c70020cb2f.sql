-- Add 'deleted' to the generated_documents status check constraint
ALTER TABLE public.generated_documents DROP CONSTRAINT IF EXISTS generated_documents_status_check;

ALTER TABLE public.generated_documents ADD CONSTRAINT generated_documents_status_check
  CHECK (status = ANY (ARRAY[
    'draft', 'generated', 'ready_for_signature', 'finalized', 'delivered_to_lawyer',
    'sent_for_signature', 'partially_signed', 'signed', 'signed_finalized',
    'declined', 'expired', 'revoked', 'superseded', 'deleted'
  ]));
