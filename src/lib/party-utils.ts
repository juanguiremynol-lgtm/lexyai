/**
 * Party utility functions for work item party management
 * Phase 3.9: Enhanced Party Management
 */

export type PartySide = 'demandante' | 'demandado' | 'tercero' | 'otro';
export type PartyType = 'natural' | 'juridica';

export interface WorkItemParty {
  id: string;
  work_item_id: string;
  owner_id: string;
  organization_id?: string | null;
  party_type: PartyType;
  party_side: PartySide;
  is_our_client: boolean;
  display_order: number;
  name: string;
  cedula?: string | null;
  cedula_city?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  company_name?: string | null;
  company_nit?: string | null;
  company_city?: string | null;
  rep_legal_name?: string | null;
  rep_legal_cedula?: string | null;
  rep_legal_cedula_city?: string | null;
  rep_legal_cargo?: string | null;
  rep_legal_email?: string | null;
  rep_legal_phone?: string | null;
  created_at: string;
  updated_at: string;
}

export interface PartyFormData {
  party_type: PartyType;
  party_side: PartySide;
  is_our_client: boolean;
  name: string;
  cedula?: string;
  cedula_city?: string;
  email?: string;
  phone?: string;
  address?: string;
  company_name?: string;
  company_nit?: string;
  company_city?: string;
  rep_legal_name?: string;
  rep_legal_cedula?: string;
  rep_legal_cedula_city?: string;
  rep_legal_cargo?: string;
  rep_legal_email?: string;
  rep_legal_phone?: string;
}

// ─── Side Labels by Workflow Type ────────────────────────

export function getSideLabels(workflowType: string): { sideA: string; sideB: string } {
  const labels: Record<string, { sideA: string; sideB: string }> = {
    CGP: { sideA: 'Parte Demandante', sideB: 'Parte Demandada' },
    CPACA: { sideA: 'Parte Demandante', sideB: 'Parte Demandada' },
    TUTELA: { sideA: 'Accionante', sideB: 'Accionado' },
    LABORAL: { sideA: 'Demandante', sideB: 'Demandado' },
    PENAL_906: { sideA: 'Víctima', sideB: 'Imputado / Acusado' },
  };
  return labels[workflowType] || labels.CGP;
}

export function getSideValue(label: string): PartySide {
  if (/accionante|víctima|demandante/i.test(label)) return 'demandante';
  if (/accionado|imputado|demandad/i.test(label)) return 'demandado';
  if (/tercero/i.test(label)) return 'tercero';
  return 'otro';
}

// ─── Completeness Calculation ────────────────────────────

export interface CompletenessResult {
  score: number;
  missing: { field: string; label: string; severity: 'warn' | 'info' }[];
  total: number;
}

export function calculatePartyCompleteness(party: WorkItemParty): CompletenessResult {
  const missing: CompletenessResult['missing'] = [];

  if (party.party_type === 'natural') {
    const total = party.is_our_client ? 5 : 2;
    if (!party.name?.trim()) missing.push({ field: 'name', label: 'Nombre completo', severity: 'warn' });
    if (!party.cedula?.trim()) missing.push({ field: 'cedula', label: 'Cédula', severity: 'warn' });
    if (party.is_our_client) {
      if (!party.email?.trim()) missing.push({ field: 'email', label: 'Email', severity: 'warn' });
      if (!party.cedula_city?.trim()) missing.push({ field: 'cedula_city', label: 'Ciudad de expedición cédula', severity: 'info' });
      if (!party.phone?.trim()) missing.push({ field: 'phone', label: 'Teléfono', severity: 'info' });
    }
    const filled = total - missing.length;
    return { score: Math.round((filled / total) * 100), missing, total };
  }

  // juridica
  const total = party.is_our_client ? 8 : 2;
  if (!party.company_name?.trim() && !party.name?.trim()) missing.push({ field: 'company_name', label: 'Razón social', severity: 'warn' });
  if (!party.company_nit?.trim()) missing.push({ field: 'company_nit', label: 'NIT', severity: 'warn' });
  if (party.is_our_client) {
    if (!party.company_city?.trim()) missing.push({ field: 'company_city', label: 'Domicilio principal', severity: 'info' });
    if (!party.rep_legal_name?.trim()) missing.push({ field: 'rep_legal_name', label: 'Nombre del representante legal', severity: 'warn' });
    if (!party.rep_legal_cedula?.trim()) missing.push({ field: 'rep_legal_cedula', label: 'Cédula del representante legal', severity: 'warn' });
    if (!party.rep_legal_cedula_city?.trim()) missing.push({ field: 'rep_legal_cedula_city', label: 'Ciudad exp. cédula rep. legal', severity: 'info' });
    if (!party.rep_legal_email?.trim()) missing.push({ field: 'rep_legal_email', label: 'Email del representante legal', severity: 'warn' });
    if (!party.rep_legal_cargo?.trim()) missing.push({ field: 'rep_legal_cargo', label: 'Cargo del representante legal', severity: 'info' });
  }
  const filled = total - missing.length;
  return { score: Math.round((filled / total) * 100), missing, total };
}

export function calculateOverallCompleteness(parties: WorkItemParty[]): {
  score: number;
  totalMissing: { partyName: string; field: string; label: string; severity: 'warn' | 'info' }[];
} {
  if (parties.length === 0) return { score: 100, totalMissing: [] };

  let totalScore = 0;
  const totalMissing: { partyName: string; field: string; label: string; severity: 'warn' | 'info' }[] = [];

  parties.forEach((p) => {
    const result = calculatePartyCompleteness(p);
    totalScore += result.score;
    result.missing.forEach((m) => {
      totalMissing.push({
        partyName: p.party_type === 'juridica' ? (p.company_name || p.name) : p.name,
        ...m,
      });
    });
  });

  return {
    score: Math.round(totalScore / parties.length),
    totalMissing,
  };
}

// ─── Display Name ────────────────────────────────────────

export function getPartyDisplayName(party: WorkItemParty): string {
  if (party.party_type === 'juridica') {
    return party.company_name || party.name;
  }
  return party.name;
}

// ─── Warning Text for Missing Fields ─────────────────────

export function getPartyWarnings(party: WorkItemParty): string[] {
  const warnings: string[] = [];
  const c = calculatePartyCompleteness(party);
  c.missing
    .filter((m) => m.severity === 'warn')
    .forEach((m) => {
      if (m.field === 'email') warnings.push('Sin email — no podrá recibir documentos para firma electrónica');
      else if (m.field === 'cedula') warnings.push('Sin cédula — requerido para poderes y contratos');
      else if (m.field === 'company_nit') warnings.push('Sin NIT — requerido para documentos legales');
      else if (m.field === 'rep_legal_name') warnings.push('Sin representante legal — requerido para firma de poderes y contratos');
      else if (m.field === 'rep_legal_email') warnings.push('Sin email del representante legal — no podrá firmar documentos electrónicamente');
      else if (m.field === 'rep_legal_cedula') warnings.push('Sin cédula del representante legal');
      else warnings.push(`Falta: ${m.label}`);
    });
  return warnings;
}
