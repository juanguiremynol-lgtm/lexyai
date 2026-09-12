---
name: Summary-column rule — the copy is not the fact
description: Any human-maintained mirror of a machine-held fact (cron schedules, status summaries) drifts; derive it or treat it as untrusted
type: constraint
---

# The copy is not the fact

Recurrence (LR4, after the cron rename): the frequency of five jobs was wrong in
THREE places at once — the cron `jobname`, `supabase/functions/_shared/cronRegistry.ts`
and its UI mirror `src/lib/cron-registry.ts`. `cron.job.schedule` was right the
whole time. Nobody had lied; three copies had simply stopped being refreshed
when the schedule changed weeks earlier.

**Rule.** When a fact lives in one authoritative place, a second hand-maintained
copy of it is a defect waiting for a diagnosis session. Either derive it at read
time from the authority, or do not display it.

Applications so far:
- `cron.job.schedule` is the fact. `schedule_utc` in either registry is a copy.
  `public.cron_job_health()` already returns `(jobname, schedule, active, ...)`
  straight from `cron.job`, so the UI mirror's schedule column CAN be derived and
  the registry should keep only the non-derivable fields (label, role, critical,
  wiring, expected_active).
- Job NAMES must not encode frequency. A name describing function survives a
  schedule change; `-every-2min` does not.

**Why:** a summary column that disagrees with the fact does not merely omit — it
misleads the next person diagnosing an incident, who reasons about a cadence
that does not exist.
