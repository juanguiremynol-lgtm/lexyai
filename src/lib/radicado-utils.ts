/**
 * Radicado Normalization and Validation Utilities
 * 
 * Handles various radicado input formats and normalizes to 23-digit standard
 * 
 * CRITICAL: Radicado must ALWAYS be treated as a STRING to preserve leading zeros.
 * Never use parseInt() or Number() on radicado values.
 */

export interface NormalizeResult {
  ok: boolean;
  radicado23?: string;
  error?: {
    code: 'INVALID_FORMAT' | 'EMPTY_INPUT' | 'TOO_SHORT' | 'TOO_LONG' | 'INVALID_ENDING';
    message: string;
    inputLength?: number;
  };
}

/**
 * Parsed radicado blocks from a 23-digit radicado
 * 
 * Structure: DDDDD-CC-EE-DDD-YYYY-CCCCC-RR
 *   DANE(5)  = dept(2) + municipality(3)
 *   CORP(2)  = corporation/judicial body code
 *   ESP(2)   = specialty/area code
 *   DESP(3)  = consecutive office number
 *   YEAR(4)  = filing year
 *   CONSEC(5)= annual filing sequence
 *   RECURSO(2)= appeal/resource sequence
 */
export interface RadicadoBlocks {
  dane: string;       // 5 digits: dept(2) + municipality(3)
  dept: string;       // 2 digits (from dane)
  municipality: string; // 3 digits (from dane)
  corp: string;       // 2 digits
  esp: string;        // 2 digits
  desp: string;       // 3 digits
  year: string;       // 4 digits
  consec: string;     // 5 digits
  recurso: string;    // 2 digits
}

export interface ParseRadicadoResult {
  valid: boolean;
  blocks?: RadicadoBlocks;
  radicado23?: string;
  errors: string[];
  warnings: string[];
}

/**
 * Parse a 23-digit radicado into its component blocks with validation.
 */
export function parseRadicadoBlocks(input: string): ParseRadicadoResult {
  if (!input) {
    return { valid: false, errors: ['El radicado no puede estar vacío'], warnings: [] };
  }

  const cleaned = normalizeRadicadoInput(input);
  
  if (cleaned.length === 0) {
    return { valid: false, errors: ['El radicado no contiene dígitos válidos'], warnings: [] };
  }
  
  if (cleaned.length !== 23) {
    return {
      valid: false,
      errors: [`El radicado debe tener exactamente 23 dígitos (tiene ${cleaned.length})`],
      warnings: [],
    };
  }

  if (!/^\d{23}$/.test(cleaned)) {
    return { valid: false, errors: ['El radicado debe contener solo dígitos numéricos'], warnings: [] };
  }

  const blocks: RadicadoBlocks = {
    dane: cleaned.slice(0, 5),
    dept: cleaned.slice(0, 2),
    municipality: cleaned.slice(2, 5),
    corp: cleaned.slice(5, 7),
    esp: cleaned.slice(7, 9),
    desp: cleaned.slice(9, 12),
    year: cleaned.slice(12, 16),
    consec: cleaned.slice(16, 21),
    recurso: cleaned.slice(21, 23),
  };

  const errors: string[] = [];
  const warnings: string[] = [];

  // Validate year (1990 to current+1)
  const yearNum = parseInt(blocks.year, 10);
  const currentYear = new Date().getFullYear();
  if (yearNum < 1990 || yearNum > currentYear + 1) {
    errors.push(`Año inválido: ${blocks.year} (esperado 1990–${currentYear + 1})`);
  }

  // Validate DANE is not all zeros
  if (blocks.dane === '00000') {
    errors.push('Código DANE inválido (00000)');
  }

  // Warn on unusual recurso values
  const recursoNum = parseInt(blocks.recurso, 10);
  if (recursoNum > 10) {
    warnings.push(`Recurso ${blocks.recurso} es inusualmente alto`);
  }

  // Warn if desp is 000 (typically collegiate bodies)
  if (blocks.desp === '000') {
    warnings.push('Despacho 000 indica cuerpo colegiado (Tribunal/Corte)');
  }

  return {
    valid: errors.length === 0,
    blocks: errors.length === 0 ? blocks : undefined,
    radicado23: cleaned,
    errors,
    warnings,
  };
}

