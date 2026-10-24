-- Local synthetic schema, transaction-only. Never seeds managed auth tables remotely.
BEGIN;
CREATE OR REPLACE FUNCTION public._mcp_require_first_party() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$ DECLARE c jsonb := public.mcp_caller_context(); BEGIN IF NOT (c->>'authenticated')::boolean THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE='42501'; END IF; IF c->>'surface' <> 'first_party' THEN RAISE EXCEPTION 'MCP_FIRST_PARTY_REQUIRED' USING ERRCODE='MCP01'; END IF; RETURN c; END $$;
ALTER TABLE auth.oauth_clients ADD COLUMN client_name text;
CREATE TABLE auth.oauth_authorizations(authorization_id text,client_id uuid,user_id uuid,scope text,expires_at timestamptz,status text);
\ir ../../drizzle/migrations/0080_mcp_native_authorization_identity.sql
INSERT INTO auth.sessions(id,user_id) VALUES('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002');
INSERT INTO auth.oauth_clients(id,client_name) VALUES('00000000-0000-0000-0000-000000000003','Synthetic AI');
INSERT INTO auth.oauth_authorizations VALUES
('pending','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000002','openid',now()+interval '1 hour','pending'),
('approved','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000002','andromeda:read',now()+interval '1 hour','approved'),
('foreign','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000004','openid',now()+interval '1 hour','pending'),
('expired','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000002','openid',now()-interval '1 hour','approved'),
('denied','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000002','openid',now()+interval '1 hour','denied');
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000002","session_id":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE a jsonb; bad text; BEGIN
 a := public.mcp_native_authorization_identity('pending');
 IF a IS DISTINCT FROM '{"client_id":"00000000-0000-0000-0000-000000000003","client_name":"Synthetic AI","scope":"openid"}'::jsonb THEN RAISE EXCEPTION 'identity/field whitelist failed'; END IF;
 IF public.mcp_native_authorization_identity('approved')->>'scope' IS DISTINCT FROM 'andromeda:read' THEN RAISE EXCEPTION 'approved scope lost'; END IF;
 FOREACH bad IN ARRAY ARRAY['foreign','expired','denied','unknown'] LOOP
  BEGIN PERFORM public.mcp_native_authorization_identity(bad); RAISE EXCEPTION 'unexpected success';
  EXCEPTION WHEN SQLSTATE 'MCP04' THEN NULL; END;
 END LOOP;
END $$;
RESET ROLE;
UPDATE auth.sessions SET oauth_client_id='00000000-0000-0000-0000-000000000003' WHERE id='00000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.mcp_native_authorization_identity('pending'); RAISE EXCEPTION 'OAuth/native mismatch accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
UPDATE auth.sessions SET oauth_client_id=NULL WHERE id='00000000-0000-0000-0000-000000000001';
UPDATE auth.oauth_clients SET deleted_at=now();
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.mcp_native_authorization_identity('pending'); RAISE EXCEPTION 'deleted client accepted'; EXCEPTION WHEN SQLSTATE 'MCP04' THEN NULL; END;
END $$;
SELECT '{"suite":"native_authorization_identity","checks":8,"status":"PASS","persistence":"ROLLBACK","schema":"local synthetic"}'::jsonb;
ROLLBACK;
