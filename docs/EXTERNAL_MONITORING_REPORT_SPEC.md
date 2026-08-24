# SPEC — Informe externo de monitoreo (correo de las 02:52)

> **Estado**: contrato requerido. El emisor NO es Andromeda.
> **Evidencia**: el correo de las 02:52 del 24/08/2026 no existe en
> `email_outbox`; ninguna función de la plataforma lo produjo. Sale de un
> remitente externo (`monitoreo@…`) que consulta a los proveedores por su
> cuenta y no lee la base de Andromeda.

## 1. Por qué este documento existe

Ese informe reportó `0/0/0/0` y "sin sincronizar hace 109 días" para
radicados que **sí** se sincronizaron ese mismo día. Es decir: contradice a
Supabase, que es la única fuente de verdad. Un informe que contradice la
fuente de verdad no es un informe: es ruido que obliga al abogado a decidir a
cuál de los dos correos creerle.

Andromeda no puede corregir el contenido de un emisor que no controla. Lo que
sí puede hacer —y lo que este documento fija— es el contrato mínimo que ese
informe debe cumplir para poder convivir con el resumen diario.

## 2. Contrato mínimo

Un informe externo es admisible únicamente si cumple **todas** estas
condiciones:

1. **Lee de Supabase, no del proveedor.** Los conteos deben salir de
   `v_monitored_work_items`, `work_item_acts` y `work_item_publicaciones`, no
   de una consulta propia al proveedor. Dos lectores independientes producen
   dos verdades.
2. **Respeta la exclusión estructural.** Un asunto eliminado
   (`deleted_at is not null`) o con monitoreo oculto no aparece en nada.
3. **Usa `detected_at` como reloj.** Es el único marcador de "cuándo lo supo
   Andromeda". `act_date` es cuándo ocurrió en el despacho, y no sirve para
   medir frescura de sincronización.
4. **Usa `is_notifiable` para contar novedades.** El historial importado de un
   expediente reactivado no es novedad del día.
5. **No afirma frescura sin leer `external_sync_runs`.** "Sin sincronizar hace
   N días" debe derivarse de `last_successful_sync_at` /
   `external_sync_runs`, y una ausencia respondida por el proveedor
   (`ANSWERED_ABSENCE`) es una sincronización exitosa, no un silencio.
6. **Se identifica.** Asunto y pie deben decir que el emisor es externo, para
   que el abogado no lo confunda con el resumen diario de Andromeda.

## 3. Recomendación

Mientras el informe externo no cumpla el contrato, debe **desactivarse**. El
resumen diario consolidado ya cubre lo mismo con datos verificables. Mantener
ambos garantiza que uno de los dos esté equivocado cada mañana.

## 4. Qué hace Andromeda hoy

| Correo | Emisor | Momento | Contenido |
| --- | --- | --- | --- |
| Resumen diario consolidado | Andromeda (`scheduled-daily-digest`) | Encadenado al fin de la sincronización; respaldo 08:30 COT | Novedades reales, historial importado aparte, audiencias, términos |
| Aviso inmediato | Andromeda (`dispatch-update-emails`) | Solo si el abogado o el asunto lo pidieron | Un evento puntual, nunca repetido por el resumen |
| Informe externo 02:52 | Tercero | 02:52 | Fuera del contrato (ver arriba) |
