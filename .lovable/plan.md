
# Plan: Auto-Populate All Work Item Fields from API Lookup Results

## Problem Summary
When a user searches for a radicado in the Creation Wizard and finds data from external APIs, only some fields are auto-populated. The user still sees empty form fields for information that was already fetched (departamento, filing dates, accionado for Tutelas, etc.), requiring unnecessary manual entry.

## Current State
The wizard fetches `process_data` with these fields:
- `despacho` (court/authority name) ✅ Populated
- `ciudad` ✅ Populated  
- `departamento` ❌ NOT populated
- `demandante` ✅ Populated
- `demandado` ✅ Populated
- `fecha_radicacion` ❌ NOT populated
- `tipo_proceso` ❌ NOT populated (could be used for title)
- `clase_proceso` ❌ NOT used
- `actuaciones` ✅ Passed as `initial_actuaciones`

## Solution

### 1. Expand Auto-Population in CreateWorkItemWizard

Update the `useEffect` that applies lookup data (lines 194-208) to populate ALL available fields:

```text
Current fields populated:
- authorityName ← despacho
- authorityCity ← ciudad
- demandantes ← demandante  
- demandados ← demandado

Fields to ADD:
- authorityDepartment ← departamento
- tutelaFilingDate ← fecha_radicacion (for TUTELA)
- filingDate ← fecha_radicacion (for PETICION/other)
- accionado ← demandado (for TUTELA - same concept)
- title ← tipo_proceso or auto-generated title
```

### 2. Generate Smart Title from API Data

When `tipo_proceso` is available, auto-generate a descriptive title:
- For Tutela: "Tutela vs [Accionado]"
- For CGP: "[Tipo Proceso] - [Demandante] vs [Demandado]"
- For CPACA: "[Medio de Control] vs [Demandado]"

### 3. Handle Tutela-Specific Fields

For Tutela workflow:
- `accionado` field should be populated from `demandado` (legally equivalent)
- `demandados` should also be set (for consistency)
- `tutelaFilingDate` from `fecha_radicacion`

### 4. Visual Feedback for Pre-Populated Fields

Add subtle visual indicator to show which fields came from API vs manual entry:
- Light border or icon showing "auto-populated from API"
- User can still edit if needed

---

## Technical Implementation

### File: `src/components/workflow/CreateWorkItemWizard.tsx`

**Change 1: Expand the auto-populate useEffect (lines 194-208)**

```typescript
// Apply lookup data to form fields - EXPANDED
useEffect(() => {
  if (lookupResult?.process_data && lookupStatus === 'success') {
    const data = lookupResult.process_data;
    
    // Authority information
    setAuthorityName(data.despacho || '');
    setAuthorityCity(data.ciudad || '');
    setAuthorityDepartment(data.departamento || ''); // NEW
    
    // Parties (general)
    setDemandantes(data.demandante || '');
    setDemandados(data.demandado || '');
    
    // Tutela-specific: accionado = demandado
    if (workflowType === 'TUTELA' && data.demandado) {
      setAccionado(data.demandado);
    }
    
    // Filing date (workflow-specific)
    if (data.fecha_radicacion) {
      const parsedDate = parseApiDate(data.fecha_radicacion);
      if (parsedDate) {
        if (workflowType === 'TUTELA') {
          setTutelaFilingDate(parsedDate);
        } else if (workflowType === 'PETICION') {
          setFilingDate(parsedDate);
        }
      }
    }
    
    // Auto-generate title if not set
    if (!title && data.tipo_proceso) {
      let autoTitle = '';
      if (workflowType === 'TUTELA' && data.demandado) {
        autoTitle = `Tutela vs ${data.demandado.split(',')[0]?.trim() || data.demandado}`;
      } else if (data.demandante && data.demandado) {
        autoTitle = `${data.tipo_proceso} - ${data.demandante.split(',')[0]?.trim()} vs ${data.demandado.split(',')[0]?.trim()}`;
      } else {
        autoTitle = data.tipo_proceso;
      }
      setTitle(autoTitle.slice(0, 100)); // Limit length
    }
    
    // Set CGP phase based on classification
    if (workflowType === 'CGP' && lookupResult.cgp_phase) {
      setCgpPhase(lookupResult.cgp_phase);
    }
  }
}, [lookupResult, lookupStatus, workflowType, title]);
```

**Change 2: Add date parsing helper function**

```typescript
// Helper to parse Colombian date formats to YYYY-MM-DD
function parseApiDate(dateStr: string | undefined): string | null {
  if (!dateStr) return null;
  
  // Already ISO format
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
    return dateStr.split('T')[0];
  }
  
  // DD/MM/YYYY or DD-MM-YYYY
  const match = dateStr.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (match) {
    const [, day, month, year] = match;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  
  return null;
}
```

**Change 3: Add visual indicator for auto-populated fields (optional enhancement)**

Track which fields were auto-populated and show a subtle indicator:

```typescript
// State to track auto-populated fields
const [autoPopulatedFields, setAutoPopulatedFields] = useState<Set<string>>(new Set());

// In the useEffect, track what was auto-filled
if (data.despacho) {
  setAutoPopulatedFields(prev => new Set([...prev, 'authorityName']));
}
// ... etc

// In the form fields, show indicator
<Input
  value={authorityName}
  onChange={(e) => {
    setAuthorityName(e.target.value);
    setAutoPopulatedFields(prev => { 
      const next = new Set(prev); 
      next.delete('authorityName'); 
      return next; 
    });
  }}
  className={autoPopulatedFields.has('authorityName') ? 'border-primary/30' : ''}
/>
{autoPopulatedFields.has('authorityName') && (
  <span className="text-xs text-primary/60 flex items-center gap-1">
    <CheckCircle2 className="h-3 w-3" /> Obtenido de API
  </span>
)}
```

---

## Summary of Changes

| Component | Change |
|-----------|--------|
| `useEffect` (lines 194-208) | Expand to populate: `authorityDepartment`, `tutelaFilingDate`, `filingDate`, `accionado`, `title` |
| Date parsing | Add `parseApiDate()` helper for Colombian date formats |
| Title generation | Auto-generate from `tipo_proceso` + parties |
| Tutela handling | Map `demandado` → `accionado` (legally equivalent) |
| Visual feedback | (Optional) Show which fields came from API |

## Expected User Experience After Changes

1. User selects "Tutela" workflow
2. User enters radicado and clicks "Buscar Proceso"
3. API returns data with: despacho, ciudad, departamento, accionado (demandado), fecha_radicacion, actuaciones
4. User sees "Proceso encontrado" preview with all data
5. User clicks "Siguiente" (Next)
6. **Details form is pre-populated with ALL available data:**
   - Title: "Tutela vs [Accionado Name]"
   - Accionado: [pre-filled from API]
   - Fecha de Radicación: [pre-filled]
   - Juzgado: [pre-filled from despacho]
7. User only needs to select client and confirm

## Files to Modify

1. `src/components/workflow/CreateWorkItemWizard.tsx` - Expand auto-population logic
