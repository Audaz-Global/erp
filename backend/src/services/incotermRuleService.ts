import { PrismaClient, IncotermRule } from '@prisma/client';

const prisma = new PrismaClient();

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
}

/**
 * Busca as regras de Incoterm ativas para um dado incoterm + modal.
 * Primeiro busca regras específicas para o modal, depois complementa com regras "ALL".
 */
export async function getRulesForIncoterm(incoterm: string, modal: string): Promise<IncotermRule[]> {
  const normalizedIncoterm = incoterm.toUpperCase().trim();
  
  // Normalizar modal para o formato do banco
  let dbModal = modal.toUpperCase().trim();
  if (dbModal === 'AIR' || dbModal.includes('AIR')) dbModal = 'AIR';
  else if (dbModal.includes('FCL')) dbModal = 'SEA_FCL';
  else if (dbModal.includes('LCL')) dbModal = 'SEA_LCL';

  const rules = await prisma.incotermRule.findMany({
    where: {
      incoterm: normalizedIncoterm,
      modal: { in: [dbModal, 'ALL'] },
      active: true
    },
    orderBy: [
      { feeType: 'asc' }, // DESTINATION vem antes de ORIGIN por ordem alfa, mas usamos sortOrder
      { sortOrder: 'asc' }
    ]
  });

  // Se há regras específicas para o modal, elas têm prioridade.
  // Regras "ALL" só entram se não existir regra com mesmo feeName no modal específico.
  const specificRules = rules.filter(r => r.modal === dbModal);
  const allRules = rules.filter(r => r.modal === 'ALL');
  
  const specificNames = new Set(specificRules.map(r => `${r.feeType}:${r.feeName}`));
  const complementary = allRules.filter(r => !specificNames.has(`${r.feeType}:${r.feeName}`));

  return [...specificRules, ...complementary].sort((a, b) => {
    if (a.feeType !== b.feeType) return a.feeType === 'ORIGIN' ? -1 : 1;
    return a.sortOrder - b.sortOrder;
  });
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
  freightCurrency: string = 'USD'
): Promise<{ originFees: CalculatedFee[]; destinationFees: CalculatedFee[] }> {
  
  const rules = await getRulesForIncoterm(incoterm, modal);
  
  const originFees: CalculatedFee[] = [];
  const destinationFees: CalculatedFee[] = [];

  // Primeiro passo: calcular taxas de origem (para usar na base percentual de destino)
  const originRules = rules.filter(r => r.feeType === 'ORIGIN');
  const destinationRules = rules.filter(r => r.feeType === 'DESTINATION');

  for (const rule of originRules) {
    const fee = calculateFee(rule, chargableWeight, freightValue, 0);
    originFees.push(fee);
  }

  // Calcular total de origem para usar como base no PERCENTAGE de destino
  const totalOrigin = originFees.reduce((sum, f) => {
    // Converter para a mesma moeda base se possível (simplificação)
    return sum + f.value;
  }, 0);

  for (const rule of destinationRules) {
    const fee = calculateFee(rule, chargableWeight, freightValue, totalOrigin);
    destinationFees.push(fee);
  }

  return { originFees, destinationFees };
}

/**
 * Calcula o valor de uma taxa individual baseada na regra.
 */
function calculateFee(
  rule: IncotermRule,
  chargableWeight: number,
  freightValue: number,
  totalOrigin: number
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

    case 'PER_DOCUMENT':
      value = rule.value;
      qty = 1;
      unit = 'Por documento';
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
    total: `${rule.currency} ${value.toFixed(2)}`
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
