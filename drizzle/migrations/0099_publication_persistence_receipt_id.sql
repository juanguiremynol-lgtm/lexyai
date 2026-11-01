-- Add a persistence receipt ID without changing matching, stored fingerprints,
-- judicial fields, triggers, privileges or publication uniqueness.
DO $migration$
DECLARE d text;
BEGIN
 SELECT pg_get_functiondef('public.rpc_upsert_work_item_publicaciones(jsonb)'::regprocedure) INTO d;
 IF position('persisted_publicacion_id' IN d)>0 THEN RETURN; END IF;
 IF position('v_enriched boolean;' IN d)=0
   OR position('v_structural_hit := false;' IN d)=0
   OR position('COALESCE(NULLIF(rec->>''instancia_grado'',''''),''PRIMERA'')' IN d)=0
   OR position('WHERE id = v_existing.id;' IN d)=0
   OR position('''parsed_count'', parsed_count,' IN d)=0 THEN
   RAISE EXCEPTION 'Publication RPC changed: review receipt patch before deployment';
 END IF;
 d := replace(d,'v_enriched boolean;','v_enriched boolean; v_persisted_publicacion_id uuid;');
 d := replace(d,'v_structural_hit := false;','v_persisted_publicacion_id := NULL; v_structural_hit := false;');
 d := replace(d,E'COALESCE(NULLIF(rec->>''instancia_grado'',''''),''PRIMERA'')\n        );',
 E'COALESCE(NULLIF(rec->>''instancia_grado'',''''),''PRIMERA'')\n        ) RETURNING id INTO v_persisted_publicacion_id;');
 IF position(') RETURNING id INTO v_persisted_publicacion_id;' IN d)=0 THEN
   RAISE EXCEPTION 'Publication INSERT shape changed; no function was replaced';
 END IF;
 d := replace(d,'WHERE id = v_existing.id;',
   'WHERE id = v_existing.id RETURNING id INTO v_persisted_publicacion_id;');
 d := replace(d,'''parsed_count'', parsed_count,',
   '''persisted_publicacion_id'', CASE WHEN parsed_count=1 AND error_count=0 AND rejected_count=0 THEN v_persisted_publicacion_id ELSE NULL END, ''parsed_count'', parsed_count,');
 EXECUTE d;
END $migration$;