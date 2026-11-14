-- Run on an isolated test database, never triggers the alert-producing function.
-- Both definitions evaluate in the same snapshot; zero differences required.
BEGIN ISOLATION LEVEL REPEATABLE READ;
CREATE TEMP VIEW coverage_before AS
WITH base AS (
         SELECT w.id,
            w.radicado,
            w.workflow_type,
            w.organization_id,
            w.owner_id,
            w.monitoring_enabled,
            w.status,
            w.lifecycle_state,
            provider_chain_for_workflow(w.workflow_type::text) AS expected_providers
           FROM work_items w
          WHERE w.status = 'ACTIVE'::item_status AND w.lifecycle_state = 'ACTIVE'::work_item_lifecycle_state AND w.deleted_at IS NULL
        ), scoped AS (
         SELECT b_1.id AS work_item_id,
            ARRAY( SELECT p.p
                   FROM unnest(b_1.expected_providers) p(p)
                  WHERE provider_scope(p.p) = 'ACTS'::text) AS expected_acts,
            ARRAY( SELECT p.p
                   FROM unnest(b_1.expected_providers) p(p)
                  WHERE provider_scope(p.p) <> 'ACTS'::text) AS expected_estados
           FROM base b_1
        ), last_row AS (
         SELECT u.work_item_id,
            max(u.created_at) AS last_ingest
           FROM ( SELECT a.work_item_id,
                    a.created_at
                   FROM work_item_acts a
                  WHERE a.is_archived IS NOT TRUE
                UNION ALL
                 SELECT p.work_item_id,
                    p.created_at
                   FROM work_item_publicaciones p
                  WHERE p.is_archived IS NOT TRUE) u
          GROUP BY u.work_item_id
        ), row_counts AS (
         SELECT b_1.id AS work_item_id,
            ( SELECT count(*) AS count
                   FROM work_item_acts a
                  WHERE a.work_item_id = b_1.id AND a.is_archived IS NOT TRUE) AS act_count,
            ( SELECT count(*) AS count
                   FROM work_item_publicaciones p
                  WHERE p.work_item_id = b_1.id AND p.is_archived IS NOT TRUE) AS publication_count
           FROM base b_1
        ), last_run AS (
         SELECT r.work_item_id,
            max(r.created_at) FILTER (WHERE r.status = ANY (ARRAY['SUCCESS'::text, 'PARTIAL'::text])) AS last_ok_run,
            max(r.created_at) AS last_run
           FROM external_sync_runs r
          GROUP BY r.work_item_id
        ), attempts AS (
         SELECT x.work_item_id,
            array_agg(DISTINCT lower(x.attempt ->> 'provider'::text)) AS providers
           FROM ( SELECT r.work_item_id,
                    jsonb_array_elements(
                        CASE
                            WHEN jsonb_typeof(r.provider_attempts) = 'array'::text THEN r.provider_attempts
                            ELSE '[]'::jsonb
                        END) AS attempt
                   FROM external_sync_runs r
                  WHERE r.created_at > (now() - '30 days'::interval)) x
          WHERE (x.attempt ->> 'provider'::text) IS NOT NULL
          GROUP BY x.work_item_id
        )
 SELECT b.id AS work_item_id,
    b.radicado,
    b.workflow_type::text AS workflow_type,
    b.organization_id,
    b.owner_id,
    b.monitoring_enabled,
    b.expected_providers,
    sc.expected_acts AS expected_acts_providers,
    sc.expected_estados AS expected_estados_providers,
    COALESCE(at.providers, ARRAY[]::text[]) AS enrolled_providers,
    ARRAY( SELECT unnest(b.expected_providers) AS unnest
        EXCEPT
         SELECT unnest(COALESCE(at.providers, ARRAY[]::text[])) AS unnest) AS missing_providers,
    ARRAY( SELECT unnest(sc.expected_acts) AS unnest
        EXCEPT
         SELECT unnest(COALESCE(at.providers, ARRAY[]::text[])) AS unnest) AS missing_acts_providers,
    ARRAY( SELECT unnest(sc.expected_estados) AS unnest
        EXCEPT
         SELECT unnest(COALESCE(at.providers, ARRAY[]::text[])) AS unnest) AS missing_estados_providers,
    lr.last_ingest,
    ru.last_ok_run,
    ru.last_run,
        CASE
            WHEN b.radicado IS NULL OR length(regexp_replace(b.radicado, '\D'::text, ''::text, 'g'::text)) < 21 THEN 'SIN_RADICADO_VALIDO'::text
            WHEN COALESCE(array_length(at.providers, 1), 0) = 0 THEN 'SIN_ENROLAMIENTO'::text
            WHEN array_length(ARRAY( SELECT unnest(b.expected_providers) AS unnest
            EXCEPT
             SELECT unnest(COALESCE(at.providers, ARRAY[]::text[])) AS unnest), 1) > 0 THEN 'ENROLAMIENTO_PARCIAL'::text
            WHEN rc.act_count = 0 AND rc.publication_count = 0 AND ru.last_ok_run IS NOT NULL THEN 'LEIDO_Y_VACIO'::text
            ELSE 'OK'::text
        END AS coverage_status,
        CASE
            WHEN b.radicado IS NULL OR length(regexp_replace(b.radicado, '\D'::text, ''::text, 'g'::text)) < 21 THEN 'SIN_RADICADO_VALIDO'::text
            WHEN COALESCE(array_length(sc.expected_acts, 1), 0) = 0 THEN 'SIN_CANAL'::text
            WHEN array_length(ARRAY( SELECT unnest(sc.expected_acts) AS unnest
            EXCEPT
             SELECT unnest(COALESCE(at.providers, ARRAY[]::text[])) AS unnest), 1) > 0 THEN 'SIN_ENROLAMIENTO'::text
            WHEN rc.act_count > 0 THEN 'CUBIERTO'::text
            WHEN ru.last_ok_run IS NULL THEN 'EN_VERIFICACION'::text
            ELSE 'SIN_FILAS'::text
        END AS acts_coverage_status,
        CASE
            WHEN b.radicado IS NULL OR length(regexp_replace(b.radicado, '\D'::text, ''::text, 'g'::text)) < 21 THEN 'SIN_RADICADO_VALIDO'::text
            WHEN COALESCE(array_length(sc.expected_estados, 1), 0) = 0 THEN 'SIN_CANAL'::text
            WHEN array_length(ARRAY( SELECT unnest(sc.expected_estados) AS unnest
            EXCEPT
             SELECT unnest(COALESCE(at.providers, ARRAY[]::text[])) AS unnest), 1) > 0 THEN 'SIN_ENROLAMIENTO'::text
            WHEN rc.publication_count > 0 THEN 'CUBIERTO'::text
            WHEN ru.last_ok_run IS NULL THEN 'EN_VERIFICACION'::text
            ELSE 'SIN_FILAS'::text
        END AS estados_coverage_status,
    now()::date - lr.last_ingest::date AS days_since_ingest,
    rc.act_count,
    rc.publication_count
   FROM base b
     JOIN scoped sc ON sc.work_item_id = b.id
     LEFT JOIN last_row lr ON lr.work_item_id = b.id
     LEFT JOIN row_counts rc ON rc.work_item_id = b.id
     LEFT JOIN last_run ru ON ru.work_item_id = b.id
     LEFT JOIN attempts at ON at.work_item_id = b.id;;
