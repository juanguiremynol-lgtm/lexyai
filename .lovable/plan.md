

## Plan: Sección "Términos Procesales" en Estados de Hoy

### Contexto
La API `andromeda-read-api/terminos` devuelve plazos legales con: `id`, `radicado`, `workflow_type`, `despacho`, `demandante`, `demandado`, `tipo_auto`, `accion_abogado`, `dias_habiles`, `prioridad` (CRITICA/ALTA/NORMAL), `norma`, `consecuencia`, `fecha_auto`, `fecha_limite`, `descripcion_auto`, `estado` (PENDIENTE/ATENDIDO), `fuente`, `alerta` (VENCIDO/URGENTE/PROXIMO/VIGENTE), `dias_vencido`, `creado_en`. PATCH `/terminos/{id}/atender` con body `{notas}` marca como atendido y responde `{ok:true, id}`.

### Cambio 1 — `src/lib/services/andromeda-terminos.ts` (nuevo)

Servicio dedicado:

```ts
export interface TerminoItem {
  id: number;
  radicado: string;
  workflow_type: string | null;
  despacho?: string | null;
  demandante?: string | null;
  demandado?: string | null;
  tipo_auto?: string | null;
  accion_abogado?: string | null;
  dias_habiles?: number | null;
  prioridad: "CRITICA" | "ALTA" | "NORMAL" | string;
  norma?: string | null;
  consecuencia?: string | null;
  fecha_auto?: string | null;
  fecha_limite?: string | null;
  descripcion_auto?: string | null;
  estado: "PENDIENTE" | "ATENDIDO" | string;
  fuente?: string | null;
  alerta: "VENCIDO" | "URGENTE" | "PROXIMO" | "VIGENTE" | string;
  dias_vencido: number;
  creado_en: string;
}

export async function fetchTerminos(): Promise<TerminoItem[]>;
export async function atenderTermino(id: number, notas?: string): Promise<{ok:boolean}>;
```

`fetchTerminos` hace `GET ${ANDROMEDA_API_BASE}/terminos`. `atenderTermino` hace `PATCH /terminos/{id}/atender` con `{ notas }`.

### Cambio 2 — `src/components/terminos/TerminoCard.tsx` (nuevo)

Card por término con:

- **Top-left**: badge alerta + badge prioridad
  - Alerta: VENCIDO=`bg-red-500/15 text-red-700 border-red-300`, URGENTE=`bg-orange-500/15 text-orange-700 border-orange-300`, PROXIMO=`bg-yellow-500/15 text-yellow-700 border-yellow-300`, VIGENTE=`bg-green-500/15 text-green-700 border-green-300`.
  - Prioridad: CRITICA=rojo, ALTA=naranja, NORMAL=gris (mismo patrón).
- **Top-right**: badge fuente (reusa `fuenteBadgeClass` extraído).
- **Línea radicado**: `radicado` mono + workflow badge.
- **Despacho**: `Building2` + texto truncado.
- **Partes**: `Users` + `demandante vs demandado`.
- **Bloque destacado** (fondo `bg-muted/40 rounded p-2`):
  - `tipo_auto` en negrita.
  - `accion_abogado` en negrita.
- **Metadatos** (text-xs muted): `norma` · `Fecha límite: {fecha_limite}` · `{dias_habiles} días hábiles` · indicador "vence en {N} días" o "vencido hace {N} días" usando `dias_vencido`.
- **Consecuencia**: línea pequeña en rojo si existe (`AlertTriangle` icon).
- **Footer**:
  - Si `estado === "PENDIENTE"`: textarea opcional "Notas (acción tomada)" + botón "Marcar atendido" (variant default, icon `CheckCircle`).
  - Si `estado === "ATENDIDO"`: badge verde "Atendido" + el card completo con `opacity-60` y `line-through` en títulos.
- Borde izquierdo coloreado por alerta (rojo/naranja/amarillo/verde) o gris si atendido.

### Cambio 3 — `src/pages/EstadosHoy.tsx`

Agregar una sección "Términos Procesales" **arriba** del listado de estados (después del banner de ejecutoria, antes del search):

1. **Query nueva**:
   ```ts
   const { data: terminos, refetch: refetchTerminos } = useQuery({
     queryKey: ["terminos-andromeda"],
     queryFn: fetchTerminos,
     staleTime: 30_000,
   });
   ```

2. **Estado local de atendidos optimista**: `useMutation` que llama `atenderTermino` y al éxito invalida la query. Mientras tanto, se aplica update optimista cambiando `estado` a `ATENDIDO`.

3. **Ordenamiento**:
   - Pendientes primero (por orden de alerta: VENCIDO=0, URGENTE=1, PROXIMO=2, VIGENTE=3, otros=4), desempate por `dias_vencido` desc para vencidos / `dias_vencido` asc para resto (más cercanos al vencimiento primero).
   - Atendidos al final, ordenados por `creado_en` desc.

4. **Render**:
   ```tsx
   <section className="space-y-3">
     <h2 className="text-lg font-semibold flex items-center gap-2">
       <AlarmClock className="h-5 w-5 text-primary" />
       Términos Procesales
       {pendientesCount > 0 && (
         <Badge variant="destructive">{pendientesCount} pendientes</Badge>
       )}
     </h2>
     {terminosOrdenados.map(t => (
       <TerminoCard
         key={t.id}
         termino={t}
         onMarcarAtendido={(notas) => mutation.mutate({ id: t.id, notas })}
         loading={mutation.isPending && mutation.variables?.id === t.id}
       />
     ))}
   </section>
   ```

   Estado vacío: card con mensaje "No hay términos procesales activos".

### Cambio 4 — Refactor menor

Extraer `fuenteBadgeClass` de `EstadosHoy.tsx` a `src/lib/services/andromeda-novedades.ts` (export nombrado) para reusarla en `TerminoCard` sin duplicación. ActuacionesHoy también puede importarla en cleanup futuro (no en este PR).

### Notas de UX

- Optimistic update: al hacer click en "Marcar atendido", el card se mueve al final y aplica `line-through` inmediatamente. Si la mutación falla → toast error y revertir.
- Textarea de notas: máximo 500 caracteres, placeholder "¿Qué acción tomó? (opcional)".
- Toast de éxito: "Término marcado como atendido".

### Fuera de alcance
- No se persisten las notas localmente (solo se envían al PATCH; la API es la fuente de verdad).
- No se filtra por radicado/despacho dentro de la sección de términos (todo en una lista; si crece, se evaluará buscador propio).
- No se modifica `ActuacionesHoy.tsx`.
- No se crean alertas/notificaciones internas a partir de términos VENCIDO/URGENTE.

