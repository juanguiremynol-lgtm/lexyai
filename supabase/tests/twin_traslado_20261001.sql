-- Regression: CPNU "Auto Ordena - Corre traslado" (act 70899e74) + PP publication
-- "AutoCorreTraslado" (18c538d8) / Estado 116 (16a042bd), same matter and date,
-- must yield exactly one visible manual review (the audit hold 0834a576).
-- Runs inside a DO block that always raises at the end, so nothing persists.
DO $$
DECLARE v_live int; v_r1 uuid; v_r2 uuid; v_r3 uuid; v_r4 uuid;
BEGIN
  -- Simulate the pre-repair state: no cancelled twin occupying the slot.
  DELETE FROM public.work_item_deadlines WHERE id = '49d2fd32-9f1a-4225-ab96-e8ed5114fb08';
  v_r1 := public.compute_deadline_for_publicacion('16a042bd-9688-4a4a-a208-f34d13f060ff');
  v_r2 := public.compute_deadline_for_publicacion('18c538d8-d051-4b58-99ce-fa3107448f50');
  -- Second read (idempotency).
  v_r3 := public.compute_deadline_for_publicacion('16a042bd-9688-4a4a-a208-f34d13f060ff');
  v_r4 := public.compute_deadline_for_publicacion('18c538d8-d051-4b58-99ce-fa3107448f50');
  SELECT count(*) INTO v_live FROM public.work_item_deadlines
   WHERE work_item_id = 'b4037a4d-0dab-422d-a65f-b7172b040fa4'
     AND trigger_date = '2026-09-29' AND status IN ('PENDING','REQUIERE_REVISION_MANUAL');
  IF v_live <> 1 OR v_r1 IS NOT NULL OR v_r2 IS NOT NULL OR v_r3 IS NOT NULL OR v_r4 IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL live=% r=%,%,%,%', v_live, v_r1, v_r2, v_r3, v_r4;
  END IF;
  IF EXISTS (SELECT 1 FROM public.work_item_deadlines WHERE id='0834a576-fd82-48f6-8785-9b0738bef5a7'
             AND (status <> 'REQUIERE_REVISION_MANUAL' OR deadline_date IS NOT NULL)) THEN
    RAISE EXCEPTION 'FAIL hold altered';
  END IF;
  RAISE EXCEPTION 'PASS (rolled back) live=1';
END $$;
