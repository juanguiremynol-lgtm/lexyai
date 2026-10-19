-- Retain source identity in older descriptors whose token is only in the source URL. No row DML.
CREATE OR REPLACE FUNCTION public.act_samai_grant_token(doc jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE token text:=NULLIF(doc->>'tokenDocumento',''); source_url text; field text;
BEGIN
 IF token IS NOT NULL THEN RETURN token; END IF;
 FOREACH field IN ARRAY ARRAY['urlDescargaOriginal','url_origen','urlDescarga','url','urlVerOriginal','urlVer'] LOOP
  source_url:=doc->>field;
  IF source_url ~* '^https://samaicore\.consejodeestado\.gov\.co/' THEN
   token:=substring(source_url FROM '(?i)[?&](?:tokendoc|tokenDocumento)=([^&#]+)');
   IF token IS NOT NULL THEN RETURN regexp_replace(regexp_replace(token,'%2c',',','gi'),'%2e','.','gi'); END IF;
  END IF;
 END LOOP;
 RETURN doc->>'id';
END;
$$;
CREATE OR REPLACE FUNCTION public.act_samai_grant_identity(doc jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE token text:=public.act_samai_grant_token(doc); parts text[]; payload jsonb; encoded text; label text;
BEGIN
 parts:=regexp_split_to_array(token,'[,.]');
 IF cardinality(parts)<>3 THEN RETURN NULL; END IF;
 encoded:=translate(parts[2],'-_','+/');
 payload:=convert_from(decode(encoded||repeat('=',(4-length(encoded)%4)%4),'base64'),'UTF8')::jsonb;
 label:=btrim(COALESCE(NULLIF(doc->>'descripcion',''),doc->>'nombre',''));
 IF COALESCE(payload->>'r','') !~ '^\d{23}$' OR COALESCE(payload->>'h','') !~ '^[a-fA-F0-9]{64}$' OR label='' OR (NULLIF(doc->>'radicado','') IS NOT NULL AND doc->>'radicado'<>payload->>'r') THEN RETURN NULL; END IF;
 RETURN jsonb_build_array(payload->>'r',upper(payload->>'h'),COALESCE(payload->>'dt',''),COALESCE(payload->>'c',''),COALESCE(payload->>'d',''),COALESCE(payload->>'cu',''),label);
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END;
$$;
CREATE OR REPLACE FUNCTION public.act_same_samai_grant(a jsonb,b jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE left_key jsonb:=public.act_samai_grant_identity(a); right_key jsonb:=public.act_samai_grant_identity(b);
BEGIN
 IF left_key IS NULL OR right_key IS NULL THEN RETURN NULL; END IF;
 IF EXISTS (SELECT 1 FROM unnest(ARRAY['solicitud','indice_actuacion']) k WHERE NULLIF(a->>k,'') IS NOT NULL AND NULLIF(b->>k,'') IS NOT NULL AND regexp_replace(a->>k,'^0+(?=\d)','')<>regexp_replace(b->>k,'^0+(?=\d)','')) THEN RETURN false; END IF;
 IF NULLIF(a->>'id','') IS NOT NULL AND NULLIF(b->>'id','') IS NOT NULL AND a->>'id' IS DISTINCT FROM public.act_samai_grant_token(a) AND b->>'id' IS DISTINCT FROM public.act_samai_grant_token(b) AND a->>'id'<>b->>'id' THEN RETURN false; END IF;
 RETURN left_key=right_key;
END;
$$;