/**
 * Format radicado with block labels for display
 */
export function formatRadicadoWithLabels(radicado23: string): Array<{ label: string; value: string; code: string }> {
  if (!radicado23 || radicado23.length !== 23) return [];
  const parsed = parseRadicadoBlocks(radicado23);
  if (!parsed.blocks) return [];
  const b = parsed.blocks;
  return [
    { label: 'DANE (Depto + Muni)', value: b.dane, code: 'dane' },
    { label: 'Corporación', value: b.corp, code: 'corp' },
    { label: 'Especialidad', value: b.esp, code: 'esp' },
    { label: 'Despacho', value: b.desp, code: 'desp' },
    { label: 'Año', value: b.year, code: 'year' },
    { label: 'Consecutivo', value: b.consec, code: 'consec' },
    { label: 'Recurso', value: b.recurso, code: 'recurso' },
  ];
}

export interface CompletenessValidation {
  isComplete: boolean;
  missingFields: string[];
  warnings: string[];
}

/**
 * CGP-specific validation result
 */
export interface CgpValidationResult {
  valid: boolean;
  normalized: string;
  error?: string;
  errorCode?: 'EMPTY' | 'INVALID_LENGTH' | 'INVALID_ENDING' | 'INVALID_CHARS';
}

/**
 * Normalize radicado input - strips all non-digit characters
 * 
 * CRITICAL: This function preserves leading zeros by returning a string.
 * 
 * Accepts formats like:
 * - 05001400302320250063800 (pure 23 digits)
 * - 05-00-14-00-30-23-20-25-00-638-00 (with dashes)
 * - 05 00 14 00 30 23 2025 00638 00 (with spaces)
 * - 050014003023_2025_00638_00 (Icarus format)
 */
export function normalizeRadicadoInput(input: string): string {
  if (!input) return '';
  // Remove ALL non-digit characters, preserving the string format
  return input.replace(/\D/g, '');
}

/**
 * Validate radicado for CGP workflow
 * 
 * Rules:
 * - Exactly 23 digits
 * - Must end with 00 or 01
 * - Must be treated as string (never numeric)
 */
export function isValidCgpRadicado(radicado: string): boolean {
  if (!radicado || typeof radicado !== 'string') return false;
  // Must be exactly 23 digits
  if (!/^\d{23}$/.test(radicado)) return false;
  // Must end with 00 or 01
  const ending = radicado.slice(-2);
  return ending === '00' || ending === '01';
}

/**
 * Comprehensive CGP radicado validation with detailed error messages
 */
export function validateCgpRadicado(input: string): CgpValidationResult {
  if (!input || input.trim().length === 0) {
    return {
      valid: false,
      normalized: '',
      error: 'El radicado no puede estar vacío',
      errorCode: 'EMPTY',
    };
  }

  const normalized = normalizeRadicadoInput(input);

  if (normalized.length === 0) {
    return {
      valid: false,
      normalized: '',
      error: 'El radicado no contiene dígitos válidos',
      errorCode: 'INVALID_CHARS',
    };
  }

  if (normalized.length !== 23) {
    return {
      valid: false,
      normalized,
      error: `El radicado debe tener exactamente 23 dígitos numéricos (tiene ${normalized.length})`,
      errorCode: 'INVALID_LENGTH',
    };
  }

  const ending = normalized.slice(-2);
  if (ending !== '00' && ending !== '01') {
    return {
      valid: false,
      normalized,
      error: `El radicado debe terminar en 00 o 01 (termina en ${ending})`,
      errorCode: 'INVALID_ENDING',
    };
  }

  return {
    valid: true,
    normalized,
  };
}

/**
 * Normalize radicado input to 23-digit format with full validation
 * 
 * Accepts formats like:
 * - 05001400302320250063800 (pure 23 digits)
 * - 05-00-14-00-30-23-20-25-00-638-00 (with dashes)
 * - 05 00 14 00 30 23 2025 00638 00 (with spaces)
 * - 050014003023_2025_00638_00 (Icarus format)
 */
