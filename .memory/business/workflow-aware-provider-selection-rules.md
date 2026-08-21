# Memory: business/workflow-aware-provider-selection-rules
Updated: just now

Provider selection is workflow-aware with STRICT NO-FALLBACK enforcement for CGP/LABORAL:

- **CGP/LABORAL**: CPNU is PRIMARY and ONLY provider. NO fallback to SAMAI under any circumstance because civil/labor/family processes in CPNU are NOT found in SAMAI (the fallback is technically useless and generates noise). If CPNU fails with error, returns HTTP 502 with code CPNU_SYNC_FAILED.

- **CPACA (SAMAI EXCLUSIVO — BB1, 2026-08-21)**: SAMAI is the SOLE actuaciones provider.
  The CPNU fallback ratified 2026-07-15 was RETIRED: SAMAI began serving the administrative
  expedientes that motivated it (caso 05001333301520260011300, Juzgado 15 Administrativo de
  Medellín) on 2026-07-21, so the fallback could only add cross-jurisdiction noise. The 14
  CPNU-sourced acts already ingested for that radicado are PRESERVED as evidence; no new CPNU
  reads are authorised for CPACA. Estados stay SAMAI_ESTADOS exclusivo; PP remains prohibited.


- **TUTELA (constitutional jurisdiction — CASCADE)**: Any judge can hear a tutela
  (ordinary/CGP or administrative/CPACA), so both provider families are legitimate.
    * Actuaciones cascade: **CPNU → SAMAI** (fallback ONLY on empty/not-found, NEVER on transient error)
    * Estados cascade:      **PP → SAMAI_ESTADOS** (same rule)
    * Semantics: "responded with 0 results" → fallback. "5xx/timeout/PROVIDER_ERROR" → do NOT fallback; retry primary.

- **PENAL_906**: Publicaciones Procesales is PRIMARY (called first) because penal updates frequently surface via published PDFs; CPNU/SAMAI disabled by default.

Stage inference patterns for CGP include: Auto Admisorio, Notificación, Audiencia Inicial, Audiencia de Instrucción y Juzgamiento, Contestación, Traslado, Sentencia, Recursos, Mandamiento de Pago, Excepciones, Pruebas, Alegatos.
