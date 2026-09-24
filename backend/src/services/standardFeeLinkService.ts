import { IncotermRule, PrismaClient, StandardFee } from '@prisma/client';

type RuleWithStandardFee = IncotermRule & { standardFee?: StandardFee | null };

function nullableNumber(value: unknown): number | null {
  return value === undefined || value === null || value === '' ? null : Number(value);
}

export function standardFeeSnapshot(fee: StandardFee) {
  return {
    feeType: fee.type,
    feeName: fee.name,
    chargeType: fee.chargeType,
    value: fee.value,
    costValue: (fee as any).costValue ?? null,
    pricingStatus: (fee as any).pricingStatus || 'PRICED',
    minValue: fee.minValue,
    currency: fee.currency,
    costCurrency: (fee as any).costCurrency ?? null,
    minCurrency: (fee as any).minCurrency ?? null,
    percentBase: fee.percentBase,
    description: fee.description
  };
}

export function effectiveIncotermRule(rule: RuleWithStandardFee) {
  const fee = rule.standardFee;
  const snapshot = fee ? standardFeeSnapshot(fee) : null;
  return {
    ...rule,
    ...(snapshot || {}),
    // Campos opcionais do catálogo (StandardFee) não podem apagar um valor
    // já cadastrado especificamente na regra (IncotermRule) quando o próprio
    // catálogo ainda não tem esse dado preenchido — senão uma Compra/Mínimo
    // configurado só na regra (ex: CCT Fee com costValue próprio) some
    // silenciosamente e a taxa passa a mostrar Compra = Venda.
    costValue: snapshot?.costValue ?? rule.costValue ?? null,
    costCurrency: snapshot?.costCurrency ?? rule.costCurrency ?? null,
    minCurrency: snapshot?.minCurrency ?? rule.minCurrency ?? null,
    minValue: snapshot?.minValue ?? rule.minValue ?? null,
    standardFeeId: fee?.id || rule.standardFeeId || null,
    standardFee: fee || null,
    active: rule.active && (fee ? fee.active : true)
  };
}

export async function findOrCreateStandardFeeForLegacyRule(
  prisma: PrismaClient,
  rule: Pick<IncotermRule, 'feeName' | 'feeType' | 'chargeType' | 'value' | 'minValue' | 'currency' | 'percentBase' | 'description' | 'active'>
): Promise<StandardFee> {
  const minValue = nullableNumber(rule.minValue);
  const candidates = await prisma.standardFee.findMany({
    where: {
      name: { equals: rule.feeName, mode: 'insensitive' },
      type: rule.feeType,
      chargeType: rule.chargeType,
      value: Number(rule.value),
      currency: rule.currency
    }
  });

  const existing = candidates.find(fee =>
    nullableNumber(fee.minValue) === minValue &&
    (fee.percentBase || null) === (rule.percentBase || null)
  );
  if (existing) return existing;

  return prisma.standardFee.create({
    data: {
      name: rule.feeName,
      type: rule.feeType,
      chargeType: rule.chargeType,
      value: Number(rule.value),
      minValue,
      currency: rule.currency || 'USD',
      percentBase: rule.percentBase || null,
      description: rule.description || null,
      active: rule.active
    }
  });
}

export async function backfillIncotermRuleStandardFees(prisma: PrismaClient): Promise<number> {
  const legacyRules = await prisma.incotermRule.findMany({ where: { standardFeeId: null } });
  let linked = 0;

  for (const rule of legacyRules) {
    const fee = await findOrCreateStandardFeeForLegacyRule(prisma, rule);
    await prisma.incotermRule.update({
      where: { id: rule.id },
      data: { standardFeeId: fee.id }
    });
    linked++;
  }

  return linked;
}
