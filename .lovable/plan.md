## Objetivo

Forzar el ocultamiento de los botones **Ver** y **Descargar** en cada anexo SAMAI cuando la actuación tenga `raw_data.estado === "CLASIFICADA"`, mostrando en su lugar siempre el badge **"Documento clasificado"** — sin importar lo que traigan `urlVer` / `urlDescarga`.

Para actuaciones con cualquier otro estado (`REGISTRADA`, etc.), el comportamiento actual se mantiene: se muestran los botones solo si la URL correspondiente es no-vacía.

## Cambios

**Archivo único**: `src/pages/WorkItemDetail/tabs/WorkItemActCard.tsx` (líneas 474–531).

Lógica nueva por anexo:

```text
si isClasificada:
    ocultar Ver
    ocultar Descargar
    mostrar badge "Documento clasificado"
si NO isClasificada:
    mostrar Ver       solo si urlVer       es string no vacío (con trim)
    mostrar Descargar solo si urlDescarga  es string no vacío (con trim)
    (sin badge)
```

### Detalle técnico

```tsx
const showVer       = !isClasificada && hasUrl(doc.urlVer);
const showDescarga  = !isClasificada && hasUrl(doc.urlDescarga);
const showBadge     = isClasificada;
```

- El helper `hasUrl` y la detección de `isClasificada` (uppercase) ya existen — solo se reordena la condición.
- El badge de "Documento clasificado" ahora se renderiza **siempre que** `isClasificada`, no solo cuando faltan URLs.
- No se tocan estilos, ni los demás campos de la card, ni la lógica de `extractSamaiAttachments`.

## Verificación post-cambio

1. Abrir un work item CPACA con anexos en estado `CLASIFICADA` → confirmar que solo aparece el badge ámbar.
2. Abrir uno con anexos en estado `REGISTRADA` y URLs válidas → confirmar que aparecen Ver y Descargar como antes.
3. Caso mixto (REGISTRADA con `urlDescarga` null) → solo Ver visible.
