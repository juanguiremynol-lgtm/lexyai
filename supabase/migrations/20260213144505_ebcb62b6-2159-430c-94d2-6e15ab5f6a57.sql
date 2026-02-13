
-- Add the "Cobertura de Enriquecimiento por Subcadena" assurance gate
-- This function checks that required providers were attempted for each workflow/subchain
-- within the last sync window (24 hours).

CREATE OR REPLACE FUNCTION public.atenia_subchain_coverage_gate(p_organization_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
  v_missing_count INT := 0;
  v_checked_count INT := 0;
  v_missing_items JSONB := '[]'::JSONB;
  v_window INTERVAL := INTERVAL '24 hours';
  v_org_filter UUID;
  rec RECORD;
BEGIN
  -- If no org specified, check all orgs
  v_org_filter := p_organization_id;

  -- For each monitored work item with a radicado, verify that required
  -- provider subchains were attempted in the last 24 hours.
  FOR rec IN
    SELECT
      wi.id AS work_item_id,
      wi.workflow_type,
      wi.radicado,
      wi.organization_id,
      -- Check CGP/LABORAL ACTUACIONES: must have cpnu trace
      CASE
        WHEN wi.workflow_type IN ('CGP', 'LABORAL') THEN
          EXISTS (
            SELECT 1 FROM sync_traces st
            WHERE st.work_item_id = wi.id
              AND st.created_at >= NOW() - v_window
              AND (st.provider ILIKE '%cpnu%' OR st.meta->>'subchain_kind' = 'ACTUACIONES')
              AND st.step IN ('SYNC_START', 'FETCH_RESULT', 'EXTERNAL_PROVIDER_SYNC', 'DB_WRITE_RESULT')
          )
        WHEN wi.workflow_type = 'CPACA' THEN
          EXISTS (
            SELECT 1 FROM sync_traces st
            WHERE st.work_item_id = wi.id
              AND st.created_at >= NOW() - v_window
              AND (st.provider ILIKE '%samai%')
              AND st.step IN ('SYNC_START', 'FETCH_RESULT', 'EXTERNAL_PROVIDER_SYNC', 'DB_WRITE_RESULT')
          )
        ELSE TRUE
      END AS acts_attempted,
      -- Check ESTADOS subchain
      CASE
        WHEN wi.workflow_type IN ('CGP', 'LABORAL', 'PENAL_906') THEN
          EXISTS (
            SELECT 1 FROM sync_traces st
            WHERE st.work_item_id = wi.id
              AND st.created_at >= NOW() - v_window
              AND (st.provider ILIKE '%publicaciones%' OR st.meta->>'subchain_kind' = 'ESTADOS')
              AND st.step IN ('SYNC_START', 'FETCH_RESULT', 'EXTERNAL_PROVIDER_SYNC', 'DB_WRITE_RESULT')
          )
        WHEN wi.workflow_type = 'CPACA' THEN
          EXISTS (
            SELECT 1 FROM sync_traces st
            WHERE st.work_item_id = wi.id
              AND st.created_at >= NOW() - v_window
              AND (st.provider ILIKE '%samai_estados%' OR st.provider ILIKE '%samai-estados%' OR st.meta->>'subchain_kind' = 'ESTADOS')
              AND st.step IN ('SYNC_START', 'FETCH_RESULT', 'EXTERNAL_PROVIDER_SYNC', 'DB_WRITE_RESULT')
          )
        ELSE TRUE
      END AS estados_attempted
    FROM work_items wi
    WHERE wi.radicado IS NOT NULL
      AND wi.workflow_type IN ('CGP', 'LABORAL', 'CPACA', 'PENAL_906')
      AND wi.scrape_status != 'ARCHIVED'
      AND (v_org_filter IS NULL OR wi.organization_id = v_org_filter)
    ORDER BY wi.created_at DESC
    LIMIT 500
  LOOP
    v_checked_count := v_checked_count + 1;

    IF NOT rec.acts_attempted OR NOT rec.estados_attempted THEN
      v_missing_count := v_missing_count + 1;
      IF v_missing_count <= 10 THEN
        v_missing_items := v_missing_items || jsonb_build_object(
          'work_item_id', rec.work_item_id,
          'workflow', rec.workflow_type,
          'radicado', LEFT(rec.radicado, 12) || '...',
          'acts_ok', rec.acts_attempted,
          'estados_ok', rec.estados_attempted
        );
      END IF;
    END IF;
  END LOOP;

  v_result := jsonb_build_object(
    'ok', v_missing_count = 0,
    'checked', v_checked_count,
    'missing', v_missing_count,
    'coverage_pct', CASE WHEN v_checked_count > 0 THEN ROUND(((v_checked_count - v_missing_count)::NUMERIC / v_checked_count) * 100) ELSE 100 END,
    'missing_items', v_missing_items,
    'computed_at', NOW()
  );

  RETURN v_result;
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.atenia_subchain_coverage_gate TO authenticated;
GRANT EXECUTE ON FUNCTION public.atenia_subchain_coverage_gate TO service_role;
