# Memory: business/workflow-aware-provider-selection-rules
Updated: just now

Provider selection is workflow-aware per business requirements: CGP/LABORAL use CPNU primary with SAMAI fallback; CPACA uses SAMAI primary with optional CPNU; TUTELA uses TUTELAS API primary with CPNU fallback; PENAL_906 uses Publicaciones Procesales as PRIMARY (called first) with CPNU/SAMAI disabled by default. This reflects Colombian judicial jurisdiction specifics where CPACA uses administrative courts (SAMAI source) and PENAL updates surface via published court documents.
