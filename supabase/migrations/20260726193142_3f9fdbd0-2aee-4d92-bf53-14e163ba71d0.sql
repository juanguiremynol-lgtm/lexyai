-- Retroactive reclassification: CLIENTE/PARTE matches are no longer surgical
-- enough to be CONFIRMED (measured fan-out of 3.6 links per message).
-- Exception: links that already served as evidence to close a deadline stay CONFIRMED.
UPDATE public.work_item_email_links l
SET link_status = 'SUGGESTED',
    confidence = LEAST(l.confidence, 0.65),
    matched_value = l.matched_value
WHERE l.matched_by IN ('CLIENTE', 'PARTE')
  AND l.link_status = 'CONFIRMED'
  AND NOT (
    l.evidence_type = 'MEMORIAL_ENVIADO'
    AND EXISTS (
      SELECT 1 FROM public.work_item_deadlines d
      WHERE d.work_item_id = l.work_item_id
        AND d.status = 'FULFILLED_BY_EMAIL_EVIDENCE'
    )
  );
