export type StorageEstimateDecision = {
  requested: boolean;
  evidence: string;
  source: 'EXPLICIT_TEXT' | 'NOT_REQUESTED';
};

const STORAGE_REQUEST_PATTERNS = [
  /\b(?:estimativa|cota[cç][aã]o|valor|custo)s?\s+(?:de\s+)?armazenagem\b/i,
  /\barmazenagem\s+(?:estimada|no\s+destino|em\s+destino)\b/i,
  /\b(?:storage|warehousing)\s+(?:estimate|estimation|cost|rate|charges?)\b/i
];

export function findExplicitStorageEstimateRequest(sourceText: string): StorageEstimateDecision {
  const lines = String(sourceText || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const evidence = lines.find(line => STORAGE_REQUEST_PATTERNS.some(pattern => pattern.test(line))) || '';
  return evidence
    ? { requested: true, evidence: evidence.slice(0, 500), source: 'EXPLICIT_TEXT' }
    : { requested: false, evidence: '', source: 'NOT_REQUESTED' };
}

export function applyStorageEstimateRequestPolicy(extracted: any, sourceText: string) {
  if (!extracted?.cargo) return extracted;
  const decision = findExplicitStorageEstimateRequest(sourceText);
  extracted.cargo.requires_storage_estimate = decision.requested;
  extracted.cargo.storage_request_evidence = decision.evidence;
  extracted.cargo.storage_request_source = decision.source;
  return extracted;
}

export function ensureStorageEstimateRequest(draftText: string, requested: boolean): string {
  const text = String(draftText || '').trim();
  if (!requested || /\b(?:armazenagem|storage|warehousing)\b/i.test(text)) return text;
  return `${text}\n\nFavor informar também a estimativa de armazenagem no destino, indicando a base de cálculo, o período considerado e o free time aplicável.`;
}

export function storageEstimatePdfFee(input: { requested?: boolean; value?: number | string | null; source?: string | null }) {
  const value = Number(input.value || 0);
  if (!input.requested && value <= 0) return null;
  const fallback = input.source === 'MINIMUM_FALLBACK';
  const pending = value <= 0;
  const name = pending ? 'Estimativa de Armazenagem - A confirmar'
    : fallback ? 'Estimativa de Armazenagem - Piso mínimo LCL' : 'Estimativa de Armazenagem';
  return {
    name, qty: 1, unit: pending ? 'Pendente' : 'Fixo',
    valueUnit: pending ? 'A confirmar' : value.toFixed(2),
    currency: pending ? '' : 'BRL', total: pending ? 'A confirmar' : `BRL ${value.toFixed(2)}`,
    financialGroup: 'DESTINATION_CHARGE', chargeNature: 'LOCAL_SERVICE'
  };
}
