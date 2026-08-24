---
name: Email entity resolution — signal admissibility, not scoring
description: Fase 3 matching model — four admissibility classes, confidence ceiling, three outcomes, authority registry and thread-continuity rules
type: feature
---

# Email → work item matching (Fase 3)

Matching quality is an **admissibility** problem. Measured production precision:
RADICADO ≈ 99%, PARTE ≈ 5%, DESPACHO ≈ 2%, CLIENTE ≈ 1%.

- Four signal classes in `src/lib/email/signal-taxonomy.ts`: DETERMINISTIC,
  STRONG, WEAK, NEGATIVE. Name-class signals (cliente, parte, nombre de la
  autoridad, número de identificación) are WEAK and can never suffice.
- Absence of a deterministic/strong signal is a **ceiling**, never a
  subtraction: weak-only caps at `weak_only_ceiling`, strong-only at
  `strong_only_ceiling`, both below the auto-link floor.
- Outcomes: `AUTO_LINK` (deterministic, no conflict, no ambiguity), `SUGGEST`,
  `NO_CANDIDATE` (routes to the existing `detected_processes` queue — no second
  queue is ever created).
- Thresholds live in `email_matching_thresholds` (per workflow, `_global` rows +
  org overrides). Never constants in code.
- Linking and stage change are separate decisions with separate thresholds. A
  link may be automatic; a stage may not.
- Authority identity: `authorities` / `authority_domains` /
  `authority_addresses`, with `authority_domain_blocklist` for public and
  government-wide domains (gmail, hotmail, outlook, bare `gov.co`). Observed
  domain = weak; verified domain = strong, with the verification source recorded.
- Thread continuity inherits only from a CONFIRMED link, never chains through
  unconfirmed hops; a conflicting identifier or an outside-participant forward
  downgrades to SUGGEST. The inheritance path is written to `evidence_meta`.
- `email_link_manual_overrides` is the labelled dataset for recalibration.
  Weights and thresholds are calibrated from it, not invented.
- Andromeda never stores email bodies. Outlook is the system of record.
