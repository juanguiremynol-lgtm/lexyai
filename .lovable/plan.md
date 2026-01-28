

# Plan: Fix Critical Publicaciones/Estados Pipeline Issues

## Executive Summary

This plan addresses 6 critical issues in the Publicaciones (Estados) feature that is essential for lawyers to track legal deadlines. The most critical finding is that **deadline dates are being fetched from the API but NOT stored in the database**, causing the Estados tab to miss vital information.

---

## Issue Analysis Summary

| # | Issue | Severity | Root Cause |
|---|-------|----------|------------|
| 1 | SAMAI auth check uses wrong endpoint | **MEDIUM** | Uses `/snapshot` (actually correct - both CPNU and SAMAI use this) |
| 2 | Missing deadline fields not stored | **🔴 CRITICAL** | `fecha_fijacion`, `fecha_desfijacion`, `despacho` fetched but NOT saved |
| 3 | Publicaciones 404 lacks clear scraping feedback | **HIGH** | Auto-scrape exists but error messaging is unclear |
| 4 | Estados tab doesn't show deadline prominently | **HIGH** | UI reads from `raw_data` which isn't reliably populated |
| 5 | Actuaciones vs Estados confusion | **MEDIUM** | UI clarification needed |
| 6 | No alerts for new estados | **HIGH** | sync-publicaciones-by-work-item doesn't create alert_instances |

---

## Phase 1: Database Schema Update (CRITICAL)

### Migration: Add Missing Deadline Columns

```sql
-- Add critical deadline tracking columns
ALTER TABLE work_item_publicaciones 
ADD COLUMN IF NOT EXISTS fecha_fijacion TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS fecha_desfijacion TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS despacho TEXT,
ADD COLUMN IF NOT EXISTS tipo_publicacion TEXT;

-- Index for efficient deadline queries
CREATE INDEX IF NOT EXISTS idx_publicaciones_desfijacion 
ON work_item_publicaciones(fecha_desfijacion DESC) 
WHERE fecha_desfijacion IS NOT NULL;

-- Critical documentation
COMMENT ON COLUMN work_item_publicaciones.fecha_desfijacion IS 
  'CRITICAL: Legal términos begin the business day AFTER this date';
```

---

## Phase 2: Fix Edge Function - sync-publicaciones-by-work-item

### Task 2.1: Update PublicacionRaw Interface

**File**: `supabase/functions/sync-publicaciones-by-work-item/index.ts`

Add the missing deadline fields to the type:

```typescript
interface PublicacionRaw {
  title: string;
  annotation?: string;
  pdf_url?: string;
  published_at?: string;
  // ADD CRITICAL DEADLINE FIELDS:
  fecha_fijacion?: string;
  fecha_desfijacion?: string;
  despacho?: string;
  tipo_publicacion?: string;
  source_id?: string;
  raw?: Record<string, unknown>;
}
```

### Task 2.2: Update API Response Mapping (fetchPublicaciones)

Update the mapping at lines 221-228 to capture deadline fields:

```typescript
return {
  ok: true,
  publicaciones: publicaciones.map((pub: Record<string, unknown>) => ({
    title: String(pub.titulo || pub.title || pub.tipo_publicacion || pub.descripcion || 'Sin título'),
    annotation: pub.anotacion || pub.annotation || pub.detalle ? String(pub.anotacion || pub.annotation || pub.detalle) : undefined,
    pdf_url: pub.pdf_url || pub.url || pub.documento_url ? String(pub.pdf_url || pub.url || pub.documento_url) : undefined,
    published_at: pub.fecha_publicacion || pub.published_at || pub.fecha ? String(pub.fecha_publicacion || pub.published_at || pub.fecha) : undefined,
    // NEW: Map critical deadline fields
    fecha_fijacion: pub.fecha_fijacion ? String(pub.fecha_fijacion) : undefined,
    fecha_desfijacion: pub.fecha_desfijacion ? String(pub.fecha_desfijacion) : undefined,
    despacho: pub.despacho ? String(pub.despacho) : undefined,
    tipo_publicacion: pub.tipo_publicacion ? String(pub.tipo_publicacion) : undefined,
    source_id: pub.id ? String(pub.id) : undefined,
    raw: pub as Record<string, unknown>,
  })),
};
```

### Task 2.3: Update Database Insert

Update the insert statement at lines 377-390 to store deadline fields:

