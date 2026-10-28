"""Isolated PostgreSQL regression test; creates and removes its own cluster."""
import concurrent.futures
import pathlib
import socket
import subprocess
import tempfile

PG = pathlib.Path('/usr/lib/postgresql/16/bin')
MIGRATION = pathlib.Path(__file__).resolve().parents[1] / 'supabase/migrations/20261028010000_samai_estados_circuit_breaker.sql'

with tempfile.TemporaryDirectory(prefix='andromeda-breaker-test-') as tmp:
    directory = pathlib.Path(tmp)
    data = directory / 'data'
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    subprocess.run([str(PG / 'initdb'), '-D', str(data), '-A', 'trust', '-U', 'breaker_test', '--no-locale'], check=True, stdout=subprocess.DEVNULL)
    subprocess.run([str(PG / 'pg_ctl'), '-D', str(data), '-l', str(directory / 'log'), '-o', f'-k {directory} -p {port} -c listen_addresses=', 'start'], check=True, stdout=subprocess.DEVNULL)
    args = ['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', str(directory), '-p', str(port), '-U', 'breaker_test', '-d', 'postgres']
    def query(sql):
        return subprocess.run(args + ['-c', "set request.jwt.claim.role='service_role'; " + sql], check=True, capture_output=True, text=True).stdout.strip()
    try:
        query("create role anon; create role authenticated; create role service_role; create schema auth; "
              "create function auth.role() returns text language sql as $$select current_setting('request.jwt.claim.role',true)$$; "
              "create table public.estados_monitor_run_items(run_id uuid,work_item_id uuid,lease_token uuid,status text,attempts int,claimed_at timestamptz,next_attempt_at timestamptz,error_code text)")
        subprocess.run(args + ['-f', str(MIGRATION)], check=True, capture_output=True, text=True)
        assert query('select allowed from public.acquire_samai_estados_breaker()') == 't'
        assert query("select public.finish_samai_estados_breaker(0,null,'TRANSIENT_FAILURE')") == 't'
        assert query("select public.finish_samai_estados_breaker(0,null,'TRANSIENT_FAILURE')") == 't'
        assert query('select paused from public.peek_samai_estados_breaker()') == 't'
        assert query('select allowed from public.acquire_samai_estados_breaker()') == 'f'
        query("update public.public_provider_breakers set retry_at=now()-interval '1 second' where provider='samai_estados'")
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            probes = list(pool.map(lambda _: query("select allowed||'|'||coalesce(probe_token::text,'-') from public.acquire_samai_estados_breaker()"), range(2)))
        assert sum(x.startswith('true|') for x in probes) == 1 and sum(x.startswith('false|') for x in probes) == 1, probes
        generation, token = query("select generation||'|'||probe_token::text from public.public_provider_breakers where provider='samai_estados'").split('|')
        assert query("select public.finish_samai_estados_breaker(0,null,'VALID_RESPONSE')") == 'f'
        assert query(f"select public.finish_samai_estados_breaker({generation},'{token}','VALID_RESPONSE')") == 't'
        assert query(f"select public.finish_samai_estados_breaker({generation},'{token}','TRANSIENT_FAILURE')") == 'f'
        assert query("select state from public.public_provider_breakers where provider='samai_estados'") == 'CLOSED'
        query("insert into public.estados_monitor_run_items values ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','CLAIMED',2,now(),now(),null)")
        args_sql = "'00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002'"
        assert query(f"select public.defer_public_monitor_for_breaker({args_sql},'00000000-0000-0000-0000-000000000004',now()+interval '15 minutes','PROVIDER_BREAKER_OPEN')") == 'f'
        assert query(f"select public.defer_public_monitor_for_breaker({args_sql},'00000000-0000-0000-0000-000000000003',now()+interval '15 minutes','PROVIDER_BREAKER_OPEN')") == 't'
        assert query('select status||\'|\'||attempts||\'|\'||(lease_token is null) from public.estados_monitor_run_items') == 'PENDING|1|true'
        print('breaker: open, single concurrent probe, fencing, recovery and deferred item passed')
    finally:
        subprocess.run([str(PG / 'pg_ctl'), '-D', str(data), '-m', 'immediate', 'stop'], check=True, stdout=subprocess.DEVNULL)
