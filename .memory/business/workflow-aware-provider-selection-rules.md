# Memory: business/workflow-aware-provider-selection-rules
Updated: just now

Provider selection is workflow-aware with STRICT NO-FALLBACK enforcement for CGP/LABORAL:

- **CGP/LABORAL**: CPNU is PRIMARY and ONLY provider. NO fallback to SAMAI under any circumstance because civil/labor/family processes in CPNU are NOT found in SAMAI (the fallback is technically useless and generates noise). If CPNU fails with error, returns HTTP 502 with code CPNU_SYNC_FAILED.

- **CPACA**: SAMAI is PRIMARY (administrative litigation); CPNU is optional fallback (disabled by default).

- **TUTELA**: Uses PARALLEL sync strategy - queries ALL sources (CPNU, SAMAI, tutelas-api/Corte Constitucional) simultaneously using Promise.all. Results are consolidated using smart deduplication that groups by (date|type|descriptionPrefix), picks the most complete version, and tracks all confirming sources in the `sources[]` array. Multi-source confirmed records get confidence=1.0. Fingerprints use `ms_` prefix to distinguish from single-source records.

- **PENAL_906**: Publicaciones Procesales is PRIMARY (called first) because penal updates frequently surface via published PDFs; CPNU/SAMAI disabled by default.

Stage inference patterns for CGP include: Auto Admisorio, Notificación, Audiencia Inicial, Audiencia de Instrucción y Juzgamiento, Contestación, Traslado, Sentencia, Recursos, Mandamiento de Pago, Excepciones, Pruebas, Alegatos.
