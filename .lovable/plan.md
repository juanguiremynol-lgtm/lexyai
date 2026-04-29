# Ocultar botones vacíos y marcar "Documento clasificado" en anexos SAMAI

## Qué cambia
En `src/pages/WorkItemDetail/tabs/WorkItemActCard.tsx`, ajustar el render de la sección "Documentos adjuntos" (Row 6, líneas ~474–518) para que:

1. **Botón "Descargar" se oculta** si `urlDescarga` es `null`, `undefined`, o string vacío/whitespace.
2. **Botón "Ver" se oculta** si `urlVer` es `null`, `undefined`, o string vacío/whitespace.
3. Si la actuación tiene **`raw_data.estado === 'CLASIFICADA'`** y **ningún anexo** tiene URL válida (ni `urlVer` ni `urlDescarga`), en lugar de los botones se muestra un badge pequeño con el texto **"Documento clasificado"**.

Nada más cambia: la condición para mostrar la sección, el conteo, el título "📎 Documentos adjuntos (N)", el tooltip con `descripcion`, y el resto del card siguen igual.

## Detalle técnico

- Helper local `hasUrl(u?: string | null) => !!u && u.trim().length > 0` para evaluar URLs vacías.
- Por cada `doc` calcular `showVer = hasUrl(doc.urlVer)` y `showDescarga = hasUrl(doc.urlDescarga)`.
- Condicionales `{showVer && (...)}` y `{showDescarga && (...)}` reemplazan los `{doc.urlVer && ...}` actuales.
- Calcular una vez por card:
  - `estado = (rawData?.estado as string | undefined)?.toUpperCase()`
  - `anyValidUrl = samaiAttachments.some(d => hasUrl(d.urlVer) || hasUrl(d.urlDescarga))`
- En cada `<li>`, si `!showVer && !showDescarga && estado === 'CLASIFICADA'` (o equivalentemente `!anyValidUrl && estado === 'CLASIFICADA'` aplicado a nivel de doc), renderizar un badge en el mismo slot:
  ```tsx
  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">
    Documento clasificado
  </span>
  ```
  Si no hay URLs válidas y el estado **no** es `CLASIFICADA`, el slot de botones queda vacío (no se inventa otro texto).

## Fuera de alcance
- No se modifica `extractSamaiAttachments` ni el filtro que decide si la sección aparece.
- No se cambia el flujo de fetch/dedup/sort en `useSamaiActuaciones`.
- No se introduce nuevo dependencia ni componente.