CREATE TEMP VIEW coverage_after AS
WITH base AS (
         SELECT w.id,
            w.radicado,
            w.workflow_type,
            w.organization_id,
            w.owner_id,
            w.monitoring_enabled,
            w.status,
            w.lifecycle_state,
            provider_chain_for_workflow(w.workflow_type::text) AS expected_providers
           FROM work_items w
          WHERE w.status = 'ACTIVE'::item_status AND w.lifecycle_state = 'ACTIVE'::work_item_lifecycle_state AND w.deleted_at IS NULL
        ), scoped AS (
         SELECT b_1.id AS work_item_id,
            ARRAY( SELECT p.p
                   FROM unnest(b_1.expected_providers) p(p)
                  WHERE provider_scope(p.p) = 'ACTS'::text) AS expected_acts,
            ARRAY( SELECT p.p
                   FROM unnest(b_1.expected_providers) p(p)
                  WHERE provider_scope(p.p) <> 'ACTS'::text) AS expected_estados
           FROM base b_1
        ), act_stats AS (
         SELECT a.work_item_id, count(*) AS act_count, max(a.created_at) AS last_act
           FROM public.work_item_acts a JOIN base b ON b.id=a.work_item_id
          WHERE a.is_archived IS NOT TRUE GROUP BY a.work_item_id
        ), publication_stats AS (
         SELECT p.work_item_id, count(*) AS publication_count, max(p.created_at) AS last_publication
           FROM public.work_item_publicaciones p JOIN base b ON b.id=p.work_item_id
          WHERE p.is_archived IS NOT TRUE GROUP BY p.work_item_id
        ), last_row AS (
         SELECT b.id AS work_item_id, greatest(a.last_act,p.last_publication) AS last_ingest
           FROM base b LEFT JOIN act_stats a ON a.work_item_id=b.id
           LEFT JOIN publication_stats p ON p.work_item_id=b.id
        ), row_counts AS (
         SELECT b.id AS work_item_id, coalesce(a.act_count,0::bigint) AS act_count,
                coalesce(p.publication_count,0::bigint) AS publication_count
           FROM base b LEFT JOIN act_stats a ON a.work_item_id=b.id
           LEFT JOIN publication_stats p ON p.work_item_id=b.id
        ), last_run AS (
         SELECT r.work_item_id,
            max(r.created_at) FILTER (WHERE r.status = ANY (ARRAY['SUCCESS'::text, 'PARTIAL'::text])) AS last_ok_run,
            max(r.created_at) AS last_run
           FROM public.external_sync_runs r JOIN base b ON b.id=r.work_item_id
          GROUP BY r.work_item_id
        ), attempts AS (
         SELECT x.work_item_id,
            array_agg(DISTINCT lower(x.attempt ->> 'provider'::text)) AS providers
           FROM ( SELECT r.work_item_id,
                    jsonb_array_elements(
                        CASE
                            WHEN jsonb_typeof(r.provider_attempts) = 'array'::text THEN r.provider_attempts
                            ELSE '[]'::jsonb
                        END) AS attempt
                   FROM public.external_sync_runs r JOIN base b ON b.id=r.work_item_id
                  WHERE r.created_at > (now() - '30 days'::interval)) x
          WHERE (x.attempt ->> 'provider'::text) IS NOT NULL
          GROUP BY x.work_item_id
        )
 SELECT b.id AS work_item_id,
    b.radicado,
    b.workflow_type::text AS workflow_type,
    b.organization_id,
    b.owner_id,
    b.monitoring_enabled,
    b.expected_providers,
    sc.expected_acts AS expected_acts_providers,
    sc.expected_estados AS expected_estados_providers,
    COALESCE(at.providers, ARRAY[]::text[]) AS enrolled_providers,
    ARRAY( SELECT unnest(b.expected_providers) AS unnest
        EXCEPT
         SELECT unnest(COALESCE(at.providers, ARRAY[]::text[])) AS unnest) AS missing_providers,
    ARRAY( SELECT unnest(sc.expected_acts) AS unnest
        EXCEPT
         SELECT unnest(COALESCE(at.providers, ARRAY[]::text[])) AS unnest) AS missing_acts_providers,
    ARRAY( SELECT unnest(sc.expected_estados) AS unnest
        EXCEPT
         SELECT unnest(COALESCE(at.providers, ARRAY[]::text[])) AS unnest) AS missing_estados_providers,
    lr.last_ingest,
    ru.last_ok_run,
    ru.last_run,
        CASE
            WHEN b.radicado IS NULL OR length(regexp_replace(b.radicado, '\D'::text, ''::text, 'g'::text)) < 21 THEN 'SIN_RADICADO_VALIDO'::text
            WHEN COALESCE(array_length(at.providers, 1), 0) = 0 THEN 'SIN_ENROLAMIENTO'::text
            WHEN array_length(ARRAY( SELECT unnest(b.expected_providers) AS unnest
            EXCEPT
             SELECT unnest(COALESCE(at.providers, ARRAY[]::text[])) AS unnest), 1) > 0 THEN 'ENROLAMIENTO_PARCIAL'::text
            WHEN rc.act_count = 0 AND rc.publication_count = 0 AND ru.last_ok_run IS NOT NULL THEN 'LEIDO_Y_VACIO'::text
            ELSE 'OK'::text
        END AS coverage_status,
        CASE
            WHEN b.radicado IS NULL OR length(regexp_replace(b.radicado, '\D'::text, ''::text, 'g'::text)) < 21 THEN 'SIN_RADICADO_VALIDO'::text
            WHEN COALESCE(array_length(sc.expected_acts, 1), 0) = 0 THEN 'SIN_CANAL'::text
            WHEN array_length(ARRAY( SELECT unnest(sc.expected_acts) AS unnest
            EXCEPT
             SELECT unnest(COALESCE(at.providers, ARRAY[]::text[])) AS unnest), 1) > 0 THEN 'SIN_ENROLAMIENTO'::text
            WHEN rc.act_count > 0 THEN 'CUBIERTO'::text
            WHEN ru.last_ok_run IS NULL THEN 'EN_VERIFICACION'::text
            ELSE 'SIN_FILAS'::text
        END AS acts_coverage_status,
        CASE
            WHEN b.radicado IS NULL OR length(regexp_replace(b.radicado, '\D'::text, ''::text, 'g'::text)) < 21 THEN 'SIN_RADICADO_VALIDO'::text
            WHEN COALESCE(array_length(sc.expected_estados, 1), 0) = 0 THEN 'SIN_CANAL'::text
            WHEN array_length(ARRAY( SELECT unnest(sc.expected_estados) AS unnest
            EXCEPT
             SELECT unnest(COALESCE(at.providers, ARRAY[]::text[])) AS unnest), 1) > 0 THEN 'SIN_ENROLAMIENTO'::text
            WHEN rc.publication_count > 0 THEN 'CUBIERTO'::text
            WHEN ru.last_ok_run IS NULL THEN 'EN_VERIFICACION'::text
            ELSE 'SIN_FILAS'::text
        END AS estados_coverage_status,
    now()::date - lr.last_ingest::date AS days_since_ingest,
    rc.act_count,
    rc.publication_count
   FROM base b
     JOIN scoped sc ON sc.work_item_id = b.id
     LEFT JOIN last_row lr ON lr.work_item_id = b.id
     LEFT JOIN row_counts rc ON rc.work_item_id = b.id
     LEFT JOIN last_run ru ON ru.work_item_id = b.id
     LEFT JOIN attempts at ON at.work_item_id = b.id;;
DO $$ BEGIN
  IF EXISTS ((SELECT * FROM coverage_before EXCEPT ALL SELECT * FROM coverage_after)
    UNION ALL (SELECT * FROM coverage_after EXCEPT ALL SELECT * FROM coverage_before)) THEN
    RAISE EXCEPTION 'Coverage optimization changes results';
  END IF;
END $$;
EXPLAIN (ANALYZE, BUFFERS, TIMING OFF) SELECT * FROM coverage_before;
EXPLAIN (ANALYZE, BUFFERS, TIMING OFF) SELECT * FROM coverage_after;
ROLLBACK;