export function normalizeRadicado(input: string): NormalizeResult {
  if (!input || input.trim().length === 0) {
    return {
      ok: false,
      error: {
        code: 'EMPTY_INPUT',
        message: 'El radicado no puede estar vacío',
      },
    };
  }

  // Remove all non-numeric characters (preserves as string)
  const cleaned = normalizeRadicadoInput(input);

  if (cleaned.length === 0) {
    return {
      ok: false,
      error: {
        code: 'INVALID_FORMAT',
        message: 'El radicado no contiene dígitos válidos',
        inputLength: 0,
      },
    };
  }

  if (cleaned.length < 23) {
    return {
      ok: false,
      error: {
        code: 'TOO_SHORT',
        message: `El radicado tiene ${cleaned.length} dígitos, se requieren 23`,
        inputLength: cleaned.length,
      },
    };
  }

  if (cleaned.length > 23) {
    return {
      ok: false,
      error: {
        code: 'TOO_LONG',
        message: `El radicado tiene ${cleaned.length} dígitos, máximo 23`,
        inputLength: cleaned.length,
      },
    };
  }

  return {
    ok: true,
    radicado23: cleaned,
  };
}

/**
 * Format radicado for display with separators
 * Example: 05001400302320250063800 -> 05-001-4003-023-2025-00638-00
 */
export function formatRadicadoDisplay(radicado23: string): string {
  if (!radicado23 || radicado23.length !== 23) return radicado23 || '';
  
  return [
    radicado23.slice(0, 2),   // Departamento
    radicado23.slice(2, 5),   // Municipio  
    radicado23.slice(5, 9),   // Entidad
    radicado23.slice(9, 12),  // Especialidad
    radicado23.slice(12, 16), // Año
    radicado23.slice(16, 21), // Consecutivo
    radicado23.slice(21, 23), // Dígito control
  ].join('-');
}

/**
 * Validate response completeness to detect "silencios"
 * 
 * A "silencio" is when the API returns success but with incomplete data
 */
export function validateCompleteness(data: unknown): CompletenessValidation {
  const missingFields: string[] = [];
  const warnings: string[] = [];

  if (!data || typeof data !== 'object') {
    return {
      isComplete: false,
      missingFields: ['data'],
      warnings: ['Respuesta vacía o inválida'],
    };
  }

  const response = data as Record<string, unknown>;

  // Check for proceso object
  if (!response.proceso) {
    missingFields.push('proceso');
  } else {
    const proceso = response.proceso as Record<string, unknown>;
    
    // Required proceso fields
    if (!proceso['Despacho'] && !proceso.despacho) {
      missingFields.push('proceso.despacho');
    }
    if (!proceso['Tipo de Proceso'] && !proceso.tipo_proceso && !proceso.tipo) {
      warnings.push('Tipo de proceso ausente');
    }
  }

  // Check for sujetos_procesales
  const sujetos = response.sujetos_procesales as unknown[];
  if (!sujetos || !Array.isArray(sujetos) || sujetos.length === 0) {
    missingFields.push('sujetos_procesales');
  }

  // Check for actuaciones
  const actuaciones = response.actuaciones as unknown[];
  if (!actuaciones || !Array.isArray(actuaciones) || actuaciones.length === 0) {
    missingFields.push('actuaciones');
  }

  // Check for estados_electronicos (optional but important)
  const estados = response.estados_electronicos as unknown[];
  if (!estados || !Array.isArray(estados) || estados.length === 0) {
    warnings.push('Estados electrónicos ausentes');
  }

  return {
    isComplete: missingFields.length === 0,
    missingFields,
    warnings,
  };
}

/**
 * Check if a response indicates a false negative (NO_ENCONTRADO that might be wrong)
 */
export function isFalseNegativeRisk(response: unknown): boolean {
  if (!response || typeof response !== 'object') return false;
  
  const data = response as Record<string, unknown>;
  
  // If it says NO_ENCONTRADO but also has some data, it's suspicious
  if (data.estado === 'NO_ENCONTRADO') {
    // Check if there's partial data that suggests the process exists
    if (data.proceso || data.sujetos_procesales || data.actuaciones) {
      return true; // Has data but says not found
    }
    
    // Check if success is true but estado is NO_ENCONTRADO (contradiction)
    if (data.success === true) {
      return true;
    }
  }
  
  return false;
}

