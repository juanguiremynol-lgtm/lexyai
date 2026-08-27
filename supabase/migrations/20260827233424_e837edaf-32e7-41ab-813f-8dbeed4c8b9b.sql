-- YY3 — the thirteen recovered providencias, surfaced ONCE as reconciliation.
-- No term is derived, no alert is raised: this is a report, not a trigger.
INSERT INTO public.digest_reconciliation_notices
  (owner_id, organization_id, work_item_id, notice_key, headline, detail, rows_count, from_date, to_date)
SELECT w.owner_id, w.organization_id, w.id,
       'YY3_RETIRO_RECUPERACION_' || w.id::text,
       'Estados recuperados de ' || COALESCE(public.despacho_name_observed('056074089001'), 'el despacho 056074089001'),
       'Estas publicaciones ya existían en el despacho y no habían sido leídas por una degradación del canal de estados, corregida el 2026-08-26. '
       || 'Se incorporaron al expediente sin derivar términos ni alertas: revíselas y, si alguna abre un término, regístrelo usted. '
       || 'Este aviso se muestra una sola vez.',
       count(p.id)::int,
       min(p.fecha_fijacion)::date,
       max(p.fecha_fijacion)::date
  FROM public.work_items w
  JOIN public.work_item_publicaciones p ON p.work_item_id = w.id AND p.is_archived = false
 WHERE LEFT(regexp_replace(COALESCE(w.radicado,''), '\D', '', 'g'), 12) = '056074089001'
   AND w.deleted_at IS NULL
 GROUP BY w.owner_id, w.organization_id, w.id
ON CONFLICT (owner_id, notice_key) DO NOTHING;