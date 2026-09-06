# Memory: governance/monitoring-disabled-and-future-dated-policy
Updated: now

## Monitoreo desactivado
- `list_unmonitored_work_items()` powers `/app/sin-monitoreo` (badge + filter also in `/app/processes`).
- `is_procedurally_live_stage(stage)` = at/after AUTO_ADMISORIO and before SENTENCIA/ARCHIVO.
- `detect_monitoring_disabled_live()` emits WARNING alert type `MONITOREO_DESACTIVADO` (cron 12:45 UTC).
- Reactivation is ALWAYS manual; provider enrolment stays governed by the routing matrix
  (CPACA→SAMAI exclusive; CGP/Penal/Laboral→CPNU+PP; TUTELA→full union).

## Fechas futuras — POLÍTICA VIGENTE (reemplaza la cuarentena anterior)
Fundamento: CGP art. 295 ordena fijar el estado el día siguiente al de la providencia, y la
Ley 2213 de 2022 art. 9 lo publica en el sitio web. Los despachos publican la planilla la
tarde anterior a la fijación. **Una fecha de fijación futura es el estado normal y esperado
del dato**, y es el único momento en que tiene valor anticipatorio para el abogado.

- Una fecha futura NUNCA excluye filas: aparecen en estados, agenda diaria, novedades
  recientes, "última actuación" y clasificación de recencia como cualquier otra fila.
- En lugar de ocultarlas se etiquetan en la UI: **"Programado para DD/MM/AAAA"**, junto a la
  fecha ya mostrada (EstadosTable, ActuacionesTable, Estados de hoy). Es etiqueta, no filtro.
- La condición se **deriva en lectura** (`programadoLabel` / `isProgramado` en
  `src/lib/colombia-date-utils.ts`) comparando `fecha_fijacion` / `act_date` contra el día
  calendario en America/Bogota, de modo que se corrige sola cuando llega la fecha.
- `is_future_dated` sigue existiendo como columna derivada (triggers `flag_future_dated_act`
  / `_pub`) y sólo se usa como conteo informativo en el reporte diario de Atenia. No es
  criterio de exclusión en ninguna lectura. Las filas históricas cuya fecha ya llegó fueron
  recalculadas a false.
- No existe ni debe crearse una cola de revisión humana para fechas futuras.

## Comparación de fechas en columnas timestamptz
`work_item_publicaciones.fecha_fijacion` y `published_at` son timestamptz y las filas se
almacenan a las 12:00:00+00. Una igualdad contra "YYYY-MM-DD" (que castea a medianoche UTC)
NUNCA coincide. Todo filtro por día debe usar rango `[inicio de día, inicio del día siguiente)`
en instante UTC con offset -05:00 (`bogotaDayStartUTC` en `src/lib/mcp/shared.ts`).
Afecta a `get_estados_hoy` y `list_publicaciones`.