/**
 * Golden test data for radicado 05001400302320250063800
 */
export const GOLDEN_TEST_DATA = {
  radicado: '05001400302320250063800',
  radicadoFormatted: '05-00-14-00-30-23-20-25-00-638-00',
  expected: {
    despacho: 'JUZGADO 023 CIVIL MUNICIPAL DE MEDELLÍN',
    tipo: 'Declarativo',
    clase: 'Verbal',
    demandantes: [
      'RODRIGO ALONSO RESTREPO CABALLERO',
      'TULIA MARGARITA RESTREPO CABALLERO',
    ],
    demandados: [
      'GLORIA ELENA HENAO HENAO',
      'PATRICIA RESTREPO HENAO',
    ],
    minActuaciones: 10,
    minEstados: 3,
    requiredActuaciones: [
      { type: 'RADICACIÓN DE PROCESO', date: '2025-04-07' },
    ],
    requiredEstados: [
      '2025-00638AutoRequierePrevioDT.pdf',
      '2025-00638AutoAdmiteReformaDemanda.pdf',
    ],
  },
} as const;

/**
 * Validate response against golden test expectations
 */
export interface GoldenTestResult {
  passed: boolean;
  score: number;
  maxScore: number;
  checks: Array<{
    name: string;
    passed: boolean;
    expected: string;
    actual: string;
    critical: boolean;
  }>;
}