```typescript
const { error: insertError } = await supabase
  .from('work_item_publicaciones')
  .insert({
    work_item_id,
    organization_id: workItem.organization_id,
    source: 'publicaciones-procesales',
    title: pub.title,
    annotation: pub.annotation || null,
    pdf_url: pub.pdf_url || null,
    published_at: publishedAt ? new Date(publishedAt).toISOString() : null,
    // NEW: Store critical deadline fields
    fecha_fijacion: pub.fecha_fijacion ? parseDate(pub.fecha_fijacion) : null,
    fecha_desfijacion: pub.fecha_desfijacion ? parseDate(pub.fecha_desfijacion) : null,
    despacho: pub.despacho || null,
    tipo_publicacion: pub.tipo_publicacion || null,
    hash_fingerprint: fingerprint,
    raw_data: pub.raw || null,
  });
```

### Task 2.4: Add Alert Creation for New Estados

After successful insert, create an alert for deadline tracking:

```typescript
// After successful insert (inside the for loop, after result.inserted_count++)
if (pub.fecha_desfijacion) {
  const terminosInician = calculateNextBusinessDay(pub.fecha_desfijacion);
  
  await supabase.from('alert_instances').insert({
    owner_id: workItem.owner_id,
    organization_id: workItem.organization_id,
    entity_id: workItem.id,
    entity_type: 'WORK_ITEM',
    alert_type: 'ESTADO_PUBLICADO',
    severity: 'info',
    title: `Nuevo Estado: ${pub.tipo_publicacion || 'Estado'}`,
    message: `${pub.title} - Términos inician: ${terminosInician}`,
    status: 'ACTIVE',
    metadata: {
      publicacion_id: newPublicacionId,
      fecha_desfijacion: pub.fecha_desfijacion,
      terminos_inician: terminosInician,
    }
  });
}
```

Add helper function for business day calculation:

```typescript
function calculateNextBusinessDay(fechaDesfijacion: string): string | null {
  const date = parseDate(fechaDesfijacion);
  if (!date) return null;
  
  const d = new Date(date);
  d.setDate(d.getDate() + 1);
  
  // Skip weekends (0 = Sunday, 6 = Saturday)
  while (d.getDay() === 0 || d.getDay() === 6) {
    d.setDate(d.getDate() + 1);
  }
  
  return d.toISOString().split('T')[0];
}
```

### Task 2.5: Improve Scraping Feedback Response

Update the 404 handling to return clearer response:

```typescript
// When scraping fails completely, still indicate the 404 properly
return { 
  ok: false, 
  publicaciones: [], 
  error: 'RECORD_NOT_FOUND',
  scrapingInitiated: false,
  scrapingMessage: 'Registro no encontrado. La búsqueda automática no pudo iniciarse.'
};
```

---

## Phase 3: Update Frontend - EstadosTab

### Task 3.1: Update Unified Query to Use DB Columns

**File**: `src/pages/WorkItemDetail/tabs/EstadosTab.tsx`

Update the mapping of publicaciones to read from actual columns (not just raw_data):

```typescript
// Map work_item_publicaciones to unified format
const unifiedPubs: UnifiedEstado[] = pubs.map((pub: any) => ({
  id: pub.id,
  date: pub.published_at,
  date_raw: pub.published_at,
  description: pub.title + (pub.annotation ? ` - ${pub.annotation}` : ''),
  type: pub.tipo_publicacion || 'ESTADO',  // Use DB column
  source: pub.source || "PUBLICACIONES_API",
  source_reference: null,
  pdf_url: pub.pdf_url,
  is_publicacion: true,
  milestone_type: null,
  triggers_phase_change: false,
  created_at: pub.created_at,
  raw_data: {
    fecha_fijacion: pub.fecha_fijacion,      // From DB column
    fecha_desfijacion: pub.fecha_desfijacion, // From DB column
    tipo_publicacion: pub.tipo_publicacion,   // From DB column
    despacho: pub.despacho,                   // From DB column
    ...(pub.raw_data || {}),
  },
}));
```

### Task 3.2: Add Prominent Deadline Display

Enhance the card display for publicaciones with deadline info:

```typescript
{/* Publicacion deadline section - PROMINENT */}
{estado.is_publicacion && estado.raw_data?.fecha_desfijacion && (
  <div className="mt-2 p-2 bg-amber-50 dark:bg-amber-950/30 rounded border border-amber-200 dark:border-amber-800">
    <div className="flex items-center justify-between">
      <div className="text-sm">
        <span className="font-medium text-amber-700 dark:text-amber-300">
          ⚠️ Términos inician:
        </span>
        <span className="ml-2 font-bold">
          {calculateNextBusinessDay(estado.raw_data.fecha_desfijacion)}
        </span>
      </div>
      <div className="text-xs text-muted-foreground">
        Desfijación: {formatDate(estado.raw_data.fecha_desfijacion)}
      </div>
    </div>
  </div>
)}
```

