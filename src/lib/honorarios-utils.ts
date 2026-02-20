/**
 * Honorarios utilities — Colombian legal fee structures
 * Supports: Fijos, Cuota Litis, Mixtos, Mensualidad, Personalizado
 */

import { supabase } from "@/integrations/supabase/client";

// ─── Types ───────────────────────────────────────────────

export type HonorariosType = 'fijos' | 'cuota_litis' | 'mixtos' | 'mensualidad' | 'personalizado';

export interface Installment {
  percentage: number;
  amount: number;
  milestone: string;
}

export interface FixedComponent {
  amount: number;
  amount_smlmv: number | null;
  amount_words: string;
  currency: string;
  installments: Installment[];
}

export interface CuotaLitis {
  percentage: number;
  basis: string;
  payment_trigger: string;
}

export interface MonthlyFee {
  amount: number;
  amount_smlmv: number | null;
  payment_day: number;
  duration: string; // 'indefinida' | 'plazo_fijo' | custom text
  duration_months: number | null;
}

export interface HonorariosData {
  honorarios_type: HonorariosType;
  fixed_component: FixedComponent | null;
  cuota_litis: CuotaLitis | null;
  monthly_fee: MonthlyFee | null;
  custom_text_html: string | null;
}

// ─── SMLMV ───────────────────────────────────────────────

const SMLMV_FALLBACK = 1423500; // 2026 value

export async function getCurrentSMLMV(): Promise<number> {
  const year = new Date().getFullYear();
  try {
    const { data } = await supabase
      .from("system_config")
      .select("value")
      .eq("key", `smlmv_${year}`)
      .single();
    return (data?.value as any)?.value || SMLMV_FALLBACK;
  } catch {
    return SMLMV_FALLBACK;
  }
}

// ─── Number to Spanish Words ─────────────────────────────

