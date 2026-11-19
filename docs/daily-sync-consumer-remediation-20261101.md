# Continuación de consumidores, 1 de noviembre de 2026

Se conserva main de Lovable `3cb51c3c4d5f30a2be64262dc7455a8c292492d2`.
No se modificaron ni publicaron interfaz, MCP o notificaciones. El runtime sigue
siendo el backend administrado por Lovable Cloud: proyecto
`fd922a87-5316-40ea-97b8-727cf903a9b8`, referencia `qvuukbqcvlnvmcvcruji`.

La publicación por UUID ya estaba resuelta. Esta continuación corrigió únicamente
el consumo de resultados acreditados y la adquisición de trabajo pendiente:

- SAMAI Estados: contador estructural inicializado y finito, contabilidad completa
  obligatoria y consumo protegido de `/persistido/{radicado}`. El caso
  `530e0e88-81be-4927-bcbe-ebbcbdbe674a` incorporó seis filas existentes a las
  11:54:57 Bogotá, conservando observación de fuente de las 08:03:06; cero
  inserciones y cero consultas nuevas al portal. No se certifican respuestas
  parciales, fijaciones de otro día o con más de veinte horas.
- CPNU: admisión diaria terminada permite incorporar un snapshot posterior
  completo, exclusivamente con `allow_buscar=false` y `force_refresh=false`.
  El bridge conserva el reloj de una consulta vacía válida. Una fecha antigua
  del último acto no invalida por sí sola una observación completa y reciente.
  Siguen rechazándose pérdida de registros, regresión y evidencia incompleta.
- Supervisor: cinco adquisiciones máximas; no repite tareas cuya incorporación
  completa ya está acreditada ni compite con el monitor durable de publicaciones.
  Pausa no equivale a eliminación; la prueba aislada acredita readmisión tras
  reactivación legítima. No se reactivó ningún asunto archivado en producción.
- Outbox: entrega de cambios de vigilancia al insertar eventos, una llamada por
  transacción. Respaldo horario del mismo trabajador, sin sondeo del proveedor.
  El archivo legítimo de `05001250200020260298900` se transmitió al backend.

Publicaciones desplegadas por el canal soportado de Lovable:

| Función | Fuente efectiva | Mensaje de despliegue |
|---|---|---|
| sync-publicaciones-by-work-item | `5cb64d12f532df601b859c2a285c7fbef5399fc6` | `umsg_01m6c02dnpfze927qcsrjmwvvt` |
| atenia-ai-supervisor | `1f6dec5a1fbecc0c31b56aa8544418f35eafc4fd` | `umsg_01m6c1760bfem934d6sapf3ed7` |
| sync-by-work-item, última publicación | `3cb51c3c4d5f30a2be64262dc7455a8c292492d2` | `umsg_01m6c3xw9xf1e9f4gnv440mrgd` |

El SHA-256 del punto de entrada de la última es
`493b6185f1f37d90dcb05c3d67926cb6c30423fd2a160ec89cd492b422b86510`.
Es la huella del archivo contrastado con la publicación; no se inventó un
`DEPLOY_SHA` del runtime ni se inspeccionó independientemente todo el bundle.

SQL aplicado, con before-images privados, privilegios preservados y sin
reinicialización de intentos: `20261101_j5_stored_monitor_resume.sql`,
`20261101_supervisor_verified_ingestion.sql`,
`20261101_cpnu_stored_consumer_acceptance.sql`,
`20261101_cpnu_freshness_consumer_acceptance.sql`,
`20261101_pp_laboral_consumer_resume.sql` y `20261101_lifecycle_delivery.sql`,
todos bajo `coordination/`. No se reaplicó0099 ni modificó Vault.

Las 29 discrepancias iniciales CPNU están conciliadas por UUID: dos ya se habían
incorporado automáticamente después del corte; 24 esperaban consumo, una estaba
bloqueada por la admisión anterior, una perdía el reloj de la respuesta vacía
y una conserva un efecto de audiencia ambiguo. Quedan 28 incorporaciones
completas y una parcial, con sus actuaciones persistidas. Se conservaron los
identificadores de las ejecuciones nativas y se verificó el lector autorizado
de los 29 asuntos. No fueron 29 novedades judiciales nuevas.

El parcial es `7b038fac-f82a-4619-8c10-fe1fe22b8d57`, radicado
`05001400301120240210000`: `POST_INGEST_EFFECTS_PENDING`, suspensión de audiencia
sin destinatario inequívoco en el acto `eb10f20b-8d53-45bc-b764-a7af9eb80256`.
No se modificaron audiencias ni términos para declararlo completo.

Los lectores de J6/J13 laborales incorporaron los UUID completos por el cron
ordinario97 a las 13:05 Bogotá. Los relojes de fuente de las 12:50/12:51 se
conservan. Las verificaciones visuales siguen pendientes: no hay sesión de
navegador autorizada. MCP y lectura bajo autorización no demuestran los botones.

El informe y las matrices de corte final están en Andromeda-,
`docs/daily-sync-remediation-20261101.md`, y el vector en
`coordination/daily-sync-remediation-release-20261101.json`.
Se mantienen fuera la reparación histórica excluida, las dos alertas y el término
de treinta días.
