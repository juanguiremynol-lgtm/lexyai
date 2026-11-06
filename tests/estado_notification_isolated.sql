BEGIN;
CREATE TEMP TABLE work_items (id uuid PRIMARY KEY, radicado text) ON COMMIT DROP;
CREATE TEMP TABLE notifications (id uuid DEFAULT gen_random_uuid() PRIMARY KEY, user_id uuid, work_item_id uuid,
 type text, title text, body text, metadata jsonb, created_at timestamptz DEFAULT now(), dismissed_at timestamptz,
 dedupe_key text) ON COMMIT DROP;
CREATE TEMP TABLE trigger_error_log (trigger_name text, table_name text, error_message text, sqlstate text, work_item_id uuid) ON COMMIT DROP;
CREATE TEMP TABLE test_publicaciones (work_item_id uuid, raw_data jsonb, discovery_type text, fecha_fijacion timestamptz,
 title text, hash_fingerprint text, tipo_publicacion text) ON COMMIT DROP;
CREATE FUNCTION pg_temp.test_recipients(uuid) RETURNS TABLE(recipient_id uuid) LANGUAGE sql AS $$
 SELECT '11111111-1111-4111-8111-111111111111'::uuid
$$;
CREATE FUNCTION pg_temp.test_key(text,text,text) RETURNS text LANGUAGE sql AS $$ SELECT concat_ws(':',$1,$2,$3) $$;
CREATE FUNCTION pg_temp.test_insert_notification(text,uuid,text,text,text,text,text,jsonb,text,text,uuid)
 RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 INSERT INTO pg_temp.notifications (user_id,work_item_id,type,title,body,metadata,dedupe_key)
 VALUES ($2,$11,$4,$5,$6,$8,$9); END $$;

-- Clone the installed trigger into the temporary schema, substituting only
-- its dependencies. The production function and tables are never written.
DO $test$ DECLARE candidate text; BEGIN
 candidate := pg_get_functiondef('public.notify_new_estado()'::regprocedure);
 candidate := replace(candidate, 'public.notify_new_estado()', 'pg_temp.test_notify()');
 candidate := replace(candidate, 'SET search_path TO ''public''', 'SET search_path TO ''pg_temp'', ''public''');
 candidate := replace(candidate, 'get_work_item_recipients(', 'pg_temp.test_recipients(');
 candidate := replace(candidate, 'insert_notification(', 'pg_temp.test_insert_notification(');
 candidate := replace(candidate, 'build_dedupe_key(', 'pg_temp.test_key(');
 EXECUTE candidate;
END $test$;

CREATE TRIGGER test_estado_alert AFTER INSERT ON test_publicaciones FOR EACH ROW EXECUTE FUNCTION pg_temp.test_notify();
INSERT INTO work_items VALUES ('22222222-2222-4222-8222-222222222222','05001400300120250012300');
INSERT INTO test_publicaciones VALUES
 ('22222222-2222-4222-8222-222222222222','{}','NOVEDAD','2026-11-06T12:00:00Z','Estado actual','fp1','Estado'),
 ('22222222-2222-4222-8222-222222222222','{"historical_replay":true}','HISTORICO_DETECTADO','2026-03-12T12:00:00Z','Estado histórico A','fp2','Estado'),
 ('22222222-2222-4222-8222-222222222222','{}','ACTUACION_RETROACTIVA','2026-03-12T12:00:00Z','Estado anterior','fp3','Estado'),
 ('22222222-2222-4222-8222-222222222222','{"historical_replay":true}','HISTORICO_DETECTADO','2026-03-13T12:00:00Z','Estado histórico B','fp4','Estado'),
 ('22222222-2222-4222-8222-222222222222','{}','NOVEDAD','2026-11-06T12:00:00Z','Otro estado actual','fp5','Estado');
DO $$ BEGIN
 IF (SELECT count(*) FROM notifications) <> 3 OR EXISTS (SELECT 1 FROM trigger_error_log) THEN
   RAISE EXCEPTION 'notification group count or trigger failure';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM notifications WHERE metadata->>'discovery_group'='historical'
   AND title LIKE 'Estado histórico incorporado%' AND body LIKE 'Se incorporaron 2 estados históricos%'
   AND metadata->>'historical_replay'='true') THEN RAISE EXCEPTION 'historical group incorrect'; END IF;
 IF NOT EXISTS (SELECT 1 FROM notifications WHERE metadata->>'discovery_group'='retroactive'
   AND title LIKE 'Estado anterior detectado%' AND body LIKE '%12/03/2026%') THEN RAISE EXCEPTION 'retroactive group incorrect'; END IF;
 IF NOT EXISTS (SELECT 1 FROM notifications WHERE metadata->>'discovery_group'='current'
   AND title LIKE 'Nuevo estado%' AND body LIKE 'Se detectaron 2 nuevos estados%') THEN RAISE EXCEPTION 'current group incorrect'; END IF;
END $$;
SELECT count(*) AS isolated_notification_groups,
       count(*) FILTER (WHERE metadata->>'discovery_group'='historical') AS historical_groups,
       count(*) FILTER (WHERE metadata->>'discovery_group'='current') AS current_groups,
       count(*) FILTER (WHERE metadata->>'discovery_group'='retroactive') AS retroactive_groups,
       (SELECT count(*) FROM trigger_error_log) AS trigger_errors
FROM notifications;
ROLLBACK;
