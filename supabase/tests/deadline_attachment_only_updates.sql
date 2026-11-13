-- Run in an empty disposable database after installing the production trigger
-- function. An audit fixture counts actual invocations of the underlying RPC.
BEGIN;
CREATE TEMP TABLE acts_fixture (
  id uuid PRIMARY KEY, work_item_id uuid, raw_data jsonb, description text,
  act_date date, act_type text, is_archived boolean DEFAULT false
);
CREATE TEMP TABLE deadline_calls (id uuid);
CREATE FUNCTION public.compute_deadline_for_actuacion(uuid) RETURNS uuid
  LANGUAGE plpgsql AS $$ BEGIN INSERT INTO pg_temp.deadline_calls VALUES ($1); RETURN $1; END; $$;
CREATE TRIGGER count_fixture_deadlines AFTER INSERT OR UPDATE OF raw_data, description, act_date, is_archived
  ON acts_fixture FOR EACH ROW EXECUTE FUNCTION public.trg_compute_deadline_on_act();
CREATE FUNCTION pg_temp.assert_calls(expected integer) RETURNS void LANGUAGE plpgsql AS $$
DECLARE actual integer;
BEGIN
  SELECT count(*) INTO actual FROM pg_temp.deadline_calls;
  IF actual <> expected THEN RAISE EXCEPTION 'Expected % deadline calculations, got %', expected, actual; END IF;
END; $$;
INSERT INTO acts_fixture (id,description,raw_data)
VALUES ('00000000-0000-4000-8000-000000000001','Synthetic act','{"estado":"ACTIVA"}');
SELECT pg_temp.assert_calls(1);
UPDATE acts_fixture SET raw_data=raw_data || jsonb_build_object(
  'documentos',jsonb_build_array(jsonb_build_object('nombre',repeat('a',80000))),
  'documentos_observados_en','2026-11-13','anexos',1,'anexos_inventario','{}'::jsonb,
  'anexos_observacion','{}'::jsonb,'anexos_observacion_historial','[]'::jsonb
);
UPDATE acts_fixture SET raw_data=raw_data;
SELECT pg_temp.assert_calls(1);
UPDATE acts_fixture SET raw_data=raw_data || '{"fecha_inicia_termino":"2026-11-13"}';
UPDATE acts_fixture SET raw_data=raw_data || '{"estado":"ANULADA"}';
UPDATE acts_fixture SET raw_data=raw_data || '{"other_future_field":true}';
UPDATE acts_fixture SET raw_data=raw_data || '{"documentos":[],"is_annulled":true}';
UPDATE acts_fixture SET description='Synthetic changed';
UPDATE acts_fixture SET act_date='2026-11-13';
SELECT pg_temp.assert_calls(7);
UPDATE acts_fixture SET is_archived=true;
UPDATE acts_fixture SET raw_data=raw_data || '{"future_field":true}';
SELECT pg_temp.assert_calls(7);
UPDATE acts_fixture SET is_archived=false;
UPDATE acts_fixture SET raw_data=NULL;
UPDATE acts_fixture SET raw_data='"legacy scalar"';
SELECT pg_temp.assert_calls(10);
ROLLBACK;
