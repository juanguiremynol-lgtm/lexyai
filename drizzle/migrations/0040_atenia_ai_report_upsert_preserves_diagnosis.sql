CREATE OR REPLACE FUNCTION public.atenia_ai_upsert_report(p_report jsonb)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.atenia_ai_reports (
    organization_id, report_date, report_type,
    total_work_items, items_synced_ok, items_synced_partial, items_failed,
    new_actuaciones_found, new_publicaciones_found,
    provider_status, diagnostics, remediation_actions,
    ai_diagnosis, lexy_data_ready
  )
  SELECT
    (p_report->>'organization_id')::uuid,
    (p_report->>'report_date')::date,
    p_report->>'report_type',
    (p_report->>'total_work_items')::int,
    (p_report->>'items_synced_ok')::int,
    (p_report->>'items_synced_partial')::int,
    (p_report->>'items_failed')::int,
    (p_report->>'new_actuaciones_found')::int,
    (p_report->>'new_publicaciones_found')::int,
    p_report->'provider_status',
    p_report->'diagnostics',
    p_report->'remediation_actions',
    p_report->>'ai_diagnosis',
    COALESCE((p_report->>'lexy_data_ready')::boolean, true)
  ON CONFLICT (organization_id, report_date, report_type)
  DO UPDATE SET
    total_work_items = EXCLUDED.total_work_items,
    items_synced_ok = EXCLUDED.items_synced_ok,
    items_synced_partial = EXCLUDED.items_synced_partial,
    items_failed = EXCLUDED.items_failed,
    new_actuaciones_found = EXCLUDED.new_actuaciones_found,
    new_publicaciones_found = EXCLUDED.new_publicaciones_found,
    provider_status = EXCLUDED.provider_status,
    diagnostics = EXCLUDED.diagnostics,
    remediation_actions = EXCLUDED.remediation_actions,
    -- Atomic preserve: a run that produced no diagnosis never wipes an existing one.
    ai_diagnosis = COALESCE(EXCLUDED.ai_diagnosis, public.atenia_ai_reports.ai_diagnosis),
    lexy_data_ready = EXCLUDED.lexy_data_ready;
$$;

REVOKE ALL ON FUNCTION public.atenia_ai_upsert_report(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.atenia_ai_upsert_report(jsonb) TO service_role;