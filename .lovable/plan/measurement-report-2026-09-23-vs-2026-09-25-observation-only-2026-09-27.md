# Measurement report: 2026-09-23 vs 2026-09-25 (observation only, nothing changed)

Gates went live 2026-09-24 ~20:20 UTC, so the 23rd is fully before the change and the 25th fully after.

## What could and could not be measured
- **Run credits by day: not available.** The credits tool only gives a period total (555 credits since Sep 24) with no per-day or per-category split. So I can't compute an absolute or percentage change in Run credits, or a compute-only change, from evidence. Any number I gave would be invented.
- **Database / compute / network by day: not available** from any tool I can use.
- **Backend function request logs for those days: expired** (the log query returns nothing for Sep 23–25). So actual function starts are inferred from the scheduler's own record of each check, described below.
- **Available and exact:** scheduler run history, AI usage, email outbox rows and site visits.

## The three gated tasks
Each scheduler check records whether its condition matched: "1 row" means the function started, "0 rows" means it was skipped.

| Task | Day | Scheduler checks | Function starts | Gate skips | Failures | Real work |
|---|---|---|---|---|---|---|
| process-email-outbox (every 5 min) | Sep 23 | 288 | 288 | 0 (no gate yet) | 0 | 1 email sent |
| | Sep 25 | 288 | **0** | 288 | 0 | 1 email sent (the digest is sent directly) |
| cpnu-job-poller (every 10 min) | Sep 23 | 144 | 144 | 0 | 0 | not measurable (lookups not kept by day) |
| | Sep 25 | 144 | **0** | 144 | 0 | 0 lookups in progress |
| outlook-token-refresh (every 15 min) | Sep 23 | 96 | 96 | 0 | 0 | not measurable |
| | Sep 25 | 96 | **24** | 72 | 0 | about 1 renewal per hour (tokens last about 1 hour) |

**Function starts: 528 on Sep 23 → 24 on Sep 25 (−504, −95%).** The scheduler itself still ran 528 cheap checks on both days (about 80–200 ms each, database only). What went away is the function starts behind them.

Workload was the same on both days: 1 outgoing email each day, and the same schedules and number of matters. The drop comes from the gates, not from less work. On the 23rd, every start was a wake-up with nothing to do, apart from one email and the hourly token renewals.

## Other activity (for context)
- **All scheduled tasks:** 820 checks on each day, 1 failure each day. On Sep 23 the failure was alert-lifecycle-maintenance, since fixed. On Sep 25 it was appellate-blindspot-sweep, which is new and not investigated. Total scheduler time went from 94 s to 110 s, a small change, partly because the gated checks now run a lookup (~190 ms against ~66 ms before for the CPNU check).
- **AI usage:** 52 requests on Sep 23 against 31 on Sep 25. Almost all were the hourly assistant check (~0.0086 credits each) plus small classification calls. That comes to roughly 0.3–0.5 credits a day, too small to matter. The fall on the 25th is a lighter workload, not an optimisation.
- **Site visits:** 2 on both days, so the app's own traffic is negligible.

## Conclusion
- Proven: about 504 fewer function starts a day (−95% for these three tasks), with no failures and no work missed.
- Not provable with the tools available: the change in credits. The billing period only started Sep 24 and has no per-day split. To see it in money, compare the workspace's usage page in Settings for days after Sep 24 against earlier days.
- **Further optimisation: not justified by these measurements.** Two remaining recurring items: the hourly AI check, at under 0.25 credits a day, and the scheduler checks themselves, which are cheap. The one thing worth a look is the new appellate-blindspot-sweep failure on Sep 25, and that is about reliability, not cost.

No code, data, schedules or settings were changed.
