## Objetivo

Convertir el wizard de alta en un flujo "confirmar, no digitar": el usuario nunca ingresa manualmente lo que el radicado o CPNU ya saben, y todo fallo silencioso se vuelve visible.

## Alcance (todo en un turno)

### 1. Diagnóstico del render de partes (WI de prueba `05001333301520260011300`)

Ruta a auditar en vivo con el radicado real:
`useRadicadoLookup.lookup()` → edge `sync-by-radicado` (LOOKUP) → `adapter-cpnu` → `ProcessData.sujetos_procesales[]` → `WizardProcessPreview` (líneas 120–162).

Hipótesis a validar con logs y payload real (una llamada, un fixture guardado en `/tmp/`):
- **A.** `sync-by-radicado` promueve `sujetos_procesales` a `demandante`/`demandado` (line 873–874 de `adapter-cpnu`), pero en jurisdicción administrativa los tipos suelen ser `DEMANDANTE`, `ACCIONANTE`, `CONVOCANTE`, `TERCERO` — el filtro por `.includes('demandante')` puede fallar si CPNU devuelve solo `PARTE ACTIVA` o similar.
- **B.** El wizard solo renderiza `sujetos_procesales` si `demandante` **y** `demandado` están vacíos (línea 152). Si CPNU trae uno de los dos, el otro no se muestra ni desde sujetos.
- **C.** `sync-by-radicado.mergeProviderResults` puede estar dropeando `sujetos_procesales` en el merge (no está en `firstWinsFields`).

Fix aplicable a las tres:
- Ampliar el matcher tipo→rol en el edge (`demandante|accionante|convocante|parte activa` → demandantes; `demandado|accionado|convocado|parte pasiva|entidad demandada` → demandados).
- Preservar `sujetos_procesales` en el merge (agregar a `firstWinsFields`).
- En `WizardProcessPreview` renderizar **siempre** sujetos si existen, y completar demandantes/demandados vacíos derivándolos del array de sujetos (no un fallback exclusivo).

### 2. Auto-población obligatoria en el wizard

Nuevo helper `src/lib/radicado-derivation.ts`:
- `deriveWorkflowFromCorp(corp: '02'|'03'|'04'|'05'|'06'|'07'|'08'|'10'|'11'|'12'|'13'|'14'|'15'|'20'|'21'|'22'|'23'|'30'|'31'|'33'|'40'|'41'|'45'|'50'|...)`
  - `30`–`32` → CGP civil/comercial/familia
  - `33`–`35` → CPACA
  - `40`–`42` → LABORAL
  - `06`–`09` / `36` → PENAL_906
  - resto → `null` (sugerencia débil)
- `deriveLocationFromDane(dane5: string)` — usa un lookup mínimo embebido de departamentos DANE (`05`→Antioquia, `11`→Bogotá D.C., `76`→Valle, etc.) y para municipio consulta `courthouse_directory.municipio` cuando el par (`dane5`, ciudad) exista; si no, deja municipio vacío pero devuelve depto siempre.

Uso en `CreateWorkItemWizard.tsx`:
- En el step `radicado`, cuando `radicado.length === 23`, calcular `derived = { workflow, city, department, corp, esp }` y mostrarlo antes del botón "Buscar":
  - Banner **verde** si `derived.workflow === workflowType`.
  - Banner **amarillo** con CTA "Cambiar a CPACA" (o el que corresponda) si difieren — al hacer clic reasigna `workflowType` y limpia lookup previo. Si el usuario confirma el mismatch, guardar un flag `wizard_override_workflow=true` en `notes`/audit para trazabilidad.
- Autopoblar `authorityDepartment`/`authorityCity` desde DANE si el lookup no los trae.
- Preservar lo que ya trae la fuente: solo llenar campos vacíos, nunca sobrescribir input del usuario.

### 3. Feedback explícito ante fallo o payload parcial

En `WizardProcessPreview` añadir estados visibles:
- `sin partes` → "No se pudieron recuperar las partes desde CPNU/SAMAI. Puedes ingresarlas manualmente abajo."
- `sin despacho` → "El despacho no llegó en la respuesta. Verifica manualmente."
- `sources_found` vacío pero `pp_lookup=processing` → "Estamos escaneando el portal en segundo plano — los datos se completarán solos en el próximo ciclo."
- Cuando `attempts[].success=false` para todos, mostrar el error real (no genérico).

