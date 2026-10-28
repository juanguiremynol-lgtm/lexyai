# Activación coordinada de vigilancia

Proyecto confirmado: `qvuukbqcvlnvmcvcruji`. Base integrada: `025ddedb07c627fa6bd778ae9218098a79bd5f20`; esta rama conserva todo ese historial y añade correcciones de elegibilidad y reclamación. Antes de desplegar, volver a contrastar `main`, la rama y las funciones productivas.

## Estado al 28 de octubre de 2026

Las migraciones `20261028010000_samai_estados_circuit_breaker.sql` y `20261028020000_atenia_supported_queue_claim.sql` se aplicaron y registraron transaccionalmente. Los textos almacenados coinciden con los archivos; las funciones nuevas conceden ejecución solo a `service_role`. No repetirlas ni ejecutar todas las migraciones del repositorio. No se han publicado las funciones de esta rama ni cambiado los cron.

La CLI está en `/tmp/andromeda-supabase-cli-20261028/supabase`. La operación `functions list` devolvió `Access token not provided`; es necesaria una sesión de administración autorizada sobre el proyecto. No pasar secretos como argumentos ni publicarlos en logs. El runtime y Vault deben compararse sin revelar sus valores.

## Funciones afectadas

Los imports transitivos de los módulos compartidos alcanzan: `admin-diagnose-estados`, `admin-test-providers`, `atenia-ai-supervisor`, `atenia-cron-watchdog`, `atenia-server-heartbeat`, `bridge-reconcile`, `demo-radicado-lookup`, `fallback-sync-check`, `orchestrator-debug-run`, `scheduled-daily-sync`, `scheduled-publicaciones-monitor`, `scheduled-samai-estados-monitor`, `sync-by-radicado`, `sync-by-work-item` y `sync-publicaciones-by-work-item`. Confirmar cuáles existen y sus revisiones antes de publicarlas; Supabase empaqueta `_shared` por función. No usar `--prune` ni desactivar comprobaciones de seguridad para resolver errores.

El frontend también modifica `src/pages/WorkItemDetail/tabs/ActsTab.tsx` y `judicialQueryDisplay.ts`; requiere una publicación web separada de la versión integrada y una prueba con sesión autorizada.

## Secuencia

1. Comprobar con la CLI autenticada `functions list --project-ref qvuukbqcvlnvmcvcruji`, el contrato del lector SAMAI, las dos migraciones y los permisos. Conservar respaldo privado y revisiones anteriores.
2. Desplegar las versiones compatibles de ejecutores, monitores, watchdog y fallback; publicar los demás consumidores existentes de `_shared`. Verificar que los pendientes y parciales no se registren como éxito.
3. Verificar por identidad, destino y horario el cron 8 `atenia-server-heartbeat` (`0 */6 * * *`, UTC), respaldar su comando fuera del repositorio y confirmar que `CRON_SERVICE_KEY` en Vault coincide con el runtime. El cron 78 `atenia-ai-supervisor` debe verificarse por identidad, destino y clave técnica. No imprimir las claves ni el comando con credenciales.
4. En una ventana sin ejecución, aplicar explícitamente `coordination/20261028_atenia_heartbeat_cron_auth.sql` y publicar inmediatamente `atenia-server-heartbeat` protegido. El SQL exige que cron 8 esté activo; una pausa exige adaptar y probar esa precondición antes de usarla. Comprobar heartbeat autenticado y rechazo anónimo.
5. Publicar `atenia-ai-supervisor` protegido y `scheduled-daily-sync`; comprobar la llamada técnica, el rechazo anónimo antes de datos de negocio, un administrador legítimo y el resultado persistido. No dejar expuesto el heartbeat anterior como intermediario privilegiado. Si falla, mantener la ruta protegida o temporalmente detenida y corregir hacia adelante; no restaurar una ruta anónima privilegiada.
6. Antes de recuperar la cola, verificar `SKIPPED`, reactivación tras pausa, entrega tardía y resultado parcial. Identificar trabajos elegibles afectados y sin ejecución vigente; conservar intentos y causas. Probar un lote pequeño y luego el resto elegible, respetando el breaker. No reencolar los históricos indiscriminadamente.
7. Verificar las dos fuentes SAMAI por separado, la lectura en aplicación, la publicación web y una ejecución programada realmente observada. Una consulta forzada, una llamada HTTP 200 o una futura ejecución prevista no acreditan el ciclo completo.

La CLI usa por función la sintaxis siguiente desde este checkout, tras comprobar acceso; no contiene secretos:

```sh
/tmp/andromeda-supabase-cli-20261028/supabase functions deploy NOMBRE_FUNCION --project-ref qvuukbqcvlnvmcvcruji
```

El SQL de cron está fuera de `supabase/migrations`: debe ejecutarse expresamente por el canal SQL autorizado y no se ejecuta al publicar una función.

## Recuperación selectiva de SAMAI Estados

La corrida del 28 de octubre `f3e27d50-4d97-4a49-aa45-78c3cfffe110` contiene 15 resultados agotados. Los 15 asuntos ya tienen una fila `PUB_RETRY` activa: no insertar copias ni cambiar la corrida histórica. Comprobar su situación en el momento de la ejecución, pues puede haber cambiado.

La migración `20261028030000_retry_provider_deferral.sql` añade el resultado `DEFERRED` a `finish_sync_retry`. Aplicar antes de desplegar `process-retry-queue` de esta rama; el orden inverso puede generar errores. La función SQL conserva los caminos existentes de `SUCCESS`, `RETRY` y `EXHAUSTED`; en `INELIGIBLE` registra el contador existente sin sumar una consulta que no ocurrió. Bajo `DEFERRED` conserva el contador y libera solo la concesión coincidente. No rebajar sus permisos. Publicar también `sync-publicaciones-by-work-item`, que incorpora el control de inscripción para CPACA y TUTELA, y los módulos compartidos que empaquetan ambas funciones.

Una pausa de vigilancia conserva la fila y la difiere hasta un día sin consumir intentos. Si se reactiva, la fila se vuelve elegible en su siguiente vencimiento; la recuperación inmediata tras reactivar todavía requiere comprobación productiva. La eliminación terminal conserva el resultado en `sync_retry_outcomes`. No reactivar trabajos de asuntos eliminados ni deshabilitados.

La guardia cubre SAMAI Estados para CPACA, tanto en el monitor diario como en la ruta manual. En TUTELA evita consultar SAMAI Estados si está deshabilitado sin impedir la lectura de Publicaciones Procesales; si no puede verificar la habilitación, conserva el resultado de PP como parcial. La guardia no garantiza por sí sola la selección correcta de todos los elementos del snapshot diario ni la habilitación individual de otras fuentes. La tabla de ítems del monitor solo admite PENDING, CLAIMED, SUCCESS y FAILED, por lo que una exclusión en esa vía todavía no se registra como SKIPPED. No considerar cerrados esos límites sin corrección y prueba de integración.
