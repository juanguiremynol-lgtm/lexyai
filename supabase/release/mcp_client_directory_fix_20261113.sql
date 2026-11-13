-- NOT APPLIED. Corrective release for 0102 (owner review 2026-11-13). Root applies after review.
-- 1) Organization: reuse the Clients screen context (profiles.organization_id), verified against
--    organization_memberships; if the profile has none, only a single membership is accepted.
--    Otherwise an audited ORGANIZATION_AMBIGUOUS conflict is returned and nothing is inserted.
--    Profiles are never written (the screen's fallback write is not reproduced).
-- 2) Uniqueness across MCP and the Clients screen: a unique index is impossible today
--    (1 pre-existing same-owner duplicate group of normalized identification). A BEFORE
--    INSERT/UPDATE trigger takes the same owner+identification advisory lock and rejects only
--    NEW duplicates; pre-existing rows are untouched and may still be edited if their
--    identification does not change. Grants of 0102 are unchanged.

CREATE OR REPLACE FUNCTION public.clients_block_new_identification_duplicate() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE v_norm text; v_other uuid;
BEGIN
 v_norm:=public._mcp_normalize_client_id_number(NEW.id_number);
 IF v_norm IS NULL OR NEW.owner_id IS NULL THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND NEW.owner_id IS NOT DISTINCT FROM OLD.owner_id
    AND v_norm IS NOT DISTINCT FROM public._mcp_normalize_client_id_number(OLD.id_number) THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('mcp_client:'||NEW.owner_id::text||':'||v_norm,0));
 -- READ COMMITTED: this statement takes a fresh snapshot after the lock, so it sees rows committed by the lock holder.
 SELECT id INTO v_other FROM public.clients WHERE owner_id=NEW.owner_id AND id<>NEW.id
   AND public._mcp_normalize_client_id_number(id_number)=v_norm LIMIT 1;
 IF v_other IS NOT NULL THEN
  RAISE EXCEPTION 'IDENTIFICATION_EXISTS client_id=%',v_other USING ERRCODE='23505', HINT='Ya existe un cliente con esta identificación.';
 END IF;
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.clients_block_new_identification_duplicate() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS trg_clients_block_new_identification_duplicate ON public.clients;
CREATE TRIGGER trg_clients_block_new_identification_duplicate BEFORE INSERT OR UPDATE OF id_number, owner_id ON public.clients
 FOR EACH ROW EXECUTE FUNCTION public.clients_block_new_identification_duplicate();

CREATE OR REPLACE FUNCTION public.mcp_create_client(p_name text,p_id_number text,p_email text,p_city text,p_idempotency_key text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE v public.clients%ROWTYPE; prior jsonb; v_norm text; v_existing public.clients%ROWTYPE; v_org uuid; v_cnt int;
 n text:=NULLIF(btrim(COALESCE(p_name,'')),''); e text:=NULLIF(lower(btrim(COALESCE(p_email,''))),''); ci text:=NULLIF(btrim(COALESCE(p_city,'')),''); idn text:=NULLIF(btrim(COALESCE(p_id_number,'')),'');
BEGIN
PERFORM public.mcp_assert_write();
IF n IS NULL OR length(n)>300 OR length(COALESCE(idn,''))>60 OR length(COALESCE(ci,''))>120 OR length(COALESCE(e,''))>200 OR (e IS NOT NULL AND e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') THEN RAISE EXCEPTION 'INVALID_CLIENT_FIELDS' USING ERRCODE='MCP22'; END IF;
v_norm:=public._mcp_normalize_client_id_number(idn);
IF idn IS NOT NULL AND v_norm IS NULL THEN RAISE EXCEPTION 'INVALID_ID_NUMBER' USING ERRCODE='MCP22'; END IF;
prior:=public._mcp_begin('create_client',p_idempotency_key,jsonb_build_object('name',n,'id_number',idn,'email',e,'city',ci));
IF prior IS NOT NULL THEN RETURN prior; END IF;
-- Organization = Clients screen context, verified membership; never arbitrary.
SELECT p.organization_id INTO v_org FROM public.profiles p WHERE p.id=auth.uid();
IF v_org IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.organization_memberships m WHERE m.user_id=auth.uid() AND m.organization_id=v_org) THEN v_org:=NULL; v_cnt:=-1; END IF;
IF v_org IS NULL THEN
 SELECT count(*), (array_agg(organization_id))[1] INTO v_cnt, v_org FROM public.organization_memberships WHERE user_id=auth.uid();
 IF v_cnt>1 OR v_cnt=0 AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.organization_id IS NOT NULL) THEN
  RETURN public._mcp_finish('create_client',p_idempotency_key,jsonb_build_object('ok',false,'conflict','ORGANIZATION_AMBIGUOUS','message','No se pudo determinar una organización única; abra Andromeda para fijar la organización activa.'),'client',NULL,NULL,NULL);
 END IF;
END IF;
IF v_norm IS NOT NULL THEN
 PERFORM pg_advisory_xact_lock(hashtextextended('mcp_client:'||auth.uid()::text||':'||v_norm,0));
 SELECT * INTO v_existing FROM public.clients WHERE owner_id=auth.uid() AND public._mcp_normalize_client_id_number(id_number)=v_norm ORDER BY deleted_at NULLS FIRST, created_at LIMIT 1;
 IF FOUND THEN
  RETURN public._mcp_finish('create_client',p_idempotency_key,jsonb_build_object('ok',false,'conflict','IDENTIFICATION_EXISTS','client_id',v_existing.id,'archived',v_existing.deleted_at IS NOT NULL),'client',v_existing.id,NULL,NULL);
 END IF;
END IF;
INSERT INTO public.clients(owner_id,organization_id,name,id_number,city,email) VALUES(auth.uid(),v_org,n,idn,ci,e) RETURNING * INTO v;
RETURN public._mcp_finish('create_client',p_idempotency_key,jsonb_build_object('ok',true,'client',jsonb_build_object('id',v.id,'name',v.name,'id_number',v.id_number,'city',v.city,'email',v.email,'organization_id',v.organization_id,'updated_at',v.updated_at)),'client',v.id,NULL,to_jsonb(v));
END $fn$;
-- CREATE OR REPLACE keeps 0102 privileges (EXECUTE only service_role until mcp_write_rpcs_enable.sql).
