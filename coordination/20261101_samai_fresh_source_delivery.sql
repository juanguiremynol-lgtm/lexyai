-- Five certified native reads exist today; replay only their normal consumer.
-- No new court query, queue counter reset, daily gate override or judicial SQL.
BEGIN;
CREATE TABLE IF NOT EXISTS public.samai_delivery_acceptance_20261101(
 work_item_id uuid PRIMARY KEY,radicado text NOT NULL,native_run_id bigint NOT NULL,
 source_read_at timestamptz NOT NULL,act_ids_before jsonb NOT NULL,
 admitted_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.samai_delivery_acceptance_20261101 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.samai_delivery_acceptance_20261101 FROM PUBLIC,anon,authenticated,service_role;
WITH expected(work_item_id,radicado,native_run_id,source_read_at) AS (VALUES
 ('2a590db7-0330-4b8d-9403-5963e4bd15a1'::uuid,'05001233300020240115300',1528,'2026-11-01T07:39:58.581938Z'::timestamptz),
 ('6153c00f-4e3f-4ee8-aad2-064693ac3bb2'::uuid,'05001333301520260011300',1529,'2026-11-01T07:41:00.920443Z'::timestamptz),
 ('8dedc53e-c047-4976-9800-41ced849df92'::uuid,'05001333300320190025201',1530,'2026-11-01T07:41:21.510735Z'::timestamptz),
 ('c179889b-c3c1-42fb-afc2-d7cc4eea1d84'::uuid,'05001333303320240007800',1523,'2026-11-01T07:25:20.204633Z'::timestamptz),
 ('e4e761ac-9984-462d-ae6e-a25b244f79ea'::uuid,'05001333301020230019900',1524,'2026-11-01T07:32:44.214065Z'::timestamptz)
), audit AS (
 INSERT INTO samai_delivery_acceptance_20261101(work_item_id,radicado,native_run_id,source_read_at,act_ids_before)
 SELECT w.id,w.radicado,x.native_run_id,x.source_read_at,
 coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'fingerprint',a.hash_fingerprint) ORDER BY a.id)
 FROM work_item_acts a WHERE a.work_item_id=w.id),'[]')
 FROM expected x JOIN work_items w ON w.id=x.work_item_id AND w.radicado=x.radicado
 WHERE w.lifecycle_state='ACTIVE' AND w.monitoring_enabled AND w.deleted_at IS NULL
 AND x.source_read_at>now()-interval '24 hours' AND x.source_read_at<=now()
 AND EXISTS(SELECT 1 FROM work_item_provider_enrollment e WHERE e.work_item_id=w.id
 AND e.provider_key='samai' AND e.enabled AND e.scope='ACTS')
 AND NOT EXISTS(SELECT 1 FROM atenia_ai_remediation_queue q WHERE q.work_item_id=w.id
 AND q.action_type='RETRY_ACTS' AND q.status='RUNNING')
 ON CONFLICT DO NOTHING RETURNING work_item_id
)
SELECT work_item_id,net.http_post(
 url:=(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='SUPABASE_URL')||'/functions/v1/sync-by-work-item',
 headers:=jsonb_build_object('Content-Type','application/json','x-cron-key',
 (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='CRON_SERVICE_KEY'),
 'x-invoker-function','fresh-samai-delivery-acceptance-20261101'),
 body:=jsonb_build_object('work_item_id',work_item_id,'force_refresh',false,'_scheduled',true),
 timeout_milliseconds:=180000) AS request_id FROM audit;
COMMIT;
