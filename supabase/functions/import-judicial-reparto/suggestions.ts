export const PDF_LIMIT = 10 * 1024 * 1024;

type Source = "PDF" | "OUTLOOK";
type Field = "kind" | "radicado" | "external_reference" | "authority_name" |
  "demandantes" | "demandados" | "receipt_on" | "assigned_on";

interface Suggestion {
  value: string;
  source: Source;
}

export interface RepartoSuggestions {
  fields: Partial<Record<Field, Suggestion>>;
  conflicts: Field[];
  pdf_text_read: boolean;
}

const fields: Field[] = [
  "kind", "radicado", "external_reference", "authority_name",
  "demandantes", "demandados", "receipt_on", "assigned_on",
];
const fieldBoundary = /\s+(?=(?:radicado|n[uú]mero|fecha|despacho|juzgado asignado|demandantes?|demandados?|accionantes?|accionados?|anexos?|referencia)\s*(?:de\b|:\s))/i;
const radicadoLabel = /(?:\b(?:n[uú]mero|c[oó]digo)\s+(?:[uú]nico\s+)?(?:nacional\s+)?(?:de\s+)?radicaci[oó]n|\bradicado(?:\s+judicial)?|\bNUR)\s*(?:n[º°o.]|#)?\s*:?\s*/gi;
const radicadoValue = /^(?:\d{23}|\d{5}[ -]+\d{2}[ -]+\d{2}[ -]+\d{3}[ -]+\d{4}[ -]+\d{5}[ -]+\d{2})(?![0-9]|[ -]+\d)/;

function captured(text: string, label: RegExp, limit: number): string[] {
  return [...text.matchAll(label)].map((match) => {
    const readable = match[1].split(fieldBoundary)[0].replace(/\s+/g, " ").trim();
    return readable && readable.length <= limit ? readable : "";
  }).filter(Boolean);
}

function calendarDate(raw: string): string | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  const local = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(raw);
  const parts = iso ? [iso[1], iso[2], iso[3]] : local ? [local[3], local[2], local[1]] : null;
  if (!parts || Number(parts[0]) < 1990) return null;
  const [year, month, day] = parts;
  const date = year + "-" + month.padStart(2, "0") + "-" + day.padStart(2, "0");
  const check = new Date(date + "T00:00:00Z");
  return Number.isFinite(check.getTime()) && check.toISOString().slice(0, 10) === date ? date : null;
}

function readFields(text: string, subject = ""): Partial<Record<Field, string[]>> {
  const header = subject + "\n" + text.slice(0, 700);
  const kinds: string[] = [];
  if (/\b(?:acta\s+(?:(?:individual|electr[oó]nica)\s+)?de\s+reparto|resultado\s+del\s+reparto|asignaci[oó]n\s+por\s+reparto)\b/i.test(header)) {
    kinds.push("REPARTO");
  }
  if (/\b(?:acuse|constancia|confirmaci[oó]n|acta)\s+de\s+(?:recibo|recepci[oó]n|radicaci[oó]n)\b/i.test(header)) {
    kinds.push("RECEPCION");
  }
  const numbers = [...text.matchAll(radicadoLabel)].flatMap((match) => {
    const digits = radicadoValue.exec(text.slice(match.index! + match[0].length))?.[0].replace(/\D/g, "");
    return digits && !/^0{23}$/.test(digits) ? [digits] : [];
  });
  const dates = (labels: RegExp) =>
    [...text.matchAll(labels)].flatMap((match) => calendarDate(match[1]) ?? []);
  return {
    kind: kinds,
    radicado: numbers,
    external_reference: captured(text, /(?:n[uú]mero|referencia|id|c[oó]digo)\s+(?:de\s+)?(?:la\s+)?solicitud\s*[:#]\s*([a-z0-9][a-z0-9/-]{0,119})(?![\w/-])/gi, 120),
    authority_name: captured(text, /(?:despacho|juzgado)\s+(?:asignado|repartido)\s*:\s*([^\r\n]{1,260})/gi, 240),
    demandantes: captured(text, /(?:\bdemandantes?|\baccionantes?)\s*:\s*([^\r\n]{1,510})/gi, 500),
    demandados: captured(text, /(?:\bdemandados?|\baccionados?)\s*:\s*([^\r\n]{1,510})/gi, 500),
    receipt_on: dates(/\bfecha\s+(?:de\s+)?(?:recepci[oó]n|recibo|presentaci[oó]n|radicaci[oó]n)\s*:\s*(\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}[/-]\d{4})(?!\d)/gi),
    assigned_on: dates(/\bfecha\s+(?:de\s+)?(?:reparto|asignaci[oó]n)\s*:\s*(\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}[/-]\d{4})(?!\d)/gi),
  };
}

export function extractRepartoSuggestions(pdfText: string, mailText: string, subject: string): RepartoSuggestions {
  const pdf = readFields(pdfText);
  const mail = readFields(mailText, subject);
  const result: RepartoSuggestions = { fields: {}, conflicts: [], pdf_text_read: Boolean(pdfText.trim()) };
  for (const field of fields) {
    const values = new Map<string, Suggestion>();
    for (const [source, sourceFields] of [["OUTLOOK", mail], ["PDF", pdf]] as const) {
      for (const value of sourceFields[field] ?? []) {
        values.set(value.toLocaleLowerCase("es-CO"), { value, source });
      }
    }
    if (values.size > 1) result.conflicts.push(field);
    if (values.size === 1) result.fields[field] = [...values.values()][0];
  }
  return result;
}

export function hasPdfEnvelope(bytes: Uint8Array): boolean {
  if (!bytes.length || bytes.length > PDF_LIMIT) return false;
  const decoder = new TextDecoder();
  return decoder.decode(bytes.subarray(0, 8)).startsWith("%PDF-") &&
    decoder.decode(bytes.subarray(-2048)).trimEnd().endsWith("%%EOF");
}
