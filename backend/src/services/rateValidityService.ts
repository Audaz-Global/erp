export type RateValiditySource = 'AGENT_EMAIL' | 'TARIFF' | 'CONTINGENCY' | 'MANUAL';

const MAX_CONTINGENCY_DAYS = 15;

function asIsoDate(value: unknown): string | null {
  const raw = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(raw)) return null;
  const date = new Date(`${raw.slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : raw.slice(0, 10);
}

function sourceFrom(value: unknown): RateValiditySource {
  const source = String(value || '').trim().toUpperCase();
  if (source === 'TARIFF' || source === 'AGENT_EMAIL') return source;
  return 'AGENT_EMAIL';
}

function evidenceFrom(costs: any): string | null {
  if (costs?.rate_validity_evidence) return String(costs.rate_validity_evidence).slice(0, 1000);
  const found = Array.isArray(costs?.field_evidence)
    ? costs.field_evidence.find((item: any) => String(item?.field || '').toLowerCase() === 'rate_valid_until')
    : null;
  return found?.evidence ? String(found.evidence).slice(0, 1000) : null;
}

/**
 * Normaliza a validade extraída e cria uma contingência segura somente quando
 * nenhuma data foi encontrada. A contingência nunca ultrapassa 15 dias.
 */
export function applyRateValidityPolicy(costs: any, referenceDate: Date = new Date()) {
  if (!costs) return costs;
  const explicitDate = asIsoDate(costs.rate_valid_until);
  if (explicitDate) {
    const today = new Date(referenceDate);
    today.setHours(0, 0, 0, 0);
    const parsed = new Date(`${explicitDate}T12:00:00`);
    const confidence = Number(costs.rate_validity_confidence ?? costs.confidence ?? 0);
    costs.rate_valid_until = explicitDate;
    costs.rate_validity_source = sourceFrom(costs.rate_validity_source);
    costs.rate_validity_evidence = evidenceFrom(costs);
    costs.rate_validity_confidence = Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0;
    costs.rate_validity_needs_review = parsed < today || costs.rate_validity_confidence < 0.6;
    costs.rate_validity_is_contingency = false;
    return costs;
  }

  const fallback = new Date(referenceDate);
  fallback.setHours(12, 0, 0, 0);
  fallback.setDate(fallback.getDate() + MAX_CONTINGENCY_DAYS);
  costs.rate_valid_until = fallback.toISOString().slice(0, 10);
  costs.rate_validity_source = 'CONTINGENCY';
  costs.rate_validity_evidence = `Contingência automática: nenhuma validade explícita foi identificada no retorno ou tarifário. Limite aplicado: ${MAX_CONTINGENCY_DAYS} dias.`;
  costs.rate_validity_confidence = 0;
  costs.rate_validity_needs_review = true;
  costs.rate_validity_is_contingency = true;
  return costs;
}

export function rateValidityFields(costs: any) {
  const date = asIsoDate(costs?.rate_valid_until);
  if (!date) return {};
  return {
    rateValidUntil: new Date(`${date}T12:00:00Z`),
    rateValiditySource: String(costs.rate_validity_source || 'CONTINGENCY'),
    rateValidityEvidence: costs.rate_validity_evidence ? String(costs.rate_validity_evidence).slice(0, 1000) : null,
    rateValidityConfidence: Number.isFinite(Number(costs.rate_validity_confidence)) ? Number(costs.rate_validity_confidence) : null,
    rateValidityNeedsReview: Boolean(costs.rate_validity_needs_review)
  };
}

export const RATE_VALIDITY_MAX_CONTINGENCY_DAYS = MAX_CONTINGENCY_DAYS;
