export type DocumentType = "PAZ_Y_SALVO" | "RECIBO_DE_PAGO";

export interface DocumentVariable {
  key: string;
  label: string;
  required: boolean;
  source: "client" | "profile" | "manual" | "computed";
  defaultValue?: string;
  editable: boolean;
}

export const PAZ_Y_SALVO_TEMPLATE = `{{ciudad_emision}}, {{fecha_emision_larga}}

{{destinatario_trato}}
{{cliente_nombre_completo}}
C.C. {{cliente_numero_documento}}

Ref. PAZ Y SALVO

Cordial saludo.

El abogado {{firma_abogado_nombre_completo}}, certifica y deja constancia que el/la señor(a):

{{cliente_nombre_completo}}, identificado(a) con cédula de ciudadanía C.C. {{cliente_numero_documento}}, correo electrónico {{cliente_correo}}

Se encuentra a PAZ Y SALVO, por los siguientes conceptos contratados con el abogado:

{{servicios_bloque}}

Así las cosas, las obligaciones contraídas por el/la cliente hasta la fecha se encuentran plenamente solucionadas y no existen ni valores ni servicios pendientes adicionales.

En constancia,

{{firma_abogado_nombre_completo}}
C.C. {{firma_abogado_cc}}
T.P. {{firma_abogado_tp}}
Correo: {{firma_abogado_correo}}`;

export const RECIBO_DE_PAGO_TEMPLATE = `{{recibo_codigo}}

{{destinatario_trato}}
{{cliente_nombre_completo}}
CC. {{cliente_numero_documento}}

Asunto: RECIBO DE PAGO

Concepto: {{pago_concepto}}
Valor: {{pago_valor_letras_mayus}} PESOS (\${{pago_valor_numero_formateado}} COP)
Fecha: {{pago_fecha_corta}}
Valor Total Pagado: {{pago_total_letras_mayus}} PESOS (\${{pago_total_numero_formateado}} COP)

El abogado acepta haber recibido los valores enunciados a satisfacción de parte del cliente.

Atentamente,

{{firma_abogado_nombre_completo}}
C.C. {{firma_abogado_cc}}
T.P. {{firma_abogado_tp}}
Correo: {{firma_abogado_correo}}`;

export const DOCUMENT_TEMPLATES: Record<DocumentType, string> = {
  PAZ_Y_SALVO: PAZ_Y_SALVO_TEMPLATE,
  RECIBO_DE_PAGO: RECIBO_DE_PAGO_TEMPLATE,
};

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  PAZ_Y_SALVO: "Paz y Salvo",
  RECIBO_DE_PAGO: "Recibo de Pago",
};

// Variables definition per document type
export const PAZ_Y_SALVO_VARIABLES: DocumentVariable[] = [
  // Emission
  { key: "ciudad_emision", label: "Ciudad de emisión", required: true, source: "manual", defaultValue: "Medellín", editable: true },
  { key: "fecha_emision_larga", label: "Fecha de emisión", required: true, source: "computed", editable: false },
  // Client
  { key: "destinatario_trato", label: "Trato (Señor/Señora)", required: true, source: "manual", defaultValue: "Señor(a)", editable: true },
  { key: "cliente_nombre_completo", label: "Nombre completo cliente", required: true, source: "client", editable: false },
  { key: "cliente_numero_documento", label: "Número documento cliente", required: true, source: "client", editable: false },
  { key: "cliente_correo", label: "Correo cliente", required: false, source: "client", editable: true },
  // Services
  { key: "servicios_bloque", label: "Servicios/Conceptos", required: true, source: "manual", editable: true },
  // Lawyer (from profile, not editable)
  { key: "firma_abogado_nombre_completo", label: "Nombre abogado", required: true, source: "profile", editable: false },
  { key: "firma_abogado_cc", label: "CC abogado", required: true, source: "profile", editable: false },
  { key: "firma_abogado_tp", label: "T.P. abogado", required: true, source: "profile", editable: false },
  { key: "firma_abogado_correo", label: "Correo abogado", required: true, source: "profile", editable: false },
];

export const RECIBO_DE_PAGO_VARIABLES: DocumentVariable[] = [
  // Receipt
  { key: "recibo_codigo", label: "Código recibo", required: true, source: "computed", editable: true },
  // Client
  { key: "destinatario_trato", label: "Trato (Señor/Señora)", required: true, source: "manual", defaultValue: "Señor(a)", editable: true },
  { key: "cliente_nombre_completo", label: "Nombre completo cliente", required: true, source: "client", editable: false },
  { key: "cliente_numero_documento", label: "Número documento cliente", required: true, source: "client", editable: false },
  // Payment
  { key: "pago_concepto", label: "Concepto del pago", required: true, source: "manual", editable: true },
  { key: "pago_valor_numero_formateado", label: "Valor (número)", required: true, source: "manual", editable: true },
  { key: "pago_valor_letras_mayus", label: "Valor (letras mayúsculas)", required: true, source: "manual", editable: true },
  { key: "pago_fecha_corta", label: "Fecha de pago (DD/MM/YYYY)", required: true, source: "computed", editable: true },
  { key: "pago_total_numero_formateado", label: "Total (número)", required: true, source: "manual", editable: true },
  { key: "pago_total_letras_mayus", label: "Total (letras mayúsculas)", required: true, source: "manual", editable: true },
  // Lawyer (from profile, not editable)
  { key: "firma_abogado_nombre_completo", label: "Nombre abogado", required: true, source: "profile", editable: false },
  { key: "firma_abogado_cc", label: "CC abogado", required: true, source: "profile", editable: false },
  { key: "firma_abogado_tp", label: "T.P. abogado", required: true, source: "profile", editable: false },
  { key: "firma_abogado_correo", label: "Correo abogado", required: true, source: "profile", editable: false },
];

export const DOCUMENT_VARIABLES: Record<DocumentType, DocumentVariable[]> = {
  PAZ_Y_SALVO: PAZ_Y_SALVO_VARIABLES,
  RECIBO_DE_PAGO: RECIBO_DE_PAGO_VARIABLES,
};

// Utility functions
export function formatDateLong(date: Date): string {
  const months = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"
  ];
  const day = date.getDate();
  const month = months[date.getMonth()];
  const year = date.getFullYear();
  return `${day} de ${month} de ${year}`;
}

export function formatDateShort(date: Date): string {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("es-CO", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export function generateReceiptCode(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, "0");
  return `RP-${year}${month}-${random}`;
}

export function renderTemplate(template: string, variables: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    const regex = new RegExp(`{{${key}}}`, "g");
    result = result.replace(regex, value || "");
  }
  return result;
}

export function extractMissingVariables(template: string, variables: Record<string, string>): string[] {
  const placeholderRegex = /{{(\w+)}}/g;
  const missing: string[] = [];
  let match;
  
  while ((match = placeholderRegex.exec(template)) !== null) {
    const key = match[1];
    if (!variables[key] || variables[key].trim() === "") {
      if (!missing.includes(key)) {
        missing.push(key);
      }
    }
  }
  
  return missing;
}
