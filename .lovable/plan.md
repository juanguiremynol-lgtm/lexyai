# Migrar Actuaciones a `GET /radicados/:radicado/actuaciones`

Verificado: el endpoint devuelve 42 actuaciones reales para `05001400301520240193000`. El endpoint `/estados` también responde (vacío por ahora).

## Problema actual

Los hooks `use-cpnu-actuaciones`, `use-pp-actuaciones`, `use-samai-actuaciones` están leyendo de `/radicados/:r/novedades`, que solo devuelve **cambios detectados** (3 filas), no las actuaciones crudas (42 filas). Por eso la pestaña Actuaciones se ve casi vacía.

## Cambios

### 1. `src/hooks/use-cpnu-actuaciones.ts`
- Cambiar URL de `/novedades?dias=90` a `/actuaciones`.
- Parsear `body.actuaciones` (no `body.novedades`).
- Filtrar por `fuente === "CPNU"` en cliente.
- Mapear nuevo schema:
  - `descripcion` → `description`
  - `anotacion` → `event_summary`
  - `fecha` → `act_date` (slice a 10 chars) + `act_date_raw`
  - `creado_en` → `detected_at` / `created_at`
  - `con_documentos` → guardar en `raw_data`
  - `fecha_inicial`/`fecha_final` → `raw_data`

### 2. `src/hooks/use-pp-actuaciones.ts`
- Misma URL `/actuaciones`.
- El nuevo schema solo lista `fuente: "CPNU"|"SAMAI"` — **PP no aparece**. Por ahora filtrar por `fuente === "PP"` (devolverá vacío) y dejar el hook listo para cuando PP se incorpore. Documentar en comentario.

### 3. `src/hooks/use-samai-actuaciones.ts`
- Misma URL `/actuaciones`.
- Filtrar por `fuente === "SAMAI"` (y `SAMAI_ESTADOS` si llegara a aparecer).
- Mantener la deduplicación por `description + act_date`.

### 4. Sin cambios a hooks de novedades
`use-cpnu-novedades` y `use-pp-novedades` siguen apuntando a `/novedades` — esos representan diffs/cambios detectados, no actuaciones crudas. Es correcto.

### 5. Estados (opcional, pequeño)
No tocar en este PR. El endpoint `/estados` existe y responde vacío; cuando se quiera reemplazar la lectura de `work_item_publicaciones` por la API se hará en un cambio separado.

## Verificación

1. Abrir `/app/work-items/91edd371-6ce7-4427-b837-36058410ab3f` (radicado `05001400301520240193000`).
2. Network tab: confirmar `GET /radicados/05001400301520240193000/actuaciones` con 200.
3. Pestaña Actuaciones: confirmar que se renderizan ~42 filas (las CPNU; SAMAI/PP siguen en 0).
4. Sin errores 404 ni CORS en consola.

## Archivos a editar

- `src/hooks/use-cpnu-actuaciones.ts`
- `src/hooks/use-pp-actuaciones.ts`
- `src/hooks/use-samai-actuaciones.ts`