const UNITS = ['', 'un', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve'];
const TEENS = ['diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve'];
const TENS = ['', 'diez', 'veinte', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
const HUNDREDS = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos'];

function convertHundreds(n: number): string {
  if (n === 0) return '';
  if (n === 100) return 'cien';

  const h = Math.floor(n / 100);
  const remainder = n % 100;

  let result = HUNDREDS[h];

  if (remainder === 0) return result;
  if (result) result += ' ';

  if (remainder < 10) {
    result += UNITS[remainder];
  } else if (remainder < 20) {
    result += TEENS[remainder - 10];
  } else {
    const t = Math.floor(remainder / 10);
    const u = remainder % 10;
    if (t === 2 && u > 0) {
      result += `veinti${UNITS[u]}`;
    } else {
      result += TENS[t];
      if (u > 0) result += ` y ${UNITS[u]}`;
    }
  }

  return result;
}

export function numberToSpanishWords(amount: number): string {
  if (amount === 0) return 'cero pesos';
  if (amount < 0) return `menos ${numberToSpanishWords(-amount)}`;

  const whole = Math.floor(amount);
  const parts: string[] = [];

  // Billions (millardos - rare but possible)
  const billions = Math.floor(whole / 1000000000);
  if (billions > 0) {
    if (billions === 1) {
      parts.push('mil millones');
    } else {
      parts.push(`${convertHundreds(billions)} mil millones`);
    }
  }

  // Millions
  const millions = Math.floor((whole % 1000000000) / 1000000);
  if (millions > 0) {
    if (millions === 1) {
      parts.push('un millón');
    } else {
      parts.push(`${convertHundreds(millions)} millones`);
    }
  }

  // Thousands
  const thousands = Math.floor((whole % 1000000) / 1000);
  if (thousands > 0) {
    if (thousands === 1) {
      parts.push('mil');
    } else {
      parts.push(`${convertHundreds(thousands)} mil`);
    }
  }

  // Hundreds
  const hundreds = whole % 1000;
  if (hundreds > 0) {
    parts.push(convertHundreds(hundreds));
  }

  const text = parts.join(' ').replace(/\s+/g, ' ').trim();

  // Capitalize first letter
  return text.charAt(0).toUpperCase() + text.slice(1) + ' pesos';
}

export function formatCOP(amount: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'decimal',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

// ─── Default Installment Presets ─────────────────────────

export interface InstallmentPreset {
  label: string;
  installments: { percentage: number; milestone: string }[];
}

export const INSTALLMENT_PRESETS: InstallmentPreset[] = [
  {
    label: '100% al firmar el contrato',
    installments: [{ percentage: 100, milestone: 'Al firmar el contrato' }],
  },
  {
    label: '50% al firmar / 50% al radicar',
    installments: [
      { percentage: 50, milestone: 'Al firmar el contrato' },
      { percentage: 50, milestone: 'Al presentar la demanda' },
    ],
  },
  {
    label: '33% firmar / 33% radicar / 34% auto admisorio',
    installments: [
      { percentage: 33, milestone: 'Al firmar el contrato' },
      { percentage: 33, milestone: 'Al presentar la demanda' },
      { percentage: 34, milestone: 'Al auto admisorio de la demanda' },
    ],
  },
];

export const MILESTONE_OPTIONS = [
  'Al firmar el contrato',
  'Al presentar la demanda',
  'Al auto admisorio de la demanda',
  'Al dictar sentencia de primera instancia',
  'Al dictar sentencia de segunda instancia',
  'Al resultado favorable',
];

export const CUOTA_LITIS_BASES = [
  { label: 'Del valor total recuperado a favor del cliente', value: 'Del valor total recuperado a favor del cliente' },
  { label: 'Del valor de los bienes o activos preservados', value: 'Del valor de los bienes o activos preservados' },
  { label: 'Del valor de la condena favorable en sentencia', value: 'Del valor de la condena favorable en sentencia' },
];

export const CUOTA_LITIS_TRIGGERS = [
  'Al obtener resultado favorable en cualquier instancia',
  'Al obtener sentencia ejecutoriada',
  'Al recaudo efectivo de los valores',
];

// ─── Service Object Templates ────────────────────────────

export interface ServiceObjectTemplate {
  label: string;
  text: string;
}

export const SERVICE_OBJECT_TEMPLATES: ServiceObjectTemplate[] = [
  {
    label: 'Representación judicial integral',
    text: 'Representación judicial integral del MANDANTE en el proceso [ordinario/ejecutivo/verbal] que se adelantará o se adelanta ante [la jurisdicción civil del circuito de Medellín], incluyendo todas las actuaciones procesales, recursos ordinarios y extraordinarios, incidentes, audiencias, y demás diligencias que sean necesarias para la defensa de los intereses del MANDANTE.',
  },
  {
    label: 'Cobro ejecutivo de obligaciones',
    text: 'Representación judicial del MANDANTE en proceso ejecutivo singular para el cobro de obligaciones derivadas de [título valor/contrato/sentencia], incluyendo la presentación de la demanda, medidas cautelares, y todas las actuaciones procesales hasta el recaudo efectivo de las sumas adeudadas.',
  },
  {
    label: 'Defensa en proceso ordinario',
    text: 'Defensa judicial integral del MANDANTE como parte demandada en el proceso [ordinario/verbal] que se adelanta en su contra, incluyendo la contestación de la demanda, proposición de excepciones, asistencia a audiencias, y todas las actuaciones procesales necesarias.',
  },
  {
    label: 'Acción de tutela',
    text: 'Presentación y seguimiento de acción de tutela en nombre del MANDANTE para la protección de sus derechos fundamentales [especificar derechos], incluyendo la redacción del escrito de tutela, seguimiento del fallo, e impugnación si fuere necesario.',
  },
  {
    label: 'Proceso de responsabilidad civil',
    text: 'Representación judicial del MANDANTE en proceso de responsabilidad civil [contractual/extracontractual] para la reclamación de perjuicios materiales e inmateriales causados por [describir hechos], incluyendo todas las instancias procesales.',
  },
  {
    label: 'Asesoría y representación laboral',
    text: 'Representación judicial del MANDANTE ante la jurisdicción laboral en proceso [ordinario laboral/ejecutivo laboral] relacionado con [describir pretensiones], incluyendo todas las actuaciones procesales, conciliación, audiencias y recursos.',
  },
];

// ─── Clause Generation ──────────────────────────────────

export function generateHonorariosClause(data: HonorariosData): string {
  switch (data.honorarios_type) {
    case 'fijos':
      return generateFixedClause(data.fixed_component!);
    case 'cuota_litis':
      return generateCuotaLitisClause(data.cuota_litis!);
    case 'mixtos':
      return generateMixedClause(data.fixed_component!, data.cuota_litis!);
    case 'mensualidad':
      return generateMonthlyClause(data.monthly_fee!, data.cuota_litis);
    case 'personalizado':
      return data.custom_text_html || '';
  }
}

function generateFixedClause(fixed: FixedComponent): string {
  const amountText = fixed.amount_words.toUpperCase();
  const amountNum = formatCOP(fixed.amount);
  const smlmvText = fixed.amount_smlmv
    ? `, equivalentes a ${numberToWords(fixed.amount_smlmv)} (${fixed.amount_smlmv}) salarios mínimos legales mensuales vigentes`
    : '';

  let clause = `EL MANDANTE se obliga a pagar a EL MANDATARIO, por concepto de honorarios profesionales, la suma de <strong>${amountText} ($${amountNum}) M/CTE</strong>${smlmvText}, pagaderos de la siguiente forma:`;

  if (fixed.installments.length > 0) {
    const letters = 'abcdefghijklmnopqrstuvwxyz';
    const items = fixed.installments.map((inst, i) => {
      const instAmountWords = numberToSpanishWords(inst.amount).replace(' pesos', '').toUpperCase();
      const instAmountNum = formatCOP(inst.amount);
      return `<br/><br/>${letters[i]}) La suma de <strong>${instAmountWords} PESOS ($${instAmountNum}) M/CTE</strong>, equivalente al ${inst.percentage}% del valor total, ${inst.milestone.toLowerCase()};`;
    });
    clause += items.join('');
  }

  clause += `<br/><br/><strong>PARÁGRAFO:</strong> El no pago oportuno de cualquiera de las cuotas aquí pactadas faculta a EL MANDATARIO para suspender la prestación del servicio profesional, previo aviso escrito con cinco (5) días hábiles de anticipación.`;

  return clause;
}

function generateCuotaLitisClause(cuota: CuotaLitis): string {
  const pctWords = numberToWords(cuota.percentage);
  return `EL MANDANTE y EL MANDATARIO acuerdan pactar los honorarios profesionales bajo la modalidad de cuota litis, en los siguientes términos:<br/><br/>EL MANDANTE reconocerá a EL MANDATARIO el <strong>${pctWords} por ciento (${cuota.percentage}%)</strong> ${cuota.basis.toLowerCase()}, pagadero ${cuota.payment_trigger.toLowerCase()}.<br/><br/><strong>PARÁGRAFO:</strong> En caso de que el resultado del proceso no sea favorable para EL MANDANTE, no se causarán honorarios a favor de EL MANDATARIO por concepto de cuota litis. EL MANDANTE únicamente asumirá los gastos procesales en que se haya incurrido.`;
}

function generateMixedClause(fixed: FixedComponent, cuota: CuotaLitis): string {
  const pctWords = numberToWords(cuota.percentage);
  const amountText = fixed.amount_words.toUpperCase();
  const amountNum = formatCOP(fixed.amount);
  const smlmvText = fixed.amount_smlmv
    ? `, equivalentes a ${numberToWords(fixed.amount_smlmv)} (${fixed.amount_smlmv}) salarios mínimos legales mensuales vigentes`
    : '';

  let clause = `Los honorarios profesionales se componen de dos conceptos:<br/><br/><strong>1. COMPONENTE FIJO:</strong> EL MANDANTE se obliga a pagar la suma de <strong>${amountText} ($${amountNum}) M/CTE</strong>${smlmvText}, pagaderos así:`;

  if (fixed.installments.length > 0) {
    const letters = 'abcdefghijklmnopqrstuvwxyz';
    fixed.installments.forEach((inst, i) => {
      const instAmountNum = formatCOP(inst.amount);
      clause += `<br/>${letters[i]}) ${inst.percentage}% ($${instAmountNum}) — ${inst.milestone};`;
    });
  }

  clause += `<br/><br/><strong>2. CUOTA LITIS:</strong> Adicionalmente, EL MANDANTE reconocerá a EL MANDATARIO el <strong>${pctWords} por ciento (${cuota.percentage}%)</strong> ${cuota.basis.toLowerCase()}, pagadero ${cuota.payment_trigger.toLowerCase()}.`;

  clause += `<br/><br/><strong>PARÁGRAFO PRIMERO:</strong> La cuota litis solo se causará en caso de resultado favorable para EL MANDANTE.`;
  clause += `<br/><br/><strong>PARÁGRAFO SEGUNDO:</strong> El no pago oportuno del componente fijo faculta a EL MANDATARIO para suspender la prestación del servicio, previo aviso escrito con cinco (5) días hábiles de anticipación.`;

  return clause;
}

function generateMonthlyClause(monthly: MonthlyFee, cuota: CuotaLitis | null): string {
  const amountWords = numberToSpanishWords(monthly.amount).replace(' pesos', '').toUpperCase();
  const amountNum = formatCOP(monthly.amount);
  const smlmvText = monthly.amount_smlmv
    ? `, equivalentes a ${numberToWords(monthly.amount_smlmv)} (${monthly.amount_smlmv}) salarios mínimos legales mensuales vigentes`
    : '';

  let durationText = '';
  if (monthly.duration === 'indefinida') {
    durationText = 'hasta la terminación del proceso o la revocatoria del mandato';
  } else if (monthly.duration === 'plazo_fijo' && monthly.duration_months) {
    durationText = `por un período de ${monthly.duration_months} meses`;
  } else {
    durationText = monthly.duration;
  }

  let clause = `EL MANDANTE se obliga a pagar a EL MANDATARIO, por concepto de honorarios profesionales, una mensualidad de <strong>${amountWords} PESOS ($${amountNum}) M/CTE</strong>${smlmvText}, pagadera el día <strong>${monthly.payment_day}</strong> de cada mes, ${durationText}.`;

  if (cuota) {
    const pctWords = numberToWords(cuota.percentage);
    clause += `<br/><br/>Adicionalmente, EL MANDANTE reconocerá a EL MANDATARIO una cuota litis del <strong>${pctWords} por ciento (${cuota.percentage}%)</strong> ${cuota.basis.toLowerCase()}, pagadero ${cuota.payment_trigger.toLowerCase()}.`;
  }

  clause += `<br/><br/><strong>PARÁGRAFO:</strong> El no pago oportuno de dos (2) o más mensualidades consecutivas faculta a EL MANDATARIO para dar por terminado el contrato de mandato.`;

  return clause;
}

// Small numbers to words for percentages
function numberToWords(n: number): string {
  if (n <= 0) return 'cero';
  if (n < 10) return UNITS[n] || String(n);
  if (n < 20) return TEENS[n - 10];
  if (n < 100) {
    const t = Math.floor(n / 10);
    const u = n % 10;
    if (t === 2 && u > 0) return `veinti${UNITS[u]}`;
    return u > 0 ? `${TENS[t]} y ${UNITS[u]}` : TENS[t];
  }
  return convertHundreds(n);
}

// ─── Payment Schedule Text for Template ──────────────────

export function generatePaymentScheduleText(data: HonorariosData): string {
  if (data.honorarios_type === 'personalizado') return data.custom_text_html || '';
  if (data.honorarios_type === 'cuota_litis') {
    return `Los honorarios bajo modalidad de cuota litis se pagarán ${data.cuota_litis?.payment_trigger?.toLowerCase() || 'al resultado favorable'}.`;
  }
  if (data.honorarios_type === 'mensualidad') {
    return `El pago se realizará mensualmente el día ${data.monthly_fee?.payment_day || 5} de cada mes.`;
  }

  const fixed = data.fixed_component;
  if (!fixed?.installments?.length) return 'Pago en una sola cuota al firmar el contrato.';

  const items = fixed.installments.map((inst, i) => {
    return `${i + 1}. ${inst.percentage}% ($${formatCOP(inst.amount)}) — ${inst.milestone}`;
  });

  return `El valor total de los honorarios se pagará de la siguiente manera:<br/>${items.join('<br/>')}`;
}

// ─── Default Honorarios Data ─────────────────────────────

export function createDefaultHonorariosData(): HonorariosData {
  return {
    honorarios_type: 'fijos',
    fixed_component: {
      amount: 0,
      amount_smlmv: null,
      amount_words: '',
      currency: 'COP',
      installments: [
        { percentage: 50, amount: 0, milestone: 'Al firmar el contrato' },
        { percentage: 50, amount: 0, milestone: 'Al presentar la demanda' },
      ],
    },
    cuota_litis: null,
    monthly_fee: null,
    custom_text_html: null,
  };
}
