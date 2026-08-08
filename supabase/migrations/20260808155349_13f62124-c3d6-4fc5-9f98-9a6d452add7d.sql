-- ITERATION 47.2 — the third stale guard, same defect one table deeper.
--
-- `work_items` was unblocked in 47.1, and the write then failed on the HISTORY
-- table, whose CHECK still enumerated the reserva-sumarial vocabulary that
-- iteration 45 retired ('ENTRA_EN_RESERVA' / 'SALE_DE_RESERVA'). The writer
-- records the resulting STATE, so the admissible set must be the state
-- vocabulary, identical to the one on work_items — not a second, parallel
-- enumeration that can drift out of step again.

ALTER TABLE public.work_item_detalle_exposicion_historial
  DROP CONSTRAINT IF EXISTS work_item_reserva_historial_evento_check;

-- Migrate any legacy row to the current vocabulary (expected: 0 — the table is
-- empty precisely because every insert has been failing).
UPDATE public.work_item_detalle_exposicion_historial
   SET evento = CASE evento
                  WHEN 'ENTRA_EN_RESERVA' THEN 'PROCESO_PRIVADO'
                  WHEN 'SALE_DE_RESERVA'  THEN 'DETALLE_EXPUESTO'
                  ELSE evento
                END
 WHERE evento IN ('ENTRA_EN_RESERVA', 'SALE_DE_RESERVA');

ALTER TABLE public.work_item_detalle_exposicion_historial
  ADD CONSTRAINT work_item_detalle_exposicion_historial_evento_check
  CHECK (evento = ANY (ARRAY['PROCESO_PRIVADO'::text,
                             'DETALLE_EXPUESTO'::text,
                             'DESCONOCIDO'::text]));