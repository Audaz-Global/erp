import { PrismaClient } from '@prisma/client';
import { effectiveIncotermRule } from './standardFeeLinkService';
import { evaluateIncotermCondition } from './incotermApplicabilityService';

const prisma = new PrismaClient();

type EffectiveIncotermRule = ReturnType<typeof effectiveIncotermRule>;

export interface CalculatedFee {
  name: string;
  value: number;
  currency: string;
  chargeType: string;
  description?: string;
  // Campos extras para exibição no PDF
  qty?: number | string;
  unit?: string;
  valueUnit?: string;
  min?: string;
  total?: string;
  unitValue?: number;
  billingUnit?: string;
  originalUnit?: string;
  quantity?: number | null;
  totalValue?: number;
  quantitySource?: string;
  needsReview?: boolean;
}

export interface FeeCalculationContext {
  totalCbm?: number;
  containerCount?: number;
  grossWeightKg?: number;
  dangerousGoodsProductCount?: number;
  insuranceRequested?: boolean;
  customsClearanceContracted?: boolean;
}

/**
 * Busca as regras de Incoterm ativas para um dado incoterm + modal.
 * Primeiro busca regras específicas para o modal, depois complementa com regras "ALL".
 */
export async function getRulesForIncoterm(incoterm: string, modal: string, direction: string = 'ALL', context: FeeCalculationContext = {}): Promise<EffectiveIncotermRule[]> {
  const normalizedIncoterm = incoterm.toUpperCase().trim();
  
  // Normalizar modal para o formato do banco
  let dbModal = modal.toUpperCase().trim();
  if (dbModal === 'AIR' || dbModal.includes('AIR')) dbModal = 'AIR';
  else if (dbModal.includes('FCL')) dbModal = 'SEA_FCL';
  else if (dbModal.includes('LCL')) dbModal = 'SEA_LCL';
  const dbDirection = ['IMPORT', 'EXPORT'].includes(String(direction).toUpperCase()) ? String(direction).toUpperCase() : 'ALL';

  const rules = await prisma.incotermRule.findMany({
    where: {
      incoterm: { in: [normalizedIncoterm, 'ALL'] },
      modal: { in: [dbModal, 'ALL'] },
      direction: { in: [dbDirection, 'ALL'] },
      active: true
    },
    include: { standardFee: true },
    orderBy: [
      { feeType: 'asc' }, // DESTINATION vem antes de ORIGIN por ordem alfa, mas usamos sortOrder
      { sortOrder: 'asc' }
    ]
  });

  // Se há regras específicas para o modal, elas têm prioridade.
  // Regras "ALL" só entram se não existir regra com mesmo feeName no modal específico.
  // Regras NOT_APPLICABLE nunca são oferecidas neste preenchimento automático
  // (lista ainda vazia — nada foi extraído/digitado, não há dado real a preservar).
  // Regras CONDITIONAL só entram quando a condição já é conhecida e atendida.
  const applicabilityContext = {
    direction: dbDirection,
    isDangerousGoods: Boolean(context.dangerousGoodsProductCount && context.dangerousGoodsProductCount > 0),
    insuranceRequested: Boolean(context.insuranceRequested),
    customsClearanceContracted: Boolean(context.customsClearanceContracted)
  };
  const effectiveRules = rules.map(effectiveIncotermRule).filter(r => {
    if (!r.active) return false;
    const applicability = (r as any).applicability || 'APPLICABLE';
    if (applicability === 'NOT_APPLICABLE') return false;
    if (applicability === 'CONDITIONAL') return evaluateIncotermCondition((r as any).condition, applicabilityContext).met;
    return true;
  });
  const ranked = effectiveRules.sort((a, b) => {
    const score = (rule: any) => (rule.incoterm === 'ALL' ? 0 : 4) + (rule.modal === 'ALL' ? 0 : 2) + (rule.direction === 'ALL' ? 0 : 1);
    return score(a) - score(b);
  });
  const selected = new Map<string, EffectiveIncotermRule>();
  ranked.forEach(rule => selected.set(`${rule.feeType}:${rule.feeName}`, rule));

  return [...selected.values()].sort((a, b) => {
    if (a.feeType !== b.feeType) return a.feeType === 'ORIGIN' ? -1 : 1;
    return a.sortOrder - b.sortOrder;
  });
}

