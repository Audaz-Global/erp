import { PrismaClient, Prisma } from '@prisma/client';
import {
  lockIncotermRuleOrdering,
  parseIncotermRuleSortOrder
} from './incotermRuleOrderService';
import { findOrCreateStandardFeeForLegacyRule, standardFeeSnapshot } from './standardFeeLinkService';

const prisma = new PrismaClient();

export interface IncotermTreeFeePayload {
  id?: string;
  standardFeeId?: string;
  feeName?: string;
  feeType?: string;
  chargeType?: string;
  value?: number;
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

export interface IncotermTreeFieldRulePayload {
  id?: string;
  fieldKey: string;
  behavior: string;
  reason?: string;
  active?: boolean;
  stage?: string;
}

export interface IncotermTreePayload {
  incoterm: string;
  direction: string;
  modal: string;
  originFees: IncotermTreeFeePayload[];
  destinationFees: IncotermTreeFeePayload[];
  fieldRules: IncotermTreeFieldRulePayload[];
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

  const fieldRules = await prisma.incotermFieldRule.findMany({
    where: { incoterm: incotermUpper, direction: directionUpper, modal: modalUpper },
    orderBy: [{ fieldKey: 'asc' }]
  });

  return {
    incoterm: incotermUpper,
    direction: directionUpper,
    modal: modalUpper,
    originFees: rules.filter(r => r.feeType === 'ORIGIN'),
    destinationFees: rules.filter(r => r.feeType === 'DESTINATION'),
    fieldRules
  };
}

export async function updateIncotermTree(payload: IncotermTreePayload) {
  const { incoterm, direction, modal, originFees = [], destinationFees = [], fieldRules = [] } = payload;
  
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

    await tx.incotermFieldRule.deleteMany({
      where: { incoterm: incotermUpper, direction: directionUpper, modal: modalUpper }
    });

    // Recreate fees
    let sortOrderCounter = 1;
    for (const feeData of allFees) {
      if (!feeData) continue;
      let feeId = feeData.standardFeeId;

      // Se não veio com ID de taxa padrão, precisa encontrar ou criar (legacy fallback)
      if (!feeId) {
        if (!feeData.feeName || !feeData.feeType || !feeData.chargeType || feeData.value === undefined) {
          throw new Error('Parâmetros incompletos para recriar taxa legada (feeName, feeType, chargeType, value). Use standardFeeId sempre que possível.');
        }

        const standardFee = await findOrCreateStandardFeeForLegacyRule(tx as any, {
          feeName: feeData.feeName,
          feeType: feeData.feeType,
          chargeType: feeData.chargeType,
          value: Number(feeData.value),
          minValue: feeData.minValue !== undefined && feeData.minValue !== null ? Number(feeData.minValue) : null,
          currency: feeData.currency || 'USD',
          percentBase: feeData.percentBase || null,
          description: feeData.description || null,
          active: feeData.active !== undefined ? feeData.active : true
        } as any);
        feeId = standardFee.id;
      }
      
      const standardFeeObj = await tx.standardFee.findUnique({ where: { id: feeId } });
      if (!standardFeeObj) throw new Error(`Standard fee ${feeId} not found`);

      // Verifica suporte a modal
      const scopes = String(standardFeeObj.modalScope || 'ALL').toUpperCase().split(',').map(s => s.trim());
      const supportsModal = scopes.includes('ALL') || scopes.includes(modalUpper);
      if (!supportsModal) {
        throw new Error(`A taxa ${standardFeeObj.name} não é compatível com o modal ${modalUpper}.`);
      }

      await tx.incotermRule.create({
        data: {
          incoterm: incotermUpper,
          direction: directionUpper,
          modal: modalUpper,
          required: Boolean(feeData.required),
          applicability: feeData.applicability || 'APPLICABLE',
          financialGroup: feeData.financialGroup || null,
          condition: feeData.condition ? JSON.stringify(feeData.condition) : null,
          reason: feeData.reason || null,
          standardFeeId: standardFeeObj.id,
          ...standardFeeSnapshot(standardFeeObj),
          sortOrder: parseIncotermRuleSortOrder(feeData.sortOrder) || sortOrderCounter++,
          active: feeData.active !== undefined ? feeData.active : true
        } as any
      });
    }

    // Recreate field rules
    for (const fr of fieldRules) {
      await tx.incotermFieldRule.create({
        data: {
          incoterm: incotermUpper,
          direction: directionUpper,
          modal: modalUpper,
          stage: String(fr.stage || 'ALL').toUpperCase(),
          fieldKey: String(fr.fieldKey).toUpperCase(),
          behavior: String(fr.behavior || 'EDITABLE').toUpperCase(),
          reason: fr.reason ? String(fr.reason).trim() : null,
          active: fr.active !== false
        }
      });
    }

    return getIncotermTree(incotermUpper, directionUpper, modalUpper);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10000, timeout: 10000 });
}
