import { PrismaClient, Prisma } from '@prisma/client';
import {
  lockIncotermRuleOrdering,
  parseIncotermRuleSortOrder
} from './incotermRuleOrderService';

const prisma = new PrismaClient();

export interface IncotermTreeFeePayload {
  id?: string;
  standardFeeId?: string;
  feeName?: string;
  feeType?: string;
  chargeType?: string;
  value?: number;
  pricingStatus?: string;
  minValue?: number;
  currency?: string;
  percentBase?: string;
  description?: string;
  required?: boolean;
  applicability?: string;
  financialGroup?: string;
  condition?: any;
  reason?: string;
  sortOrder?: number;
  active?: boolean;
}

export interface IncotermTreePayload {
  incoterm: string;
  direction: string;
  modal: string;
  originFees: IncotermTreeFeePayload[];
  destinationFees: IncotermTreeFeePayload[];
}

export async function getIncotermTree(incoterm: string, direction: string, modal: string) {
  const incotermUpper = incoterm.toUpperCase();
  const directionUpper = direction.toUpperCase();
  const modalUpper = modal.toUpperCase();

  const rules = await prisma.incotermRule.findMany({
    where: { incoterm: incotermUpper, direction: directionUpper, modal: modalUpper },
    include: { standardFee: true },
    orderBy: [{ feeType: 'asc' }, { sortOrder: 'asc' }]
  });

  return {
    incoterm: incotermUpper,
    direction: directionUpper,
    modal: modalUpper,
    originFees: rules.filter(r => r.feeType === 'ORIGIN'),
    destinationFees: rules.filter(r => r.feeType === 'DESTINATION')
  };
}

export async function updateIncotermTree(payload: IncotermTreePayload) {
  const { incoterm, direction, modal, originFees = [], destinationFees = [] } = payload;
  
  const incotermUpper = incoterm.toUpperCase();
  const directionUpper = direction.toUpperCase();
  const modalUpper = modal.toUpperCase();

  const allFees = [...originFees.map(f => ({ ...f, feeType: 'ORIGIN' })), ...destinationFees.map(f => ({ ...f, feeType: 'DESTINATION' }))];

  return prisma.$transaction(async tx => {
    // Lock rule ordering table to prevent concurrent order conflicts globally if desired, 
    // but since we are overriding the whole tree, we just delete and recreate or update.
    await lockIncotermRuleOrdering(tx);

    // Delete all existing rules for this specific tree node
    await tx.incotermRule.deleteMany({
      where: { incoterm: incotermUpper, direction: directionUpper, modal: modalUpper }
    });

    // Recreate fees — cadastradas direto na árvore, sem depender de um catálogo de taxas padrão
    let sortOrderCounter = 1;
    for (const feeData of allFees) {
      if (!feeData) continue;
      if (!feeData.feeName || !feeData.chargeType) {
        throw new Error('Informe nome e tipo de cobrança da taxa.');
      }
      const pricingStatus = feeData.pricingStatus === 'ON_REQUEST' ? 'ON_REQUEST' : 'PRICED';
      if (pricingStatus === 'PRICED' && (feeData.value === undefined || feeData.value === null || (feeData.value as any) === '')) {
        throw new Error(`Informe o valor da taxa "${feeData.feeName}" ou marque "A cotar".`);
      }

      await tx.incotermRule.create({
        data: {
          incoterm: incotermUpper,
          direction: directionUpper,
          modal: modalUpper,
          required: Boolean(feeData.required),
          applicability: feeData.applicability || 'APPLICABLE',
          financialGroup: feeData.financialGroup || null,
          condition: feeData.condition ? (typeof feeData.condition === 'string' ? feeData.condition : JSON.stringify(feeData.condition)) : null,
          reason: feeData.reason || null,
          standardFeeId: null,
          feeType: feeData.feeType,
          feeName: String(feeData.feeName).trim(),
          chargeType: feeData.chargeType,
          value: pricingStatus === 'ON_REQUEST' ? 0 : Number(feeData.value),
          pricingStatus,
          minValue: feeData.minValue !== undefined && feeData.minValue !== null && (feeData.minValue as any) !== '' ? Number(feeData.minValue) : null,
          currency: feeData.currency || 'USD',
          percentBase: feeData.chargeType === 'PERCENTAGE' ? (feeData.percentBase || 'FREIGHT') : null,
          description: feeData.description || null,
          sortOrder: parseIncotermRuleSortOrder(feeData.sortOrder) || sortOrderCounter++,
          active: feeData.active !== undefined ? feeData.active : true
        } as any
      });
    }

    return getIncotermTree(incotermUpper, directionUpper, modalUpper);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10000, timeout: 10000 });
}