/**
 * Resolve o valor de frete a usar num cálculo: se já veio um valor real (>0), usa ele.
 * Senão, procura as regras de Incoterm com feeType FREIGHT (cadastradas na Árvore de
 * Incoterms), calcula cada uma (reaproveitando calculateFee) e soma — desde que não
 * estejam marcadas "A cotar". `items` traz o detalhamento, útil pra exibir separado.
 */
export async function resolveFreightValue(
  incoterm: string,
  modal: string,
  direction: string = 'ALL',
  providedValue: number,
  providedCurrency: string = 'USD',
  context: FeeCalculationContext = {}
): Promise<{ value: number; currency: string; fromFallback: boolean; items: CalculatedFee[] }> {
  if (providedValue && providedValue > 0) {
    return { value: providedValue, currency: providedCurrency, fromFallback: false, items: [] };
  }

  const rules = await getRulesForIncoterm(incoterm, modal, direction, context);
  const freightRules = rules
    .filter(r => r.feeType === 'FREIGHT' && (r as any).pricingStatus !== 'ON_REQUEST')
    .sort((a, b) => a.sortOrder - b.sortOrder);

  if (freightRules.length === 0) {
    return { value: providedValue || 0, currency: providedCurrency, fromFallback: false, items: [] };
  }

  const items = freightRules.map(rule => calculateFee(rule, 0, 0, 0, context));
  const value = items.reduce((sum, item) => sum + item.value, 0);
  return { value, currency: items[0]!.currency, fromFallback: true, items };
}

/**
 * Calcula as taxas de origem e destino baseadas nas regras do Incoterm.
 *
 * @param incoterm - Ex: "EXW", "FCA", "FOB"
 * @param modal - Ex: "AIR", "SEA_FCL", "SEA_LCL"
 * @param chargableWeight - Peso taxável em kg
 * @param freightValue - Valor do frete
 * @param freightCurrency - Moeda do frete (USD, EUR, etc.)
 */
export async function getFeesForIncoterm(
  incoterm: string,
  modal: string,
  chargableWeight: number,
  freightValue: number,
  freightCurrency: string = 'USD',
  direction: string = 'ALL',
  context: FeeCalculationContext = {}
): Promise<{ originFees: CalculatedFee[]; destinationFees: CalculatedFee[] }> {
  
  const rules = await getRulesForIncoterm(incoterm, modal, direction, context);
  
  const originFees: CalculatedFee[] = [];
  const destinationFees: CalculatedFee[] = [];

  // Primeiro passo: calcular taxas de origem (para usar na base percentual de destino)
  const originRules = rules.filter(r => r.feeType === 'ORIGIN');
  const destinationRules = rules.filter(r => r.feeType === 'DESTINATION');

  for (const rule of originRules) {
    const fee = calculateFee(rule, chargableWeight, freightValue, 0, context);
    originFees.push(fee);
  }

  // Calcular total de origem para usar como base no PERCENTAGE de destino
  const totalOrigin = originFees.reduce((sum, f) => {
    // Converter para a mesma moeda base se possível (simplificação)
    return sum + f.value;
  }, 0);

  for (const rule of destinationRules) {
    const fee = calculateFee(rule, chargableWeight, freightValue, totalOrigin, context);
    destinationFees.push(fee);
  }

  return { originFees, destinationFees };
}

/**
 * Calcula o valor de uma taxa individual baseada na regra.
 */
