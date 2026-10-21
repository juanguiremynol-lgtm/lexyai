CREATE OR REPLACE FUNCTION public.retain_official_publication_recovery(
  previous jsonb, incoming jsonb, primary_url text
) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $$
DECLARE
  merged jsonb := CASE WHEN jsonb_typeof(incoming) = 'object' THEN incoming ELSE '{}'::jsonb END;
  retained jsonb := '[]'::jsonb;
  candidate jsonb;
  prior jsonb;
  prior_position integer;
  package_field text;
  enriched_package jsonb;
  recovery_list jsonb;
  layer jsonb;
BEGIN
  FOREACH layer IN ARRAY ARRAY[previous, incoming] LOOP
    recovery_list := CASE WHEN jsonb_typeof(layer->'recuperacion_oficial') = 'array'
      THEN layer->'recuperacion_oficial' ELSE '[]'::jsonb END;
    FOR candidate IN SELECT value FROM jsonb_array_elements(recovery_list) LOOP
      IF jsonb_typeof(candidate) = 'object'
        AND candidate->>'url' ~ '^https://publicacionesprocesales\.ramajudicial\.gov\.co/c/document_library/get_file\?'
        AND candidate->>'sha256' ~ '^[a-f0-9]{64}$'
        AND NULLIF(candidate->>'article_id', '') IS NOT NULL
        AND NULLIF(candidate->>'id_despacho', '') IS NOT NULL
        AND NULLIF(candidate->>'fecha', '') IS NOT NULL
      THEN
        prior_position := NULL;
        SELECT ord::integer - 1, value INTO prior_position, prior
          FROM jsonb_array_elements(retained) WITH ORDINALITY AS entries(value, ord)
          WHERE value->>'url' = candidate->>'url' AND value->>'sha256' = candidate->>'sha256'
          LIMIT 1;
        IF prior_position IS NULL THEN
          retained := retained || jsonb_build_array(candidate);
        ELSIF jsonb_typeof(candidate->'paquete') = 'object'
          AND prior->>'article_id' = candidate->>'article_id'
          AND prior->>'id_despacho' = candidate->>'id_despacho'
          AND prior->>'fecha' = candidate->>'fecha' THEN
          IF NOT (prior ? 'paquete') OR prior->'paquete' = 'null'::jsonb THEN
            prior := jsonb_set(prior, '{paquete}', candidate->'paquete');
          ELSIF jsonb_typeof(prior->'paquete') = 'object'
            AND NOT EXISTS (SELECT 1 FROM unnest(ARRAY['radicado', 'despacho_autor', 'id_despacho_autor', 'despacho_autor_nombre', 'publicador']) k
              WHERE NULLIF(prior #>> ARRAY['paquete', k], '') IS NOT NULL
                AND NULLIF(candidate #>> ARRAY['paquete', k], '') IS NOT NULL
                AND prior #>> ARRAY['paquete', k] <> candidate #>> ARRAY['paquete', k])
          THEN
            enriched_package := prior->'paquete';
            FOREACH package_field IN ARRAY ARRAY['radicado', 'paginas_caso', 'despacho_autor_nombre',
              'despacho_autor', 'id_despacho_autor', 'publicador', 'alcance', 'article_id', 'fecha',
              'verificado', 'paginas_total', 'metodo'] LOOP
              IF (NOT (enriched_package ? package_field) OR enriched_package->package_field = 'null'::jsonb)
                AND candidate->'paquete' ? package_field
                AND candidate #> ARRAY['paquete', package_field] <> 'null'::jsonb THEN
                enriched_package := jsonb_set(enriched_package, ARRAY[package_field], candidate #> ARRAY['paquete', package_field]);
              END IF;
            END LOOP;
            prior := jsonb_set(prior, '{paquete}', enriched_package);
          END IF;
          retained := jsonb_set(retained, ARRAY[prior_position::text], prior);
        END IF;
      END IF;
    END LOOP;
  END LOOP;
  IF jsonb_array_length(retained) = 0 THEN RETURN incoming; END IF;
  merged := jsonb_set(merged, '{recuperacion_oficial}', retained);
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(retained) r WHERE r->>'url' = primary_url) THEN
    merged := jsonb_set(merged, '{pdf_url}', to_jsonb(primary_url));
    IF merged ? 'planilla_sin_documento' OR merged->>'tipo' IN ('Estado Electrónico', 'ESTADO') THEN
      merged := jsonb_set(merged, '{planilla_sin_documento}', 'false'::jsonb);
    END IF;
    merged := jsonb_set(merged, '{clasificacion}',
      (CASE WHEN jsonb_typeof(merged->'clasificacion') = 'object' THEN merged->'clasificacion' ELSE '{}'::jsonb END)
      || '{"es_descargable":true}'::jsonb);
  END IF;
  RETURN merged;
END;
$$;

CREATE OR REPLACE FUNCTION public.preserve_official_publication_recovery()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE old_primary_attested boolean;
BEGIN
  IF OLD.source IS DISTINCT FROM 'publicaciones' OR NEW.source IS DISTINCT FROM OLD.source
    OR NEW.id IS DISTINCT FROM OLD.id
    OR NEW.work_item_id IS DISTINCT FROM OLD.work_item_id
    OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.hash_fingerprint IS DISTINCT FROM OLD.hash_fingerprint
    OR NEW.tipo_publicacion IS DISTINCT FROM OLD.tipo_publicacion THEN RETURN NEW; END IF;
  SELECT EXISTS (
    SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(OLD.raw_data->'recuperacion_oficial') = 'array'
      THEN OLD.raw_data->'recuperacion_oficial' ELSE '[]'::jsonb END) r
    WHERE r->>'url' = OLD.pdf_url
      AND r->>'url' ~ '^https://publicacionesprocesales\.ramajudicial\.gov\.co/c/document_library/get_file\?'
      AND r->>'sha256' ~ '^[a-f0-9]{64}$'
      AND NULLIF(r->>'article_id', '') IS NOT NULL
      AND NULLIF(r->>'id_despacho', '') IS NOT NULL
      AND NULLIF(r->>'fecha', '') IS NOT NULL
  ) INTO old_primary_attested;
  IF NULLIF(NEW.pdf_url, '') IS NULL AND old_primary_attested THEN NEW.pdf_url := OLD.pdf_url; END IF;
  NEW.raw_data := public.retain_official_publication_recovery(OLD.raw_data, NEW.raw_data, NEW.pdf_url);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_preserve_official_publication_recovery ON public.work_item_publicaciones;
CREATE TRIGGER trg_preserve_official_publication_recovery
BEFORE UPDATE OF raw_data, pdf_url ON public.work_item_publicaciones
FOR EACH ROW EXECUTE FUNCTION public.preserve_official_publication_recovery();