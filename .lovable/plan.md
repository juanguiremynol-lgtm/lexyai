

# Plan: Mejorar el Botón "+" para Consultar Todas las APIs Externas

## Situación Actual

El botón **"+"** en el Dashboard abre el `CreateWorkItemWizard`, que actualmente:

1. **Solo consulta CPNU** durante el paso de "Buscar Proceso" (LOOKUP mode)
2. No consulta SAMAI, TUTELAS ni PUBLICACIONES
3. Las otras APIs solo se consultan **después** de crear el work_item (cuando se llama a `sync-by-work-item`)

### Flujo Actual

```text
[Botón +] 
    → CreateWorkItemWizard
        → useRadicadoLookup (hook)
            → sync-by-radicado (edge function)
                → adapter-cpnu ONLY
                    → CPNU API
```

## Problema

- Si un proceso está en **SAMAI** (CPACA, administrativo) pero no en CPNU, no se muestra preview
- Si el usuario ingresa un **código de tutela** (T1234567), no se consulta la API de TUTELAS
- Los datos de **Publicaciones Procesales** no se obtienen hasta después de crear el item

## Solución Propuesta

Modificar el edge function `sync-by-radicado` para que en modo **LOOKUP** también consulte SAMAI, TUTELAS y opcionalmente Publicaciones, dependiendo del `workflow_type` seleccionado.

### Cambios Necesarios

#### 1. Edge Function: `sync-by-radicado/index.ts`

**Ubicación:** `supabase/functions/sync-by-radicado/index.ts`

**Cambios:**

- **Líneas ~374-467**: Agregar lógica para consultar múltiples providers según `workflow_type`
- Usar la misma estrategia de `getProviderOrder()` que existe en `sync-by-work-item`
- Para CPACA: consultar SAMAI primero, luego CPNU como fallback
- Para TUTELA: consultar CPNU primero, luego API de TUTELAS si hay tutela_code
- Consolidar resultados de múltiples fuentes

**Pseudocódigo:**

```typescript
// En lugar de solo llamar adapter-cpnu:

const providerOrder = getProviderOrder(workflowType);

// Try primary provider first
let processData = await callProvider(providerOrder.primary, radicado);

// If not found and fallback enabled, try fallback
if (!processData.found && providerOrder.fallbackEnabled && providerOrder.fallback) {
  processData = await callProvider(providerOrder.fallback, radicado);
}

// Return consolidated data with source info
```

#### 2. Agregar funciones para llamar SAMAI

**Nuevo código en sync-by-radicado:**

```typescript
async function fetchFromSamai(radicado: string, authHeader: string): Promise<ProviderResult> {
  const samaiBaseUrl = Deno.env.get('SAMAI_BASE_URL');
  const apiKey = Deno.env.get('SAMAI_X_API_KEY') || Deno.env.get('EXTERNAL_X_API_KEY');
  
  if (!samaiBaseUrl || !apiKey) {
    return { ok: false, error: 'SAMAI not configured' };
  }
  
  const response = await fetch(
    `${samaiBaseUrl}/snapshot?numero_radicacion=${radicado}`,
    {
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
      }
    }
  );
  
  // Parse and normalize SAMAI response...
}
```

#### 3. Agregar funciones para llamar TUTELAS API

```typescript
async function fetchFromTutelas(tutelaCode: string, authHeader: string): Promise<ProviderResult> {
  const tutelasBaseUrl = Deno.env.get('TUTELAS_BASE_URL');
  const apiKey = Deno.env.get('TUTELAS_X_API_KEY') || Deno.env.get('EXTERNAL_X_API_KEY');
  
  // TUTELAS uses POST /search with JSON body
  const response = await fetch(
    `${tutelasBaseUrl}/search`,
    {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ radicado: tutelaCode })
    }
  );
  
  // Parse and normalize response...
}
```

#### 4. Actualizar la respuesta del LOOKUP

Modificar la respuesta para incluir información de todos los providers consultados:

```typescript
const response: SyncResponse = {
  ok: true,
  found_in_source: foundInSource,
  source_used: primarySource, // 'CPNU' | 'SAMAI' | 'TUTELAS'
  sources_checked: ['CPNU', 'SAMAI'], // Lista de todos los consultados
  process_data: consolidatedData,
  attempts: allAttempts, // Incluir timing de cada provider
};
```

### Matriz de Providers por Workflow

| Workflow Type | Provider Primario | Fallback | Notas |
|---------------|-------------------|----------|-------|
| CGP | CPNU | ❌ Ninguno | Procesos civiles solo en CPNU |
| LABORAL | CPNU | ❌ Ninguno | Procesos laborales solo en CPNU |
| CPACA | SAMAI | CPNU (disabled) | Contencioso-administrativo |
| TUTELA | CPNU | TUTELAS API | Usar tutela_code si disponible |
| PENAL_906 | CPNU | SAMAI | + Publicaciones como fuente primaria |

### Archivos a Modificar

| Archivo | Cambio |
|---------|--------|
| `supabase/functions/sync-by-radicado/index.ts` | Agregar lógica multi-provider para LOOKUP mode |
| `src/hooks/use-radicado-lookup.ts` | Actualizar tipos para incluir `sources_checked` |
| `src/components/workflow/CreateWorkItemWizard.tsx` | Mostrar fuente de datos en preview |

### Beneficios

1. **Mejor UX**: El usuario ve datos del proceso antes de crearlo, sin importar la fuente
2. **Menos errores**: Si CPNU falla, se intenta SAMAI automáticamente
3. **Consistencia**: Usa la misma lógica de providers que `sync-by-work-item`
4. **Debugging**: Los attempts de cada provider se registran para diagnóstico

---

## Detalles Técnicos

### Variables de Entorno Requeridas

Las siguientes ya están configuradas en el proyecto:
- `CPNU_BASE_URL`
- `SAMAI_BASE_URL`
- `TUTELAS_BASE_URL`
- `EXTERNAL_X_API_KEY`

### Headers Requeridos

Todos los Cloud Run services requieren:
- `x-api-key` (lowercase, case-sensitive)
- `Content-Type: application/json`

### Manejo de Errores

- Si el provider primario falla con 404: intentar fallback
- Si el provider primario falla con error de red: log y continuar
- Si todos los providers fallan: retornar `found_in_source: false` con detalles

