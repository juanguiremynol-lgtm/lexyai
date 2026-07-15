# Memory: business/workflow-aware-provider-selection-rules
Updated: just now

Provider selection is workflow-aware with STRICT NO-FALLBACK enforcement for CGP/LABORAL:

- **CGP/LABORAL**: CPNU is PRIMARY and ONLY provider. NO fallback to SAMAI under any circumstance because civil/labor/family processes in CPNU are NOT found in SAMAI (the fallback is technically useless and generates noise). If CPNU fails with error, returns HTTP 502 with code CPNU_SYNC_FAILED.

- **CPACA (CASCADE — ratificado por el Doctor 2026-07-15)**: SAMAI is PRIMARY (administrative litigation).
  CPNU is FALLBACK, but fires **only on EMPTY / NOT_FOUND** from SAMAI — never on transient errors
  (timeout/5xx/PROVIDER_ERROR). Espejo exacto de la regla de tutelas. Razón: juzgados administrativos
  con expediente aún no migrado a SAMAI (caso 05001333301520260011300 — Juzgado 15 Administrativo de
  Medellín) conservan sus actuaciones sólo en CPNU. CPACA estados quedan intactas: SAMAI_ESTADOS
  exclusivo, PP sigue prohibido para CPACA.

- **TUTELA (constitutional jurisdiction — CASCADE)**: Any judge can hear a tutela
  (ordinary/CGP or administrative/CPACA), so both provider families are legitimate.
    * Actuaciones cascade: **CPNU → SAMAI** (fallback ONLY on empty/not-found, NEVER on transient error)
    * Estados cascade:      **PP → SAMAI_ESTADOS** (same rule)
    * Semantics: "responded with 0 results" → fallback. "5xx/timeout/PROVIDER_ERROR" → do NOT fallback; retry primary.

- **PENAL_906**: Publicaciones Procesales is PRIMARY (called first) because penal updates frequently surface via published PDFs; CPNU/SAMAI disabled by default.

Stage inference patterns for CGP include: Auto Admisorio, Notificación, Audiencia Inicial, Audiencia de Instrucción y Juzgamiento, Contestación, Traslado, Sentencia, Recursos, Mandamiento de Pago, Excepciones, Pruebas, Alegatos.
