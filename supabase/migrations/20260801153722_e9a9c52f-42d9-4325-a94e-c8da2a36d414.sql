-- Fix: accept "DE"/"DEL" before the year; never roll a year that the text states.
CREATE OR REPLACE FUNCTION public.extract_provider_hearing(
  p_title text, p_annotation text, p_today date DEFAULT (now() AT TIME ZONE 'America/Bogota')::date
) RETURNS TABLE (hearing_date date, hora text, fuente_texto text)
LANGUAGE plpgsql IMMUTABLE
SET search_path TO 'public'
AS $$
DECLARE
  t text; m text[]; tm text[]; v_y int; v_date date;
  v_pos int; v_hh int; v_mm int; v_mer text; v_hora text; v_snip text;
  v_months constant text[] := ARRAY['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO',
                                    'AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'];
  v_mi int; v_anchor text;
BEGIN
  t := upper(translate(coalesce(p_title,'') || ' ' || coalesce(p_annotation,''),
                       'áéíóúüñÁÉÍÓÚÜÑ','aeiouunAEIOUUN'));
  t := btrim(regexp_replace(t, '\s+', ' ', 'g'));
  IF t = '' OR t !~ '(AUDIENCIA|DILIGENCIA|EV[- ]?INICIAL)' THEN RETURN; END IF;

  m := regexp_match(t, 'PARA EL (?:DIA )?([0-9]{1,2}) DE ([A-Z]+) DEL? ([0-9]{4})');
  IF m IS NOT NULL THEN
    v_mi := array_position(v_months, CASE WHEN m[2] = 'SETIEMBRE' THEN 'SEPTIEMBRE' ELSE m[2] END);
    IF v_mi IS NOT NULL THEN
      BEGIN v_date := make_date(m[3]::int, v_mi, m[1]::int); EXCEPTION WHEN others THEN v_date := NULL; END;
    END IF;
    v_anchor := m[1];
  END IF;

  IF v_date IS NULL THEN
    m := regexp_match(t, 'AUDIENCIA[^.]{0,80}EL (?:DIA )?([0-9]{1,2}) DE ([A-Z]+)(?: DEL? ([0-9]{4}))?');
    IF m IS NOT NULL THEN
      v_mi := array_position(v_months, CASE WHEN m[2] = 'SETIEMBRE' THEN 'SEPTIEMBRE' ELSE m[2] END);
      IF v_mi IS NOT NULL THEN
        v_y := COALESCE(m[3]::int, extract(year from p_today)::int);
        BEGIN v_date := make_date(v_y, v_mi, m[1]::int); EXCEPTION WHEN others THEN v_date := NULL; END;
        -- Only a date with NO year in the text may roll forward.
        IF m[3] IS NULL AND v_date IS NOT NULL AND v_date < p_today THEN
          BEGIN v_date := make_date(v_y + 1, v_mi, m[1]::int); EXCEPTION WHEN others THEN v_date := NULL; END;
        END IF;
      END IF;
      v_anchor := m[1];
    END IF;
  END IF;

  IF v_date IS NULL THEN
    m := regexp_match(t, '([0-9]{1,2})[/-]([0-9]{1,2})[/-]([0-9]{4})');
    IF m IS NOT NULL THEN
      BEGIN v_date := make_date(m[3]::int, m[2]::int, m[1]::int); EXCEPTION WHEN others THEN v_date := NULL; END;
      v_anchor := m[1];
    END IF;
  END IF;

  IF v_date IS NULL OR v_date < p_today THEN RETURN; END IF;

  tm := regexp_match(t, '([0-9]{1,2})[:.]([0-9]{2}) ?(A\.? ?M\.?|P\.? ?M\.?)?');
  IF tm IS NOT NULL THEN
    v_hh := tm[1]::int; v_mm := tm[2]::int;
    v_mer := replace(replace(coalesce(tm[3],''), '.', ''), ' ', '');
    IF v_mer = 'PM' AND v_hh < 12 THEN v_hh := v_hh + 12; END IF;
    IF v_mer = 'AM' AND v_hh = 12 THEN v_hh := 0; END IF;
    IF v_hh <= 23 AND v_mm <= 59 THEN
      v_hora := lpad(v_hh::text, 2, '0') || ':' || lpad(v_mm::text, 2, '0');
    END IF;
  END IF;

  v_pos := greatest(1, coalesce(position(coalesce(v_anchor,'') in t), 1) - 30);
  v_snip := btrim(substr(t, v_pos, 160));

  RETURN QUERY SELECT v_date, v_hora, v_snip;
END;
$$;

-- Purge the fabricated hearing suggestions produced by the previous version.
DELETE FROM public.work_item_deadlines
 WHERE deadline_type = 'AUDIENCIA'
   AND status = 'SUGGESTED_BY_PROVIDER'
   AND calculation_meta->>'anchor_source' = 'PROVIDER_HEARING_TEXT'
   AND deadline_date > date '2026-12-31';