export function calculateFee(
  rule: EffectiveIncotermRule,
  chargableWeight: number,
  freightValue: number,
  totalOrigin: number,
  context: FeeCalculationContext = {}
): CalculatedFee {
  let value = 0;
  let qty: number | string = 1;
  let unit = 'Fixo';
  let valueUnit = rule.value.toFixed(2);
  let min = rule.minValue ? rule.minValue.toFixed(2) : '0,00';

  switch (rule.chargeType) {
    case 'FIXED':
      value = rule.value;
      qty = 1;
      unit = 'Fixo';
      break;

    case 'PER_KG':
      value = rule.value * chargableWeight;
      if (rule.minValue && value < rule.minValue) {
        value = rule.minValue;
      }
      qty = chargableWeight;
      unit = 'Por Kg/cm3 (6000)';
      valueUnit = rule.value.toFixed(2);
      break;

    case 'PER_TON':
      qty = Number(context.grossWeightKg ?? chargableWeight) / 1000;
      value = rule.value * qty;
      unit = 'Por tonelada';
      valueUnit = rule.value.toFixed(2);
      break;

    case 'PER_CBM':
      qty = Number(context.totalCbm || 0);
      value = rule.value * Number(qty);
      unit = 'Por m³';
      valueUnit = rule.value.toFixed(2);
      break;

    case 'PER_WM': {
      const tons = chargableWeight / 1000;
      qty = Math.max(tons, Number(context.totalCbm || 0));
      value = rule.value * Number(qty);
      unit = 'Por tonelada-metro (W/M)';
      valueUnit = rule.value.toFixed(2);
      break;
    }

    case 'PER_CONTAINER':
      qty = Number(context.containerCount || 1);
      value = rule.value * Number(qty);
      unit = 'Por contêiner';
      valueUnit = rule.value.toFixed(2);
      break;

    case 'PER_DOCUMENT':
      value = rule.value;
      qty = 1;
      unit = 'Por documento';
      break;

    case 'PER_DG_PRODUCT':
      qty = Number(context.dangerousGoodsProductCount || 0);
      value = rule.value * Number(qty);
      unit = 'Por produto perigoso';
      valueUnit = rule.value.toFixed(2);
      break;

    case 'PERCENTAGE': {
      let base = 0;
      if (rule.percentBase === 'FREIGHT') {
        base = freightValue;
      } else if (rule.percentBase === 'FREIGHT_PLUS_ORIGIN') {
        base = freightValue + totalOrigin;
      } else {
        base = freightValue;
      }
      value = base * (rule.value / 100);
      if (rule.minValue && value < rule.minValue) {
        value = rule.minValue;
      }
      qty = '-';
      unit = '% de Taxas Selecionadas';
      valueUnit = `${rule.value.toFixed(2)} %`;
      break;
    }
  }

  return {
    name: rule.feeName,
    value,
    currency: rule.currency,
    chargeType: rule.chargeType,
    description: rule.description || undefined,
    qty,
    unit,
    valueUnit,
    min,
    total: `${rule.currency} ${value.toFixed(2)}`,
    unitValue: rule.value,
    billingUnit: ({ FIXED:'PER_SHIPMENT', PER_KG:'PER_CHARGEABLE_WEIGHT', PER_TON:'PER_TON', PER_CBM:'PER_CBM', PER_WM:'PER_WM', PER_CONTAINER:'PER_CONTAINER', PER_DG_PRODUCT:'PER_DG_PRODUCT', PER_DOCUMENT:'PER_DOCUMENT', PERCENTAGE:'PERCENTAGE' } as Record<string,string>)[rule.chargeType] || 'UNKNOWN',
    originalUnit: unit,
    quantity: typeof qty === 'number' ? qty : null,
    totalValue: value,
    quantitySource: rule.chargeType === 'PER_CONTAINER' ? 'CONTAINER_COUNT' : rule.chargeType === 'PER_KG' ? 'CHARGEABLE_WEIGHT' : rule.chargeType === 'PER_CBM' ? 'CARGO_CBM' : 'INCOTERM_RULE',
    needsReview: rule.chargeType === 'PER_DG_PRODUCT' && Number(qty) <= 0
  };
}

/**
 * Formata taxas calculadas para o formato esperado pelo PDF Service.
 */
export function formatFeesForPdf(fees: CalculatedFee[]): any[] {
  return fees.map(f => ({
    name: f.name,
    qty: f.qty,
    unit: f.unit,
    valueUnit: f.valueUnit,
    min: f.min,
    max: '0,00',
    currency: f.currency,
    total: f.total
  }));
}

/**
 * Formata taxas calculadas para o formato esperado pelo Quotation Controller (com BRL).
 */
export function formatFeesForController(
  fees: CalculatedFee[],
  getBrlValue: (val: number, currency: string) => number
): any[] {
  return fees.map(f => ({
    name: f.name,
    val: f.value,
    currency: f.currency,
    brl: getBrlValue(f.value, f.currency)
  }));
}