### Task 3.3: Add Helper for Business Day Calculation

```typescript
function calculateNextBusinessDay(fechaDesfijacion: string): string {
  const date = new Date(fechaDesfijacion);
  date.setDate(date.getDate() + 1);
  
  // Skip weekends
  while (date.getDay() === 0 || date.getDay() === 6) {
    date.setDate(date.getDate() + 1);
  }
  
  return format(date, "d MMM yyyy", { locale: es });
}
```

### Task 3.4: Add Warning Banner When Showing raw_data Fallback

```typescript
{/* Warning if no proper deadline columns exist */}
{estado.is_publicacion && !estado.raw_data?.fecha_desfijacion && estado.raw_data?.raw && (
  <Badge variant="outline" className="text-xs text-amber-600">
    <AlertTriangle className="h-3 w-3 mr-1" />
    Sin fecha de desfijación
  </Badge>
)}
```

---

## Phase 4: Fix Provider Auth Endpoints (Optional Enhancement)

### Task 4.1: Use Provider-Specific Auth Test Endpoints

**File**: `supabase/functions/integration-health/index.ts`

While both CPNU and SAMAI currently use `/snapshot`, this can be made more robust:

```typescript
function getAuthTestPath(provider: string, testRadicado: string): string {
  const paths: Record<string, string> = {
    cpnu: `/snapshot?numero_radicacion=${testRadicado}`,
    samai: `/snapshot?numero_radicacion=${testRadicado}`, // Both use /snapshot
    tutelas: `/expediente/${testRadicado}`,
    publicaciones: `/publicaciones?radicado=${testRadicado}`,
  };
  return paths[provider] || `/health`;
}
```

---

## Files to Modify

| File | Changes | Priority |
|------|---------|----------|
| Database migration | Add 4 columns to work_item_publicaciones | 🔴 CRITICAL |
| `supabase/functions/sync-publicaciones-by-work-item/index.ts` | Store deadline fields + create alerts | 🔴 CRITICAL |
| `src/pages/WorkItemDetail/tabs/EstadosTab.tsx` | Display deadline dates prominently | HIGH |
| `supabase/functions/integration-health/index.ts` | Provider-specific auth paths | MEDIUM |

---

## Success Criteria

### Issue 2: Missing Deadline Fields (CRITICAL)
- [ ] `work_item_publicaciones` has columns: `fecha_fijacion`, `fecha_desfijacion`, `despacho`, `tipo_publicacion`
- [ ] sync-publicaciones-by-work-item maps and stores these fields
- [ ] After sync, `fecha_desfijacion` is populated in database

### Issue 4: Estados Tab Display
- [ ] Shows deadline dates prominently (amber warning box)
- [ ] Calculates and displays `términos_inician` (next business day)
- [ ] Shows days until deadline starts

### Issue 6: Alerts Integration
- [ ] New estados create `alert_instances` records
- [ ] Alert contains `términos_inician` date
- [ ] User receives notification for new estados

---

## Testing Checklist

1. **Database Verification**
   ```sql
   SELECT column_name FROM information_schema.columns 
   WHERE table_name = 'work_item_publicaciones' 
   AND column_name IN ('fecha_fijacion', 'fecha_desfijacion', 'despacho');
   -- Should return 3+ rows
   ```

2. **Sync Test**
   - Find a CGP/LABORAL work item with radicado
   - Click "Buscar Estados"
   - Check database: `SELECT fecha_desfijacion FROM work_item_publicaciones WHERE work_item_id = ?`
   - Verify Estados tab shows deadline info

3. **Alert Test**
   - After sync with new estados
   - Check: `SELECT * FROM alert_instances WHERE entity_id = ? AND alert_type = 'ESTADO_PUBLICADO'`

---

## Technical Notes

### Why This Matters for Lawyers

Estados/Publicaciones Procesales are the **official legal notifications** from Colombian courts. The `fecha_desfijacion` (removal date) is critical because:

1. Legal deadlines (términos) begin the **next business day** after desfijación
2. Missing a deadline can result in losing a case or malpractice
3. Lawyers historically had to physically check courthouse bulletin boards daily
4. This digital integration automates that critical monitoring

### Data Flow After Fix

```text
API Response → Edge Function → Database → UI
     ↓              ↓             ↓        ↓
fecha_desfijacion  Maps to      Stored    Displayed with
                   column       properly  deadline calculation
                                          + alert created
```

