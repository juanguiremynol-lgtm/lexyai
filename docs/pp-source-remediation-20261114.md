# PP source remediation — upstream blockers (2026-11-14)

Scope: 25 matters whose latest Publicaciones attempt is `PP_STORED_READ_INCOMPLETE`.
These are valid fail-closed guards. Never convert them to SUCCESS, never rewrite
fingerprints, publication dates, estados or deadlines, never start a manual extraction.
The external extraction service (scraper) is NOT in this repository; every fix below is
an upstream change, followed by the normal scheduled follow-up (same run id, no re-POST).

Common state: runs are PARCIAL / not certified; `checkpoint.next` is usually `2026-10-31`.
Observe via MCP `list_freshness_issues` → `sync_checks[].publicaciones_blocker`
(`upstream_cause`, `upstream_status`, `backend_run_id`, `checkpoint_next`, `identity_match`,
`persistence_complete`, `daily_plan_complete`). `status=success` with
`daily_plan_complete=false` is also listed and is NOT a full daily verification.

| Cause | n | Concrete proof required | External correction needed |
|---|---|---|---|
| FECHA_PLANILLA_CONTRADICTORIA | 8 | Run evidence showing portal date ≠ fixation/planilla date for the same estado | Extractor must keep portal, fixation and providencia dates separate and emit the explicit native date; no inferred date |
| EXTRACCION_DOCUMENTO_NO_VERIFICADA | 5 | Stored read without verified PDF bytes/SHA for the referenced document | Download and hash the official document; report SHA + URL so the attachment contract can certify it |
| AUTHOR_DESPACHO_NOT_RESOLVED | 3 | Package published by a central publisher with no resolvable author despacho | Resolve author despacho / municipality + `articleNamesAuthorDespacho`; declare `paquete.paginas_caso` |
| ENUMERACION_CON_PUBLICACIONES_PARCIAL | 3 | Enumeration lists more publications than were read | Complete enumeration pagination for the day before certifying |
| NUMERO_PLANILLA_CONTRADICTORIO | 2 | Same estado with conflicting planilla numbers | Emit native planilla reference per page; do not merge |
| PUBLIC_SHAREPOINT_AUTH_REQUIRED | 1 | Official link returns an auth wall (e.g. radicado 05001400300220250105400) | Obtain the document through a public official route; until then remains blocked |
| ESTADO_SIN_DOCUMENTO | 1 | Estado row without attached document in the source | Confirm source omission; report explicit "no document" evidence, never fabricate |
| PLANILLA_ESTADO_AMBIGUA | 1 | One planilla maps to several candidate estados | Page-level binding to the case; ambiguous pages stay unbound |
| (cause unavailable) | 1 | No `stored_result_read.cause` recorded | Extractor must always emit a cause code (`^[A-Z][A-Z0-9_]*$`) |

Acceptance after an upstream fix: the scheduled follow-up reads the stored result for the
same `backend_run_id`, `identity_match=true`, `persistence_complete=true`,
`daily_plan_complete=true`; only then the guard clears. No cron, secret, permission or
judicial-data change is part of this document.
