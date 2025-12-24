import * as XLSX from "xlsx";

export interface EstadosExcelRow {
  radicado_raw: string;
  radicado_norm: string;
  distrito: string;
  despacho: string;
  juez_ponente: string;
  demandantes: string;
  demandados: string;
  fecha_ultima_actuacion_raw: string;
  fecha_ultima_actuacion: string | null;
  // Additional columns that may be present
  actuacion: string;
  anotacion: string;
  inicia_termino: string;
  fecha_inicia_termino: string | null;
  fecha_inicia_termino_raw: string;
  fecha_registro: string | null;
  fecha_registro_raw: string;
  // Store all raw columns for display
  all_columns: Record<string, string>;
  matched_process_id: string | null; // Will be filled after matching
}

export interface EstadosParseResult {
  file_name: string;
  file_hash: string;
  rows: EstadosExcelRow[];
  header_row_index: number;
  total_rows: number;
  headers: string[]; // Original headers for display
  errors: string[];
}

// Spanish month abbreviations to numeric month
const SPANISH_MONTHS: Record<string, string> = {
  ene: "01",
  feb: "02",
  mar: "03",
  abr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  ago: "08",
  sep: "09",
  oct: "10",
  nov: "11",
  dic: "12",
};

// Column header mappings (case-insensitive, accent-tolerant)
const HEADER_MAPPINGS: Record<string, string[]> = {
  radicado: ["numero del proceso", "numero proceso", "radicado", "nro proceso", "número del proceso", "número proceso"],
  despacho: ["despacho", "juzgado"],
  distrito: ["distrito", "ciudad"],
  juez_ponente: ["juez", "ponente", "juez / ponente", "juez/ponente"],
  demandantes: ["demandante", "demandantes", "actor", "actores"],
  demandados: ["demandado", "demandados"],
  last_action_date: ["fecha de la ultima actuacion", "fecha última actuación", "ultima actuacion", "última actuación", "fecha actuacion"],
  actuacion: ["actuacion", "actuación", "ultima actuacion", "última actuación"],
  anotacion: ["anotacion", "anotación"],
  inicia_termino: ["inicia termino", "inicia término", "termino", "término"],
  fecha_inicia_termino: ["fecha inicia termino", "fecha inicia término", "fecha termino", "fecha término"],
  fecha_registro: ["fecha registro", "fecha de registro"],
};

function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Remove accents
    .replace(/\s+/g, " ")
    .trim();
}

function findColumnIndex(headers: string[], targetNames: string[]): number {
  for (let i = 0; i < headers.length; i++) {
    const normalized = normalizeHeader(headers[i] || "");
    for (const target of targetNames) {
      if (normalized.includes(target)) {
        return i;
      }
    }
  }
  return -1;
}

function normalizeRadicado(raw: string): string {
  // Extract only digits
  return raw.replace(/\D/g, "");
}

function normalizeText(text: string): string {
  if (!text) return "";
  return text
    .replace(/\s+/g, " ")
    .replace(/\r?\n/g, " ")
    .trim();
}

function parseSpanishDate(dateStr: string): string | null {
  if (!dateStr) return null;
  
  const normalized = dateStr.toLowerCase().trim();
  
  // Try format: "19-dic-25" or "19/dic/25"
  const match = normalized.match(/(\d{1,2})[-/]([a-z]{3})[-/](\d{2,4})/);
  if (match) {
    const day = match[1].padStart(2, "0");
    const monthAbbr = match[2];
    let year = match[3];
    
    const month = SPANISH_MONTHS[monthAbbr];
    if (!month) return null;
    
    // Handle 2-digit years
    if (year.length === 2) {
      const yearNum = parseInt(year, 10);
      year = yearNum > 50 ? `19${year}` : `20${year}`;
    }
    
    return `${year}-${month}-${day}`;
  }
  
  // Try format: "2025-12-19" (already ISO)
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return normalized;
  }
  
  // Try format: "19/12/2025" or "19-12-2025"
  const numericMatch = normalized.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (numericMatch) {
    const day = numericMatch[1].padStart(2, "0");
    const month = numericMatch[2].padStart(2, "0");
    const year = numericMatch[3];
    return `${year}-${month}-${day}`;
  }
  
  return null;
}

