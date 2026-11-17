-- Daily-cadence cron optimization (rollback), 2026-11-17. Owner-authorized.
-- Guard: every job must exist, be active, keep its exact command hash and be at the expected
-- source schedule (or already at the target = idempotent no-op). Otherwise abort, changing nothing.
-- Commands, auth and SQL due-work gates are untouched; only schedules change.
DO $$
DECLARE r record; cur record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
(7,'atenia-cron-watchdog','30 15 * * *','0 * * * *','1b778fb37c90a5e3994a9daeb1c56232'),
(8,'atenia-server-heartbeat','20 15 * * *','0 */6 * * *','064d6d57954627804d1fb65c88dd93ef'),
(10,'atenia-self-health','40 15 * * *','0 * * * *','de0a374059622caeef9a242e528d9b19'),
(15,'scheduled-alert-evaluator','40 12 * * *','0 */2 * * *','d2909f14d4b36a564cf99253a286ed26'),
(21,'cpnu-job-poller','*/10 12-15 * * *','*/10 * * * *','d4d9ef1b22d98428fa6a5dc1aeb8bb44'),
(40,'alert-suggestion-aggregate','45 12 * * *','5 */3 * * *','5cb535ad2079475daeb47e16698dc2b0'),
(67,'process-retry-queue','30 12-15 * * *','0 5-13 * * *','4c67d49e32e2170d5f77541a9176500e'),
(69,'cleanup-rate-limits','30 3 * * *','0 * * * *','ab0165e6765a5775a6c1336fb53f9531'),
(70,'dispatch-update-emails','10 16 * * *','40 * * * *','305b1505ca80f97c93f3215ecb9baf42'),
(71,'process-email-outbox','*/15 * * * *','*/5 * * * *','c25961fab5d877493a02c057ee208728'),
(74,'process-estado-attachments','3-59/6 12-15 * * *','*/6 * * * *','2d9e64a042156fa266d8b94d33c02fc3'),
(75,'gcp-lifecycle-broadcaster','5 11 * * *','0 * * * *','696a5cc9b6f0673e75df8bd6f7663e4e'),
(77,'outlook-sync','45 11 * * *','*/30 * * * *','a97e6122c3c4cba25e1b21af6c32ab09'),
(80,'email-semantics-backfill','55 11 * * *','0 * * * *','762a2bdbf49b1be6c3ea6767e788235f'),
(85,'cron-health-snapshot','50 15 * * *','5 * * * *','5d067d0cba35c2c70cb41c6ad0541f39'),
(89,'outlook-token-refresh','40 11 * * *','*/15 * * * *','9f2da609d0dc1abe5c35273b1dafec0a'),
(95,'process-retry-queue-night-net','30 16 * * *','0 18 * * *','4c67d49e32e2170d5f77541a9176500e'),
(97,'andromeda-public-estados-resume','1-59/5 12-15 * * *','*/5 * * * *','963b54dfefe5d895089248c16ad842e4'),
(99,'pp-run-followup-15m','7-59/15 12-16 * * *','*/15 * * * *','06037be289114dce63546d37cb0d7caf'),
(100,'andromeda-state-run-catchup-v1','9-59/20 12-14 * * *','*/20 0-1,12-23 * * *','b52c48a113b9adb65758bb945f884ee9'),
(102,'andromeda-eligible-digest-catchup-v2','40 13 * * *','*/20 0-1,13-23 * * *','6b7f4c25f2dbdac4e182a46b164fbc89'),
(103,'sync-failure-evidence-recovery-v1','15 16 * * *','40 * * * *','c028554a71083f2e67cf0d5ae22036d9'),
(107,'andromeda-stranded-update-watchdog-v1','25 15 * * *','*/15 * * * *','42d6e4dd48e32d64fc9486e0bfef5028')
  ) v(jobid,jobname,from_sched,to_sched,cmd_md5) LOOP
    SELECT jobname, schedule, active, md5(command) h INTO cur FROM cron.job WHERE jobid=r.jobid;
    IF NOT FOUND OR cur.jobname<>r.jobname OR cur.h<>r.cmd_md5 OR NOT cur.active
       OR cur.schedule NOT IN (r.from_sched, r.to_sched) THEN
      RAISE EXCEPTION 'cron guard failed for job % (%): state unknown, aborting', r.jobid, r.jobname;
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
(7,'atenia-cron-watchdog','30 15 * * *','0 * * * *','1b778fb37c90a5e3994a9daeb1c56232'),
(8,'atenia-server-heartbeat','20 15 * * *','0 */6 * * *','064d6d57954627804d1fb65c88dd93ef'),
(10,'atenia-self-health','40 15 * * *','0 * * * *','de0a374059622caeef9a242e528d9b19'),
(15,'scheduled-alert-evaluator','40 12 * * *','0 */2 * * *','d2909f14d4b36a564cf99253a286ed26'),
(21,'cpnu-job-poller','*/10 12-15 * * *','*/10 * * * *','d4d9ef1b22d98428fa6a5dc1aeb8bb44'),
(40,'alert-suggestion-aggregate','45 12 * * *','5 */3 * * *','5cb535ad2079475daeb47e16698dc2b0'),
(67,'process-retry-queue','30 12-15 * * *','0 5-13 * * *','4c67d49e32e2170d5f77541a9176500e'),
(69,'cleanup-rate-limits','30 3 * * *','0 * * * *','ab0165e6765a5775a6c1336fb53f9531'),
(70,'dispatch-update-emails','10 16 * * *','40 * * * *','305b1505ca80f97c93f3215ecb9baf42'),
(71,'process-email-outbox','*/15 * * * *','*/5 * * * *','c25961fab5d877493a02c057ee208728'),
(74,'process-estado-attachments','3-59/6 12-15 * * *','*/6 * * * *','2d9e64a042156fa266d8b94d33c02fc3'),
(75,'gcp-lifecycle-broadcaster','5 11 * * *','0 * * * *','696a5cc9b6f0673e75df8bd6f7663e4e'),
(77,'outlook-sync','45 11 * * *','*/30 * * * *','a97e6122c3c4cba25e1b21af6c32ab09'),
(80,'email-semantics-backfill','55 11 * * *','0 * * * *','762a2bdbf49b1be6c3ea6767e788235f'),
(85,'cron-health-snapshot','50 15 * * *','5 * * * *','5d067d0cba35c2c70cb41c6ad0541f39'),
(89,'outlook-token-refresh','40 11 * * *','*/15 * * * *','9f2da609d0dc1abe5c35273b1dafec0a'),
(95,'process-retry-queue-night-net','30 16 * * *','0 18 * * *','4c67d49e32e2170d5f77541a9176500e'),
(97,'andromeda-public-estados-resume','1-59/5 12-15 * * *','*/5 * * * *','963b54dfefe5d895089248c16ad842e4'),
(99,'pp-run-followup-15m','7-59/15 12-16 * * *','*/15 * * * *','06037be289114dce63546d37cb0d7caf'),
(100,'andromeda-state-run-catchup-v1','9-59/20 12-14 * * *','*/20 0-1,12-23 * * *','b52c48a113b9adb65758bb945f884ee9'),
(102,'andromeda-eligible-digest-catchup-v2','40 13 * * *','*/20 0-1,13-23 * * *','6b7f4c25f2dbdac4e182a46b164fbc89'),
(103,'sync-failure-evidence-recovery-v1','15 16 * * *','40 * * * *','c028554a71083f2e67cf0d5ae22036d9'),
(107,'andromeda-stranded-update-watchdog-v1','25 15 * * *','*/15 * * * *','42d6e4dd48e32d64fc9486e0bfef5028')
  ) v(jobid,jobname,from_sched,to_sched,cmd_md5) LOOP
    PERFORM cron.alter_job(r.jobid, schedule := r.to_sched);
  END LOOP;
END $$;
