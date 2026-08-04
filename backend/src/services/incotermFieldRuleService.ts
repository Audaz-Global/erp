import { prisma } from '../prisma';

const FIELD_MAP: Record<string, string[]> = {
  INTERNATIONAL_FREIGHT: ['freightValue', 'freightCurrency', 'totalUsd'],
  ORIGIN_INLAND: ['needsOriginInland', 'originInlandRoute', 'originInlandValue', 'originInlandCurrency', 'originInlandTransitTime'],
  ORIGIN_FEES: ['originServices', 'originServicesTotal'],
  INSURANCE: ['requiresInsurance'],
  DESTINATION_FEES: ['destinationServices', 'destinationServicesTotal', 'destinationStorage', 'destinationTaxes'],
  NATIONAL_INLAND: ['needsTransport', 'truckerName', 'truckerEmail', 'transportRoute', 'truckerValue', 'truckerCurrency'],
  CUSTOMS_CLEARANCE: ['customsClearanceIncluded']
};

export class IncotermFieldRuleError extends Error {}

function modalOf(data: any) {
  const modal = String(data.modal || '').toUpperCase();
  const loadType = String(data.loadType || '').toUpperCase();
  if (modal === 'AIR' || loadType.includes('AIR')) return 'AIR';
  return loadType.includes('LCL') ? 'SEA_LCL' : 'SEA_FCL';
}
function hasValue(value: any) { return value !== undefined && value !== null && value !== '' && value !== false; }

export async function enforceIncotermFieldRules(input: any, stage: string, current?: any) {
  const incoterm = String(input.incoterm || current?.incoterm || '').toUpperCase();
  if (!incoterm || !stage) return input;
  const modal = modalOf({ ...(current || {}), ...input });
  const rules = await prisma.incotermFieldRule.findMany({ where: { incoterm, modal: { in: [modal, 'ALL'] }, stage: { in: [stage, 'ALL'] }, active: true } });
  rules.sort((a, b) => ((a.modal === 'ALL' ? 0 : 2) + (a.stage === 'ALL' ? 0 : 1)) - ((b.modal === 'ALL' ? 0 : 2) + (b.stage === 'ALL' ? 0 : 1)));
  const effective = new Map<string, typeof rules[number]>(); rules.forEach(rule => effective.set(rule.fieldKey, rule));
  const merged = { ...(current || {}), ...input };
  for (const rule of effective.values()) {
    const keys = FIELD_MAP[rule.fieldKey] || [];
    const requiredPresent = ['INSURANCE', 'CUSTOMS_CLEARANCE'].includes(rule.fieldKey)
      ? keys.some(key => merged[key] !== undefined && merged[key] !== null)
      : keys.some(key => hasValue(merged[key]));
    if (rule.behavior === 'REQUIRED' && !requiredPresent) throw new IncotermFieldRuleError(`${rule.fieldKey} é obrigatório para ${incoterm}${rule.reason ? ': ' + rule.reason : ''}`);
    if (rule.behavior === 'LOCKED' && current && keys.some(key => input[key] !== undefined && JSON.stringify(input[key]) !== JSON.stringify(current[key]))) throw new IncotermFieldRuleError(`${rule.fieldKey} está bloqueado para ${incoterm}${rule.reason ? ': ' + rule.reason : ''}`);
    if (rule.behavior === 'NOT_APPLICABLE') keys.forEach(key => { input[key] = key.startsWith('needs') || key.startsWith('requires') || key.endsWith('Included') ? false : null; });
    if (rule.behavior === 'RETURN_ONLY' && stage === 'REQUEST') keys.forEach(key => { if (key in input) delete input[key]; });
  }
  return input;
}