En el paso `details` del wizard, si algún autopoblado vino vacío, marcar el input con borde ámbar y helper "sugerido manualmente".

### 4. Auditoría de flujo post-creación

Verificar en `useCreateWorkItem.onSuccess`:
- `set_work_item_lifecycle(..., 'ACTIVE', 'USER', ...)` explícito tras el `INSERT` — el INSERT solo pone `monitoring_enabled=true` pero no dispara `gcp_lifecycle_outbox`. Agregar la RPC.
- Consolidar los 3 registros paralelos (`registerAndSyncCpnu/Pp/Samai`) — todos son no-ops (ya deprecados). Eliminar las llamadas y dejar un solo comentario apuntando al cron server-side. Reduce ruido en consola y evita confusión.
- Encadenar `sync-publicaciones-by-work-item` **antes** de `sync-by-work-item` (publicaciones puebla estados; los triggers de deadline se disparan al insertar el estado con `fecha_fijacion`). Hoy corren en paralelo.
- Preservar los campos CPNU perdidos: en `initial_actuaciones` (líneas 149–194 del hook), enriquecer `raw_data` con `fecha_registro`, `fecha_inicia_termino`, `fecha_finaliza_termino`, `indice`, `documentos`, `anexos` **si el edge los devolvió** (requiere que `sync-by-radicado` deje de aplanarlos — cambio en `ProcessData.actuaciones` type y en el merge de línea 1014).

### 5. Backfill puntual del WI del Doctor

Una migración corta:
```sql
UPDATE work_items
   SET authority_city = COALESCE(NULLIF(authority_city,''), 'Medellín'),
       authority_department = COALESCE(NULLIF(authority_department,''), 'Antioquia')
 WHERE id = '6153c00f-4e3f-4ee8-aad2-064693ac3bb2';
```
Sin tocar partes (el Doctor las digitó).

### 6. Verificación end-to-end

- **Reproducción viva:** llamar `sync-by-radicado` LOOKUP con el radicado del Doctor desde exec y guardar el payload en `/tmp/wizard-repro/cpnu.json`. Contar sujetos, verificar que ahora se promueven a demandantes/demandados.
- **E2E sintético:** crear un WI con radicado sintético controlado (`11001333103320260099999`), ver que:
  - El banner corp→CPACA aparece.
  - DANE `11001` autopobla Bogotá D.C.
  - Post-creación: `lifecycle_state=ACTIVE`, `gcp_lifecycle_outbox` recibe evento, sync arranca.
  - Purga total del WI de prueba al final (via `set_work_item_lifecycle → DELETED` + purga del outbox).
- **Typecheck** + suite existente en verde (`bunx vitest run`).

## Detalles técnicos

Archivos que se modifican:
- `supabase/functions/adapter-cpnu/index.ts` — ampliar matcher tipo→rol.
- `supabase/functions/sync-by-radicado/index.ts` — preservar `sujetos_procesales` y campos CPNU (`fecha_registro/inicia_termino/finaliza_termino/indice/documentos/anexos`) en el shape `ProcessData.actuaciones` y en `mergeProviderResults.firstWinsFields`.
- `src/hooks/use-radicado-lookup.ts` — extender tipo `ProcessData.actuaciones` con los campos preservados.
- `src/lib/radicado-derivation.ts` — nuevo helper (corp→workflow, DANE→depto/ciudad).
- `src/components/workflow/CreateWorkItemWizard.tsx` — banner de derivación workflow, autopoblado depto/ciudad, feedback partial.
- `src/components/workflow/WizardProcessPreview.tsx` — render siempre-visible de partes, mensajes explícitos por estado degradado.
- `src/hooks/use-create-work-item.ts` — llamar `set_work_item_lifecycle` explícito, enriquecer `raw_data` de `initial_actuaciones` con campos CPNU completos, encadenar publicaciones → actuaciones sync, eliminar los 3 no-ops de `registerAndSync*`.
- Migración: backfill de ciudad/depto del WI del Doctor.

Nada de tocar `client.ts`, `types.ts`, `config.toml` ni schemas ajenos. Sin cambios en la lógica de cálculo de términos (solo se preservan los inputs que ya necesita).

## Fuera de alcance

- Rediseñar el orden de pasos del wizard (workflow→radicado→details→client sigue igual).
- Nuevos campos en `work_items` — todo cabe en columnas existentes.
- Cambios en el motor de términos.
