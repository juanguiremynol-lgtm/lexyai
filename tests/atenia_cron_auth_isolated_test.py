"""Isolated PostgreSQL contract test; never connects to production."""
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class CronAuthMigrationTest(unittest.TestCase):
    def test_preserves_schedule_and_uses_vault_reference_idempotently(self):
        pg = Path(subprocess.check_output(['pg_config', '--bindir'], text=True).strip())
        with tempfile.TemporaryDirectory(prefix='atenia-cron-') as temporary:
            data = Path(temporary) / 'db'
            with socket.socket() as sock:
                sock.bind(('127.0.0.1', 0))
                port = sock.getsockname()[1]
            subprocess.run([str(pg/'initdb'), '-D', str(data), '-A', 'trust', '--no-locale', '--encoding=UTF8'], check=True, stdout=subprocess.DEVNULL)
            subprocess.run([str(pg/'pg_ctl'), '-D', str(data), '-l', str(Path(temporary)/'pg.log'), '-o', f'-h 127.0.0.1 -k {temporary} -p {port}', '-w', 'start'], check=True, stdout=subprocess.DEVNULL)
            try:
                cmd = [str(pg/'psql'), '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', str(port), '-U', os.environ.get('USER', 'postgres'), '-d', 'postgres']
                setup = r"""
                CREATE SCHEMA cron; CREATE SCHEMA vault;
                CREATE TABLE cron.job(jobid bigint, jobname text, active bool, schedule text, command text);
                CREATE TABLE vault.decrypted_secrets(name text, decrypted_secret text);
                CREATE FUNCTION cron.alter_job(job_id bigint, command text) RETURNS void LANGUAGE sql AS $$
                  UPDATE cron.job SET command=$2 WHERE jobid=$1;
                $$;
                INSERT INTO vault.decrypted_secrets VALUES ('CRON_SERVICE_KEY','fixture-secret');
                INSERT INTO cron.job VALUES (8, 'atenia-server-heartbeat', true, '0 */6 * * *',
                $cmd$SELECT net.http_post(url := 'https://example.invalid/atenia-server-heartbeat',
                  headers := '{"Authorization":"Bearer fixture-anon","Content-Type":"application/json"}'::jsonb,
                  body := '{}'::jsonb);$cmd$);
                """
                def sql(source):
                    return subprocess.run(cmd, input=source, text=True, check=True, capture_output=True)
                sql(setup)
                migration = (ROOT/'coordination/20261028_atenia_heartbeat_cron_auth.sql').read_text()
                sql(migration)
                sql(migration)
                result = sql("SELECT active, schedule, position('x-cron-key' in command)>0, position('fixture-anon' in command)=0, position('vault.decrypted_secrets' in command)>0 FROM cron.job WHERE jobid=8;").stdout
                self.assertEqual(result.strip(), 't|0 */6 * * *|t|t|t')
            finally:
                subprocess.run([str(pg/'pg_ctl'), '-D', str(data), '-m', 'immediate', '-w', 'stop'], check=True, stdout=subprocess.DEVNULL)


if __name__ == '__main__':
    unittest.main()
