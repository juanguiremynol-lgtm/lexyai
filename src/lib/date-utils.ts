/**
 * Date parsing utilities for Colombian date formats
 */

/**
 * Parse Colombian date formats to YYYY-MM-DD
 * Handles:
 * - ISO format: YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS
 * - Colombian format: DD/MM/YYYY or DD-MM-YYYY
 * - Natural language: "15 de enero de 2024"
 */
export function parseApiDate(dateStr: string | undefined | null): string | null {
  if (!dateStr) return null;
  
  const trimmed = dateStr.trim();
  if (!trimmed) return null;
  
  // Already ISO format (YYYY-MM-DD or with timestamp)
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    return trimmed.split('T')[0];
  }
  
  // DD/MM/YYYY or DD-MM-YYYY
  const slashDashMatch = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (slashDashMatch) {
    const [, day, month, year] = slashDashMatch;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  
  // Natural language: "15 de enero de 2024" or "15 enero 2024"
  const months: Record<string, string> = {
    'enero': '01', 'febrero': '02', 'marzo': '03', 'abril': '04',
    'mayo': '05', 'junio': '06', 'julio': '07', 'agosto': '08',
    'septiembre': '09', 'octubre': '10', 'noviembre': '11', 'diciembre': '12'
  };
  
  const naturalMatch = trimmed.toLowerCase().match(/(\d{1,2})\s*(?:de\s*)?(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s*(?:de\s*)?(\d{4})/);
  if (naturalMatch) {
    const [, day, monthName, year] = naturalMatch;
    const month = months[monthName];
    if (month) {
      return `${year}-${month}-${day.padStart(2, '0')}`;
    }
  }
  
  return null;
}

/**
 * Generate a smart title based on workflow type and API data
 */
export function generateSmartTitle(
  workflowType: string,
  tipoProceso?: string,
  demandante?: string,
  demandado?: string
): string {
  // Get first party name (before comma if multiple)
  const getFirstName = (names?: string): string => {
    if (!names) return '';
    return names.split(',')[0]?.trim() || names.trim();
  };
  
  const firstDemandante = getFirstName(demandante);
  const firstDemandado = getFirstName(demandado);
  
  let autoTitle = '';
  
  if (workflowType === 'TUTELA' && firstDemandado) {
    // Tutela: "Tutela vs [Accionado]"
    autoTitle = `Tutela vs ${firstDemandado}`;
  } else if (workflowType === 'CPACA' && firstDemandado) {
    // CPACA: "[Tipo] vs [Demandado]" or just "CPACA vs [Demandado]"
    const tipoLabel = tipoProceso || 'Proceso CPACA';
    autoTitle = `${tipoLabel} vs ${firstDemandado}`;
  } else if (tipoProceso && firstDemandante && firstDemandado) {
    // General: "[Tipo] - [Demandante] vs [Demandado]"
    autoTitle = `${tipoProceso} - ${firstDemandante} vs ${firstDemandado}`;
  } else if (tipoProceso && firstDemandado) {
    // Fallback with tipo + demandado
    autoTitle = `${tipoProceso} vs ${firstDemandado}`;
  } else if (tipoProceso) {
    // Just tipo proceso
    autoTitle = tipoProceso;
  } else if (firstDemandante && firstDemandado) {
    // Just parties
    autoTitle = `${firstDemandante} vs ${firstDemandado}`;
  }
  
  // Limit length to 100 characters
  return autoTitle.slice(0, 100);
}
