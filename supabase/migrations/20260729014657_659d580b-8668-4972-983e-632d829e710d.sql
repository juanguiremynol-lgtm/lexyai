CREATE OR REPLACE FUNCTION public.classify_email_evidence_subtype(p_subject text, p_sender text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $fn$
  SELECT CASE
    WHEN NOT public.is_judicial_email_sender(p_sender) THEN NULL
    WHEN COALESCE(p_subject,'') ~* '^(respuesta autom[aá]tica|automatic reply|acuse)' THEN 'ACUSE_AUTOMATICO'
    WHEN COALESCE(p_subject,'') ~* 'token validaci[oó]n|se le ha compartido informaci[oó]n de proceso|acceso a informaci[oó]n de proceso' THEN 'ACCESO_EXPEDIENTE'
    WHEN COALESCE(p_subject,'') ~* 'acta *(de +)?reparto' THEN 'ACTA_REPARTO'
    WHEN COALESCE(p_subject,'') ~* 'inadmit|inadmisi[oó]n|rechaza' THEN 'INADMISION'
    WHEN COALESCE(p_subject,'') ~* 'admite|auto admisorio|admisi[oó]n' THEN 'AUTO_ADMISORIO'
    WHEN COALESCE(p_subject,'') ~* 'estado electr[oó]nico|fija[a-z]* +(el +)?estado' THEN 'FIJACION_ESTADO'
    WHEN COALESCE(p_subject,'') ~* 'desistimiento' THEN 'DESISTIMIENTO'
    WHEN COALESCE(p_subject,'') ~* 'fallo|sentencia|niega|concede|resuelve|tutela +amparo' THEN 'FALLO_SENTENCIA'
    WHEN COALESCE(p_subject,'') ~* 'traslado' THEN 'TRASLADO'
    WHEN COALESCE(p_subject,'') ~* 'requerimiento|requiere' THEN 'REQUERIMIENTO'
    WHEN COALESCE(p_subject,'') ~* 'audiencia|diligencia' THEN 'CITACION_AUDIENCIA'
    WHEN COALESCE(p_subject,'') ~* 'notifica[a-z]*.*(proceso|curador|personal|demanda)|curador ad litem' THEN 'NOTIFICACION_PERSONAL'
    ELSE 'OTRO_JUDICIAL'
  END
$fn$;

CREATE OR REPLACE FUNCTION public.email_subtype_label(p_subtype text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $fn$
  SELECT CASE p_subtype
    WHEN 'AUTO_ADMISORIO' THEN 'Auto admisorio' WHEN 'INADMISION' THEN 'Inadmisión'
    WHEN 'TRASLADO' THEN 'Traslado' WHEN 'REQUERIMIENTO' THEN 'Requerimiento'
    WHEN 'CITACION_AUDIENCIA' THEN 'Citación a audiencia' WHEN 'FALLO_SENTENCIA' THEN 'Fallo / sentencia'
    WHEN 'FIJACION_ESTADO' THEN 'Fijación en estado' WHEN 'DESISTIMIENTO' THEN 'Desistimiento'
    WHEN 'ACTA_REPARTO' THEN 'Acta de reparto' WHEN 'NOTIFICACION_PERSONAL' THEN 'Notificación personal'
    WHEN 'ACCESO_EXPEDIENTE' THEN 'Acceso a expediente' WHEN 'ACUSE_AUTOMATICO' THEN 'Acuse automático'
    WHEN 'OTRO_JUDICIAL' THEN 'Comunicación judicial'
    ELSE COALESCE(p_subtype,'Correo') END
$fn$;

UPDATE public.work_item_email_links
SET evidence_subtype = public.classify_email_evidence_subtype(subject, sender),
    low_content = CASE WHEN public.classify_email_evidence_subtype(subject, sender) = 'ACUSE_AUTOMATICO'
                       THEN true ELSE low_content END
WHERE direction = 'received';

INSERT INTO public.work_item_email_link_effects
  (link_id, work_item_id, user_id, organization_id, effect_type, target_table, target_id, label)
SELECT lnk.id, d.work_item_id, lnk.user_id, lnk.organization_id, 'DEADLINE_SATISFIED',
       'work_item_deadlines', d.id, 'Satisfizo término: ' || d.label
FROM public.work_item_deadlines d
JOIN public.work_item_email_links lnk
  ON lnk.id = (d.calculation_meta #>> '{email_evidence,link_id}')::uuid
WHERE d.status = 'FULFILLED_BY_EMAIL_EVIDENCE'
ON CONFLICT DO NOTHING;