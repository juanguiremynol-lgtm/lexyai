CREATE OR REPLACE FUNCTION public.classify_email_evidence_subtype(p_subject text, p_sender text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN NOT public.is_judicial_email_sender(p_sender) THEN NULL
    WHEN COALESCE(p_subject,'') ~* '^(respuesta autom[aá]tica|automatic reply|acuse)' THEN 'ACUSE_AUTOMATICO'
    WHEN COALESCE(p_subject,'') ~* 'token validaci[oó]n|se le ha compartido informaci[oó]n de proceso|acceso a informaci[oó]n de proceso' THEN 'ACCESO_EXPEDIENTE'
    WHEN COALESCE(p_subject,'') ~* 'acta *(de +)?reparto' THEN 'ACTA_REPARTO'
    WHEN COALESCE(p_subject,'') ~* '(rechaz[a-zóo]*|remi[st][a-zóo]*|remisi[oó]n|env[ií]a|conflicto)[^.]{0,60}(de +)?competencia|competencia[^.]{0,40}(rechaz|remi)' THEN 'RECHAZO_COMPETENCIA'
    WHEN COALESCE(p_subject,'') ~* 'inadmit|inadmisi[oó]n|so pena de rechazo|t[eé]rmino para subsanar|para subsanar' THEN 'INADMISION'
    -- Penal (Ley 906/2004): vocabulario propio, evaluado antes de los actos
    -- civiles porque comparte palabras ("admite", "traslado", "audiencia de...").
    WHEN COALESCE(p_subject,'') ~* 'preclusi[oó]n|precluye' THEN 'PRECLUSION'
    WHEN COALESCE(p_subject,'') ~* 'allanamiento( +a +(los +)?cargos)?|aceptaci[oó]n +de +(los +)?cargos' THEN 'ALLANAMIENTO'
    WHEN COALESCE(p_subject,'') ~* 'preacuerdo|negociaci[oó]n +con +la +fiscal[ií]a|sentencia +anticipada' THEN 'PREACUERDO'
    WHEN COALESCE(p_subject,'') ~* 'medida +de +aseguramiento|detenci[oó]n +preventiva|imposici[oó]n +de +medida' THEN 'MEDIDA_ASEGURAMIENTO'
    WHEN COALESCE(p_subject,'') ~* 'escrito +de +acusaci[oó]n|traslado +(del +)?escrito +de +acusaci[oó]n' THEN 'ESCRITO_ACUSACION'
    WHEN COALESCE(p_subject,'') ~* '(audiencia|formulaci[oó]n) +de +acusaci[oó]n|acusaci[oó]n +(formulada|presentada|radicada)' THEN 'ACUSACION'
    WHEN COALESCE(p_subject,'') ~* 'formulaci[oó]n +de +imputaci[oó]n|imputaci[oó]n|legalizaci[oó]n +de +captura' THEN 'IMPUTACION'
    WHEN COALESCE(p_subject,'') ~* 'admite|auto admisorio|admisi[oó]n' THEN 'AUTO_ADMISORIO'
    WHEN COALESCE(p_subject,'') ~* 'estado electr[oó]nico|fija[a-z]* +(el +)?estado' THEN 'FIJACION_ESTADO'
    WHEN COALESCE(p_subject,'') ~* 'desistimiento' THEN 'DESISTIMIENTO'
    WHEN COALESCE(p_subject,'') ~* 'concede\s+(la\s+|el\s+|los\s+|las\s+)?(impugnaci[óo]n|apelaci[óo]n|recurso|recursos|alzada)' THEN 'RECURSO_CONCEDIDO'
    WHEN COALESCE(p_subject,'') ~* 'fallo|sentencia|resuelve|tutela +amparo|(niega|concede)\s+(el\s+|la\s+|las\s+|los\s+)?(amparo|tutela|pretensi[óo]n|pretensiones)' THEN 'FALLO_SENTENCIA'
    WHEN COALESCE(p_subject,'') ~* 'traslado' THEN 'TRASLADO'
    WHEN COALESCE(p_subject,'') ~* 'requerimiento|requiere' THEN 'REQUERIMIENTO'
    WHEN COALESCE(p_subject,'') ~* 'audiencia|diligencia' THEN 'CITACION_AUDIENCIA'
    WHEN COALESCE(p_subject,'') ~* 'notifica[a-z]*.*(proceso|curador|personal|demanda)|curador ad litem' THEN 'NOTIFICACION_PERSONAL'
    ELSE 'OTRO_JUDICIAL'
  END
$function$;

CREATE OR REPLACE FUNCTION public.email_subtype_label(p_subtype text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE p_subtype
    WHEN 'AUTO_ADMISORIO' THEN 'Auto admisorio' WHEN 'INADMISION' THEN 'Inadmisión'
    WHEN 'RECHAZO_COMPETENCIA' THEN 'Rechazo por competencia'
    WHEN 'TRASLADO' THEN 'Traslado' WHEN 'REQUERIMIENTO' THEN 'Requerimiento'
    WHEN 'CITACION_AUDIENCIA' THEN 'Citación a audiencia' WHEN 'FALLO_SENTENCIA' THEN 'Fallo / sentencia'
    WHEN 'RECURSO_CONCEDIDO' THEN 'Recurso concedido'
    WHEN 'ACTA_REPARTO' THEN 'Acta de reparto' WHEN 'FIJACION_ESTADO' THEN 'Fijación en estado'
    WHEN 'DESISTIMIENTO' THEN 'Desistimiento' WHEN 'NOTIFICACION_PERSONAL' THEN 'Notificación personal'
    WHEN 'ACCESO_EXPEDIENTE' THEN 'Acceso a expediente' WHEN 'ACUSE_AUTOMATICO' THEN 'Acuse automático'
    WHEN 'IMPUTACION' THEN 'Formulación de imputación'
    WHEN 'MEDIDA_ASEGURAMIENTO' THEN 'Medida de aseguramiento'
    WHEN 'ESCRITO_ACUSACION' THEN 'Escrito de acusación'
    WHEN 'ACUSACION' THEN 'Audiencia de formulación de acusación'
    WHEN 'ALLANAMIENTO' THEN 'Allanamiento a cargos'
    WHEN 'PREACUERDO' THEN 'Preacuerdo'
    WHEN 'PRECLUSION' THEN 'Preclusión'
    ELSE 'Comunicación judicial' END
$function$;

CREATE OR REPLACE FUNCTION public.email_subtype_stage(p_workflow text, p_subtype text, p_subject text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN p_subtype = 'ACTA_REPARTO' THEN CASE p_workflow
      WHEN 'CGP' THEN 'RADICADO_CONFIRMED' WHEN 'CPACA' THEN 'DEMANDA_RADICADA'
      WHEN 'TUTELA' THEN 'TUTELA_RADICADA' ELSE 'RADICACION' END
    -- Penal (Ley 906): etapas propias del sistema acusatorio.
    WHEN p_subtype = 'IMPUTACION' THEN 'IMPUTACION'
    WHEN p_subtype = 'MEDIDA_ASEGURAMIENTO' THEN 'MEDIDA_ASEGURAMIENTO'
    WHEN p_subtype = 'ESCRITO_ACUSACION' THEN 'ESCRITO_ACUSACION'
    WHEN p_subtype = 'ACUSACION' THEN 'AUDIENCIA_ACUSACION'
    WHEN p_subtype IN ('ALLANAMIENTO','PREACUERDO') THEN 'SENTENCIA'
    WHEN p_subtype = 'PRECLUSION' THEN 'PRECLUSION'
    WHEN p_subtype = 'AUTO_ADMISORIO' THEN CASE p_workflow
      WHEN 'CGP' THEN 'AUTO_ADMISORIO' WHEN 'CPACA' THEN 'AUTO_ADMISORIO'
      WHEN 'TUTELA' THEN 'TUTELA_ADMITIDA' ELSE 'AUTO_ADMISORIO' END
    WHEN p_subtype = 'INADMISION' THEN 'SUBSANACION'
    WHEN p_subtype = 'TRASLADO' THEN CASE p_workflow
      WHEN 'CPACA' THEN 'TRASLADO_EXCEPCIONES' WHEN 'CGP' THEN 'EXCEPCIONES_PREVIAS' ELSE 'TRASLADO_DEMANDA' END
    WHEN p_subtype = 'CITACION_AUDIENCIA' THEN CASE
      WHEN p_workflow = 'PENAL_906' AND COALESCE(p_subject,'') ~* 'preparatoria' THEN 'PREPARATORIA'
      WHEN p_workflow = 'PENAL_906' AND COALESCE(p_subject,'') ~* 'juicio|concentrada' THEN 'JUICIO_ORAL'
      WHEN p_workflow = 'PENAL_906' AND COALESCE(p_subject,'') ~* 'acusaci[oó]n' THEN 'AUDIENCIA_ACUSACION'
      WHEN COALESCE(p_subject,'') ~* 'pruebas' THEN CASE p_workflow WHEN 'CGP' THEN 'AUDIENCIA_INSTRUCCION' ELSE 'AUDIENCIA_PRUEBAS' END
      ELSE 'AUDIENCIA_INICIAL' END
    WHEN p_subtype = 'RECURSO_CONCEDIDO' THEN CASE p_workflow
      WHEN 'TUTELA' THEN 'FALLO_SEGUNDA_INSTANCIA' ELSE 'RECURSOS' END
    WHEN p_subtype = 'FALLO_SENTENCIA' THEN CASE p_workflow
      WHEN 'CGP' THEN 'ALEGATOS_SENTENCIA' WHEN 'CPACA' THEN 'ALEGATOS_SENTENCIA'
      WHEN 'TUTELA' THEN 'FALLO_PRIMERA_INSTANCIA'
      WHEN 'PENAL_906' THEN 'SENTENCIA'
      ELSE 'ALEGATOS_SENTENCIA' END
    ELSE NULL
  END
$function$;