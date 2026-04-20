

## Plan: Desbloquear el fetch en EstadosHoy.tsx

### Problema
El `useQuery` tiene `enabled: !!organization?.id`, lo que impide que el fetch a Andromeda se dispare hasta que `OrganizationContext` resuelva. En esta sesión (Super Admin) el contexto puede tardar o devolver `null`, dejando el query congelado y sin generar ningún request en Network.

### Cambio en `src/pages/EstadosHoy.tsx`

1. **Eliminar `enabled: !!organization?.id`** del `useQuery` principal (el de Andromeda en líneas 135-173). El endpoint `/novedades` no depende de la organización; es un feed global filtrado en cliente.

2. **Quitar `organization?.id` del `queryKey`** del mismo query, ya que deja de ser una dependencia real:
   ```ts
   queryKey: ["estados-hoy-andromeda", debouncedSearch],
   ```

3. **Mantener** la condición `enabled: !!organization?.id` en el segundo query (`sync-health-estados`, línea 194), porque ese SÍ consulta `atenia_ai_reports` filtrado por `organization_id`.

### Verificación posterior
Recargar `/app/estados-hoy`. En Network debe aparecer inmediatamente:
```
GET https://andromeda-read-api-486431576619.us-central1.run.app/novedades?desde=...&hasta=...
```
Con un status real (200 si CORS está OK, error CORS visible si todavía falta whitelistear `*.lovable.app`).

### Fuera de alcance
- No se toca `andromeda-novedades.ts`.
- No se toca el filtro de fuentes ni la ventana de 30 días.
- No se modifica `ActuacionesHoy.tsx`.
- No se cambia `OrganizationContext`.

