import { prisma } from '../prisma';
import { normalizeFeeList } from './feeCalculationService';

export const APPLICABILITY = {
  REQUIRED: 'REQUIRED',
  APPLICABLE: 'APPLICABLE',
  CONDITIONAL: 'CONDITIONAL',
  NOT_APPLICABLE: 'NOT_APPLICABLE',
  TO_CONFIRM: 'TO_CONFIRM'
} as const;

function plain(value: unknown) {
  return String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
}

function normalizeModal(modal: unknown, loadType?: unknown) {
  const value = plain(modal);
  if (value === 'AIR' || value.includes('AIR')) return 'AIR';
  if (value.includes('LCL') || plain(loadType).includes('LCL')) return 'SEA_LCL';
  return 'SEA_FCL';
}

function normalizeDirection(direction: unknown) {
  const value = plain(direction);
  return value === 'IMPORT' || value === 'EXPORT' ? value : 'ALL';
}

export interface ApplicabilityContext {
  direction?: string;
  loadType?: string;
  isDangerousGoods?: boolean;
  insuranceRequested?: boolean;
  customsClearanceContracted?: boolean;
}

/**
 * Condições estruturadas suportadas pelas regras CONDITIONAL. Cada tipo é
 * avaliado contra o contexto real da cotação e (quando relevante) a própria
 * taxa — ex: NOT_INCLUDED_IN_FREIGHT depende do includedInFreight já
 * classificado pela normalização de taxas.
 */
export function evaluateIncotermCondition(condition: unknown, ctx: ApplicabilityContext, fee?: any): { met: boolean; reason?: string } {
  let parsed: any = null;
  if (condition && typeof condition === 'object') parsed = condition;
  else if (typeof condition === 'string' && condition.trim()) {
    try { parsed = JSON.parse(condition); } catch { parsed = null; }
  }
  const type = plain(parsed?.type);
  if (!type) return { met: false, reason: 'Condição não configurada na regra — revise manualmente.' };
  switch (type) {
    case 'DG_ONLY': return { met: Boolean(ctx.isDangerousGoods), reason: 'Aplicável apenas quando a carga é perigosa (DG).' };
    case 'NOT_DG': return { met: !ctx.isDangerousGoods, reason: 'Aplicável apenas quando a carga não é perigosa.' };
    case 'INSURANCE_REQUESTED': return { met: Boolean(ctx.insuranceRequested), reason: 'Aplicável apenas quando o seguro foi solicitado.' };
    case 'CUSTOMS_CLEARANCE_CONTRACTED': return { met: Boolean(ctx.customsClearanceContracted), reason: 'Aplicável apenas quando o desembaraço aduaneiro foi contratado.' };
    case 'IMPORT_ONLY': return { met: plain(ctx.direction) === 'IMPORT', reason: 'Aplicável apenas em importação.' };
    case 'EXPORT_ONLY': return { met: plain(ctx.direction) === 'EXPORT', reason: 'Aplicável apenas em exportação.' };
    case 'FCL_ONLY': return { met: plain(ctx.loadType).includes('FCL'), reason: 'Aplicável apenas para carga FCL.' };
    case 'LCL_ONLY': return { met: plain(ctx.loadType).includes('LCL'), reason: 'Aplicável apenas para carga LCL.' };
    case 'NOT_INCLUDED_IN_FREIGHT': return { met: fee?.includedInFreight !== 'INCLUDED', reason: 'Aplicável apenas quando a cobrança não está incluída no frete.' };
    default: return { met: false, reason: `Tipo de condição desconhecido (${type}) — revise a regra.` };
  }
}

async function getRulesForApplicability(incoterm: string, modal: string, direction: string) {
  const normalizedIncoterm = plain(incoterm) || 'ALL';
  const dbModal = normalizeModal(modal);
  const dbDirection = normalizeDirection(direction);
  return prisma.incotermRule.findMany({
    where: {
      incoterm: { in: [normalizedIncoterm, 'ALL'] },
      modal: { in: [dbModal, 'ALL'] },
      direction: { in: [dbDirection, 'ALL'] },
      active: true
    }
  });
}

function specificityScore(rule: { incoterm: string; modal: string; direction: string }) {
  return (rule.incoterm === 'ALL' ? 0 : 4) + (rule.modal === 'ALL' ? 0 : 2) + (rule.direction === 'ALL' ? 0 : 1);
}

/**
 * Escolhe, entre as regras candidatas para um feeType, a mais específica —
 * priorizando casamento por grupo financeiro (critério principal, conforme
 * definido junto ao time comercial) e usando o nome da taxa apenas como
 * fallback para regras legadas sem financialGroup cadastrado.
 */
function matchRuleForFee(fee: any, rules: any[]) {
  const feeType = fee.applicationScope === 'ORIGIN' ? 'ORIGIN' : fee.applicationScope === 'DESTINATION' ? 'DESTINATION' : null;
  if (!feeType) return null;
  const candidates = rules.filter(rule => rule.feeType === feeType);
  const byFinancialGroup = fee.financialGroup && fee.financialGroup !== 'TO_CONFIRM'
    ? candidates.filter(rule => rule.financialGroup === fee.financialGroup)
    : [];
  const pool = byFinancialGroup.length > 0
    ? byFinancialGroup
    : candidates.filter(rule => !rule.financialGroup && plain(rule.feeName) === plain(fee.name));
  if (pool.length === 0) return null;
  return [...pool].sort((a, b) => specificityScore(b) - specificityScore(a))[0];
}

