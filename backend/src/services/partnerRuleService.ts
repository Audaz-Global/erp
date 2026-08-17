import { prisma } from '../prisma';

const FIELD_MAP: Record<string, string[]> = {
  AGENT_EMAIL: ['agentEmail'], CARRIER: ['carrier'], TRANSSHIPMENTS: ['transshipments'],
  VESSEL_VOYAGE: ['vesselName', 'voyageNumber'], FREE_TIME: ['freeTimeDays'],
  RATE_VALIDITY: ['rateValidUntil'], CONTRACT_NUMBER: ['contractNumber'], FREIGHT_VALUE: ['freightValue']
};
const present = (value: any) => value !== undefined && value !== null && value !== '' && value !== '[]';
const normalized = (value: any) => String(value || '').trim().toUpperCase();
const modalOf = (data: any) => normalized(data.modal) === 'AIR' || normalized(data.loadType).includes('AIR') ? 'AIR' : normalized(data.loadType).includes('LCL') ? 'SEA_LCL' : 'SEA_FCL';
const textMatch = (rule: any, actual: any) => !rule || normalized(rule) === 'ALL' || normalized(actual).includes(normalized(rule)) || normalized(rule).includes(normalized(actual));

export class PartnerRuleError extends Error {}

export async function enforcePartnerRules(input: any, stage: string, current?: any) {
  const merged = { ...(current || {}), ...input };
  const agents = await prisma.agent.findMany({ where: { active: true } });
  const email = normalized(merged.agentEmail), name = normalized(merged.agentName), carrier = normalized(merged.carrier);
  const partner = agents.find(agent => {
    if (email && normalized(agent.email).split(/[;,]/).some(value => value.trim() === email)) return true;
    return [normalized(agent.name), normalized(agent.code)].filter(Boolean).some(value => value === name || value === carrier || (carrier && carrier.includes(value)));
  });
  if (!partner) return input;
  const now = new Date(), modal = modalOf(merged);
  const rules = await prisma.partnerRule.findMany({ where: { partnerId: partner.id, active: true, OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: now } }], AND: [{ OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }] }] }, orderBy: { priority: 'asc' } });
  for (const rule of rules) {
    if (!['ALL', modal].includes(normalized(rule.modal))) continue;
    if (!['ALL', normalized(merged.direction)].includes(normalized(rule.direction))) continue;
    if (!['ALL', normalized(merged.incoterm)].includes(normalized(rule.incoterm))) continue;
    if (!['ALL', normalized(stage)].includes(normalized(rule.stage))) continue;
    if (!textMatch(rule.route, `${merged.originPort || ''} ${merged.originCity || ''} ${merged.destinationPort || ''} ${merged.destinationCity || ''}`)) continue;
    if (!textMatch(rule.equipment, merged.loadType)) continue;
    const keys = FIELD_MAP[normalized(rule.fieldKey)] || [];
    if (!keys.length) continue;
    if (rule.behavior === 'REQUIRED' && !keys.some(key => present(merged[key]))) throw new PartnerRuleError(`${rule.name} é obrigatória para ${partner.name}${rule.reason ? ': ' + rule.reason : ''}`);
    if (rule.behavior === 'LOCKED' && current && keys.some(key => input[key] !== undefined && JSON.stringify(input[key]) !== JSON.stringify(current[key]))) throw new PartnerRuleError(`${rule.name} está bloqueada para ${partner.name}.`);
    if (rule.behavior === 'NOT_APPLICABLE') keys.forEach(key => { input[key] = null; });
  }
  return input;
}