async function computeFileHash(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

function isHeaderRow(row: unknown[], headerNames: string[]): boolean {
  const rowText = row.map(cell => normalizeHeader(String(cell || ""))).join(" ");
  return headerNames.some(name => rowText.includes(name));
}

export async function parseEstadosExcel(file: File): Promise<EstadosParseResult> {
  const errors: string[] = [];
  
  // Read file
  const data = await file.arrayBuffer();
  const workbook = XLSX.read(data, { type: "array" });
  
  // Get first worksheet
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error("El archivo Excel no contiene hojas de cálculo");
  }
  
  const sheet = workbook.Sheets[sheetName];
  const rawData: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  
  if (rawData.length === 0) {
    throw new Error("La hoja de cálculo está vacía");
  }
  
  // Find header row by looking for "Número del proceso"
  let headerRowIndex = -1;
  const targetHeaders = HEADER_MAPPINGS.radicado;
  
  for (let i = 0; i < Math.min(rawData.length, 20); i++) {
    if (isHeaderRow(rawData[i], targetHeaders)) {
      headerRowIndex = i;
      break;
    }
  }
  
  if (headerRowIndex === -1) {
    throw new Error(
      'No se encontró la fila de encabezados. Busca una fila que contenga "Número del proceso".'
    );
  }
  
  const headers = rawData[headerRowIndex].map(h => String(h || ""));
  
  // Map columns
  const columnIndices = {
    radicado: findColumnIndex(headers, HEADER_MAPPINGS.radicado),
    despacho: findColumnIndex(headers, HEADER_MAPPINGS.despacho),
    distrito: findColumnIndex(headers, HEADER_MAPPINGS.distrito),
    juez_ponente: findColumnIndex(headers, HEADER_MAPPINGS.juez_ponente),
    demandantes: findColumnIndex(headers, HEADER_MAPPINGS.demandantes),
    demandados: findColumnIndex(headers, HEADER_MAPPINGS.demandados),
    last_action_date: findColumnIndex(headers, HEADER_MAPPINGS.last_action_date),
    actuacion: findColumnIndex(headers, HEADER_MAPPINGS.actuacion),
    anotacion: findColumnIndex(headers, HEADER_MAPPINGS.anotacion),
    inicia_termino: findColumnIndex(headers, HEADER_MAPPINGS.inicia_termino),
    fecha_inicia_termino: findColumnIndex(headers, HEADER_MAPPINGS.fecha_inicia_termino),
    fecha_registro: findColumnIndex(headers, HEADER_MAPPINGS.fecha_registro),
  };
  
  if (columnIndices.radicado === -1) {
    throw new Error('No se encontró la columna "Número del proceso" en los encabezados');
  }
  
  // Compute file hash
  const fileHash = await computeFileHash(file);
  
  // Parse data rows
  const rows: EstadosExcelRow[] = [];
  
  for (let i = headerRowIndex + 1; i < rawData.length; i++) {
    const row = rawData[i];
    if (!row || row.length === 0) continue;
    
    const radicadoRaw = String(row[columnIndices.radicado] || "").trim();
    if (!radicadoRaw) continue; // Skip empty rows
    
    const radicadoNorm = normalizeRadicado(radicadoRaw);
    const lastActionRaw = String(row[columnIndices.last_action_date] || "").trim();
    const lastActionIso = parseSpanishDate(lastActionRaw);
    
    const fechaIniciaTerminoRaw = columnIndices.fecha_inicia_termino >= 0 
      ? String(row[columnIndices.fecha_inicia_termino] || "").trim() 
      : "";
    const fechaRegistroRaw = columnIndices.fecha_registro >= 0 
      ? String(row[columnIndices.fecha_registro] || "").trim() 
      : "";
    
    // Build all_columns object with all header:value pairs
    const allColumns: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      const headerName = headers[j]?.trim();
      if (headerName) {
        allColumns[headerName] = normalizeText(String(row[j] || ""));
      }
    }
    
    const parsedRow: EstadosExcelRow = {
      radicado_raw: radicadoRaw,
      radicado_norm: radicadoNorm,
      distrito: normalizeText(String(row[columnIndices.distrito] || "")),
      despacho: normalizeText(String(row[columnIndices.despacho] || "")),
      juez_ponente: normalizeText(String(row[columnIndices.juez_ponente] || "")),
      demandantes: normalizeText(String(row[columnIndices.demandantes] || "")),
      demandados: normalizeText(String(row[columnIndices.demandados] || "")),
      fecha_ultima_actuacion_raw: lastActionRaw,
      fecha_ultima_actuacion: lastActionIso,
      actuacion: columnIndices.actuacion >= 0 
        ? normalizeText(String(row[columnIndices.actuacion] || "")) 
        : "",
      anotacion: columnIndices.anotacion >= 0 
        ? normalizeText(String(row[columnIndices.anotacion] || "")) 
        : "",
      inicia_termino: columnIndices.inicia_termino >= 0 
        ? normalizeText(String(row[columnIndices.inicia_termino] || "")) 
        : "",
      fecha_inicia_termino_raw: fechaIniciaTerminoRaw,
      fecha_inicia_termino: parseSpanishDate(fechaIniciaTerminoRaw),
      fecha_registro_raw: fechaRegistroRaw,
      fecha_registro: parseSpanishDate(fechaRegistroRaw),
      all_columns: allColumns,
      matched_process_id: null,
    };
    
    rows.push(parsedRow);
  }
  
  return {
    file_name: file.name,
    file_hash: fileHash,
    rows,
    header_row_index: headerRowIndex,
    total_rows: rows.length,
    headers,
    errors,
  };
}