function annotateFee(fee: any, rules: any[], ctx: ApplicabilityContext, alerts: Array<{ code: string; level: 'INFO' | 'WARNING'; message: string; feeNames?: string[] }>) {
  const rule = matchRuleForFee(fee, rules);
  if (!rule) return { ...fee, incotermApplicability: null, incotermRuleReason: null };

  if (rule.applicability === APPLICABILITY.NOT_APPLICABLE) {
    alerts.push({
      code: 'INCOTERM_NOT_APPLICABLE', level: 'WARNING',
      message: `${fee.name}: taxa atípica para ${plain(rule.incoterm)}${rule.reason ? ' — ' + rule.reason : '.'} Foi mantida porque já havia valor lançado; revise antes de finalizar.`,
      feeNames: [fee.name]
    });
    return { ...fee, incotermApplicability: rule.applicability, incotermRuleReason: rule.reason || null };
  }

  if (rule.applicability === APPLICABILITY.CONDITIONAL) {
    const { met, reason } = evaluateIncotermCondition(rule.condition, ctx, fee);
    if (!met) {
      alerts.push({
        code: 'INCOTERM_CONDITION_UNMET', level: 'WARNING',
        message: `${fee.name}: condição da regra de Incoterm não confirmada (${reason || rule.reason || 'revise a condição'}).`,
        feeNames: [fee.name]
      });
    }
    return { ...fee, incotermApplicability: rule.applicability, incotermRuleReason: rule.reason || null };
  }

  if (rule.applicability === APPLICABILITY.TO_CONFIRM) {
    alerts.push({
      code: 'INCOTERM_TO_CONFIRM', level: 'WARNING',
      message: `${fee.name}: aplicabilidade ao Incoterm precisa ser confirmada antes de finalizar${rule.reason ? ' — ' + rule.reason : '.'}`,
      feeNames: [fee.name]
    });
    return { ...fee, incotermApplicability: rule.applicability, incotermRuleReason: rule.reason || null };
  }

  return { ...fee, incotermApplicability: rule.applicability, incotermRuleReason: rule.reason || null };
}

function requiredMissingAlerts(originFees: any[], destinationFees: any[], rules: any[]) {
  const alerts: Array<{ code: string; level: 'INFO' | 'WARNING'; message: string; feeNames?: string[] }> = [];
  const requiredRules = rules.filter(rule => rule.applicability === APPLICABILITY.REQUIRED && rule.financialGroup);
  for (const rule of requiredRules) {
    const fees = rule.feeType === 'ORIGIN' ? originFees : destinationFees;
    const present = fees.some(fee => fee.financialGroup === rule.financialGroup && (fee.totalValue ?? fee.value ?? 0) > 0);
    if (!present) {
      alerts.push({
        code: 'INCOTERM_REQUIRED_MISSING', level: 'WARNING',
        message: `Taxa obrigatória ausente para este Incoterm: ${rule.feeName}${rule.reason ? ' — ' + rule.reason : '.'}`,
        feeNames: [rule.feeName]
      });
    }
  }
  return alerts;
}

export async function evaluateIncotermApplicability(quotation: any) {
  const incoterm = quotation?.incoterm;
  if (!incoterm) return { originFees: [], destinationFees: [], alerts: [] as Array<{ code: string; level: 'INFO' | 'WARNING'; message: string; feeNames?: string[] }> };

  const modal = normalizeModal(quotation.modal, quotation.loadType);
  const direction = normalizeDirection(quotation.direction);
  const ctx: ApplicabilityContext = {
    direction,
    loadType: quotation.loadType,
    isDangerousGoods: Boolean(quotation.dangerousGoodsProductCount > 0 || quotation.dangerousGoodsStatus === 'CONFIRMED' || quotation.isImo),
    insuranceRequested: Boolean(quotation.requiresInsurance),
    customsClearanceContracted: Boolean(quotation.customsClearanceIncluded)
  };

  const rules = await getRulesForApplicability(incoterm, modal, direction);
  if (rules.length === 0) return { originFees: normalizeFeeList(quotation.originServices, 'ORIGIN'), destinationFees: normalizeFeeList(quotation.destinationServices, 'DESTINATION'), alerts: [] };

  const alerts: Array<{ code: string; level: 'INFO' | 'WARNING'; message: string; feeNames?: string[] }> = [];
  const originFees = normalizeFeeList(quotation.originServices, 'ORIGIN').map(fee => annotateFee(fee, rules, ctx, alerts));
  const destinationFees = normalizeFeeList(quotation.destinationServices, 'DESTINATION').map(fee => annotateFee(fee, rules, ctx, alerts));
  alerts.push(...requiredMissingAlerts(originFees, destinationFees, rules));

  return { originFees, destinationFees, alerts };
}

export async function withIncotermApplicability<T extends object>(quotation: T): Promise<T & { incotermApplicability: Awaited<ReturnType<typeof evaluateIncotermApplicability>> }> {
  const incotermApplicability = await evaluateIncotermApplicability(quotation);
  return { ...quotation, incotermApplicability };
}
