CREATE OR REPLACE FUNCTION public.provider_outcome_bucket(p_code text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN COALESCE(NULLIF(TRIM(p_code), ''), '') = '' THEN 'DESCONOCIDO'
    -- JJ1: codes emitted by the estados reader itself. A category we cannot
    -- name and an unrecognisable page are OUR failures: they may never be
    -- counted as a confirmed read and may never support a negative pole.
    WHEN UPPER(p_code) IN ('CATEGORIA_NO_RECONOCIDA','INDETERMINADO','CATEGORY_NOT_RECOGNISED')
      THEN 'DESCONOCIDO'
    -- JJ1: the portal answered in plain text that there is nothing under the
    -- selected filters. Earned empty, not manufactured silence.
    WHEN UPPER(p_code) IN ('SIN_PUBLICACIONES','SUCCESS_EMPTY') THEN 'VACIO'
    WHEN UPPER(p_code) IN ('CON_PUBLICACIONES') THEN 'CON_DATOS'
    WHEN UPPER(p_code) LIKE 'ROUTING_SKIP%'
      OR UPPER(p_code) LIKE 'SKIP%'
      OR UPPER(p_code) IN ('NOT_APPLICABLE','NO_APLICA') THEN 'NO_APLICA'
    WHEN UPPER(p_code) IN ('PROCESO_PRIVADO','RESTRICTED_BY_PROVIDER','NOT_FOUND','PROVIDER_NOT_FOUND','RADICADO_NOT_FOUND','PROCESO_NO_ENCONTRADO_EN_PROVEEDOR')
      THEN 'SIN_COBERTURA'
    WHEN UPPER(p_code) LIKE '%WITH_DATA%' OR UPPER(p_code) IN ('SUCCESS','OK','PARTIAL') THEN 'CON_DATOS'
    WHEN UPPER(p_code) LIKE '%EMPTY%' THEN 'VACIO'
    WHEN UPPER(p_code) LIKE 'PENDING%' OR UPPER(p_code) IN ('NO_DATA','SCRAPING_INITIATED') THEN 'EN_CURSO'
    WHEN UPPER(p_code) LIKE '%FAIL%' OR UPPER(p_code) LIKE '%ERROR%'
      OR UPPER(p_code) IN ('TIMEOUT','UNAVAILABLE','CONTRACT_MISMATCH','PARSE_MISMATCH') THEN 'FALLO'
    ELSE 'DESCONOCIDO'
  END
$$;

GRANT EXECUTE ON FUNCTION public.provider_outcome_bucket(text) TO authenticated, service_role, anon;