export function validateGoldenTest(data: unknown): GoldenTestResult {
  const checks: GoldenTestResult['checks'] = [];
  let passed = true;

  if (!data || typeof data !== 'object') {
    return {
      passed: false,
      score: 0,
      maxScore: 10,
      checks: [{
        name: 'Respuesta válida',
        passed: false,
        expected: 'Objeto con datos',
        actual: 'null o inválido',
        critical: true,
      }],
    };
  }

  const response = data as Record<string, unknown>;
  const proceso = response.proceso as Record<string, string> | undefined;
  const sujetos = (response.sujetos_procesales || []) as Array<{ tipo: string; nombre: string }>;
  const actuaciones = (response.actuaciones || []) as Array<Record<string, string>>;
  const estados = (response.estados_electronicos || []) as Array<Record<string, string>>;

  // Check 1: success === true
  const isSuccess = response.success === true;
  checks.push({
    name: 'success === true',
    passed: isSuccess,
    expected: 'true',
    actual: String(response.success),
    critical: true,
  });
  if (!isSuccess) passed = false;

  // Check 2: Despacho contains expected text
  const despacho = proceso?.['Despacho'] || proceso?.despacho || '';
  const despachoMatch = despacho.toUpperCase().includes('JUZGADO 023 CIVIL MUNICIPAL') ||
                        despacho.toUpperCase().includes('023 CIVIL MUNICIPAL DE MEDELLÍN');
  checks.push({
    name: 'Despacho correcto',
    passed: despachoMatch,
    expected: GOLDEN_TEST_DATA.expected.despacho,
    actual: despacho || '(vacío)',
    critical: true,
  });
  if (!despachoMatch) passed = false;

  // Check 3: Demandantes
  const demandantes = sujetos.filter(s => 
    s.tipo?.toLowerCase().includes('demandante') || 
    s.tipo?.toLowerCase().includes('accionante')
  );
  const expectedDemandantes = GOLDEN_TEST_DATA.expected.demandantes;
  const demandantesFound = expectedDemandantes.filter(exp =>
    demandantes.some(d => 
      d.nombre?.toUpperCase().includes(exp.split(' ').slice(0, 2).join(' '))
    )
  );
  const demandantesOk = demandantesFound.length >= 2;
  checks.push({
    name: 'Demandantes correctos',
    passed: demandantesOk,
    expected: expectedDemandantes.join(', '),
    actual: demandantes.map(d => d.nombre).join(', ') || '(vacío)',
    critical: true,
  });
  if (!demandantesOk) passed = false;

  // Check 4: Demandados
  const demandados = sujetos.filter(s => 
    s.tipo?.toLowerCase().includes('demandado') || 
    s.tipo?.toLowerCase().includes('accionado')
  );
  const expectedDemandados = GOLDEN_TEST_DATA.expected.demandados;
  const demandadosFound = expectedDemandados.filter(exp =>
    demandados.some(d => 
      d.nombre?.toUpperCase().includes(exp.split(' ').slice(0, 2).join(' '))
    )
  );
  const demandadosOk = demandadosFound.length >= 2;
  checks.push({
    name: 'Demandados correctos',
    passed: demandadosOk,
    expected: expectedDemandados.join(', '),
    actual: demandados.map(d => d.nombre).join(', ') || '(vacío)',
    critical: true,
  });
  if (!demandadosOk) passed = false;

  // Check 5: Tipo y Clase
  const tipo = proceso?.['Tipo de Proceso'] || proceso?.tipo || '';
  const clase = proceso?.['Clase de Proceso'] || proceso?.clase || '';
  const tipoOk = tipo.toLowerCase().includes('declarativo');
  const claseOk = clase.toLowerCase().includes('verbal');
  checks.push({
    name: 'Tipo = Declarativo',
    passed: tipoOk,
    expected: 'Declarativo',
    actual: tipo || '(vacío)',
    critical: false,
  });
  checks.push({
    name: 'Clase = Verbal',
    passed: claseOk,
    expected: 'Verbal',
    actual: clase || '(vacío)',
    critical: false,
  });

  // Check 6: Actuaciones count >= 10
  const actuacionesOk = actuaciones.length >= GOLDEN_TEST_DATA.expected.minActuaciones;
  checks.push({
    name: 'Actuaciones >= 10',
    passed: actuacionesOk,
    expected: `>= ${GOLDEN_TEST_DATA.expected.minActuaciones}`,
    actual: String(actuaciones.length),
    critical: true,
  });
  if (!actuacionesOk) passed = false;

  // Check 7: Has RADICACIÓN DE PROCESO on 2025-04-07
  const hasRadicacion = actuaciones.some(act => {
    const actText = (act['Actuación'] || act.actuacion || '').toUpperCase();
    const actDate = act['Fecha de Actuación'] || act.fecha_actuacion || '';
    return actText.includes('RADICACIÓN') && actDate.includes('2025-04-07');
  });
  checks.push({
    name: 'Tiene RADICACIÓN DE PROCESO (07-abr-25)',
    passed: hasRadicacion,
    expected: 'RADICACIÓN DE PROCESO @ 2025-04-07',
    actual: hasRadicacion ? 'Encontrado' : 'No encontrado',
    critical: true,
  });
  if (!hasRadicacion) passed = false;

  // Check 8: Estados electrónicos >= 3
  const estadosOk = estados.length >= GOLDEN_TEST_DATA.expected.minEstados;
  checks.push({
    name: 'Estados electrónicos >= 3',
    passed: estadosOk,
    expected: `>= ${GOLDEN_TEST_DATA.expected.minEstados}`,
    actual: String(estados.length),
    critical: false,
  });

  // Check 9: Has required estados
  const requiredEstados = GOLDEN_TEST_DATA.expected.requiredEstados;
  const foundEstados = requiredEstados.filter(req =>
    estados.some(e => (e.nombre_archivo || e.nombre || '').includes(req))
  );
  const estadosFilesOk = foundEstados.length >= 1;
  checks.push({
    name: 'Estados requeridos presentes',
    passed: estadosFilesOk,
    expected: requiredEstados.join(', '),
    actual: estados.map(e => e.nombre_archivo || e.nombre).slice(0, 5).join(', ') || '(vacío)',
    critical: false,
  });

  // Calculate score
  const criticalChecks = checks.filter(c => c.critical);
  const passedCritical = criticalChecks.filter(c => c.passed).length;
  const passedOptional = checks.filter(c => !c.critical && c.passed).length;
  const score = passedCritical * 2 + passedOptional;
  const maxScore = criticalChecks.length * 2 + checks.filter(c => !c.critical).length;

  return {
    passed: passed && checks.filter(c => c.critical).every(c => c.passed),
    score,
    maxScore,
    checks,
  };
}
