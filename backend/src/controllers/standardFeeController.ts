import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const VALID_MODAL_SCOPES = new Set(['ALL', 'AIR', 'SEA_FCL', 'SEA_LCL']);

function normalizeModalScope(value: unknown) {
  const parts = String(value || 'ALL').toUpperCase().split(',').map(v => v.trim()).filter(Boolean);
  const unique = [...new Set(parts.length ? parts : ['ALL'])];
  if (unique.includes('ALL')) return 'ALL';
  if (!unique.every(scope => VALID_MODAL_SCOPES.has(scope))) throw new Error('Modal de compatibilidade inválido.');
  return unique.join(',');
}

export const getAllStandardFees = async (req: Request, res: Response) => {
  try {
    const fees = await prisma.standardFee.findMany({
      include: { _count: { select: { incotermRules: true } } },
      orderBy: { createdAt: 'desc' }
    });
    res.json(fees);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar taxas locais padrão.' });
  }
};

export const createStandardFee = async (req: Request, res: Response) => {
  try {
    const { name, type, chargeType, value, pricingStatus, minValue, currency, percentBase, description, modalScope, active } = req.body;
    const effectivePricingStatus = pricingStatus === 'ON_REQUEST' ? 'ON_REQUEST' : 'PRICED';
    if (effectivePricingStatus === 'PRICED' && (value === undefined || value === null || value === '')) return res.status(400).json({ error: 'Informe o valor ou selecione “A cotar”.' });
    const fee = await prisma.standardFee.create({
      data: {
        name,
        type,
        chargeType,
        value: effectivePricingStatus === 'ON_REQUEST' ? 0 : Number(value),
        pricingStatus: effectivePricingStatus,
        minValue: minValue !== undefined && minValue !== null && minValue !== '' ? Number(minValue) : null,
        currency: currency || 'USD',
        percentBase: chargeType === 'PERCENTAGE' ? (percentBase || 'FREIGHT') : null,
        description: description || null,
        modalScope: normalizeModalScope(modalScope),
        active: active !== undefined ? active : true
      } as any
    });
    res.status(201).json(fee);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao criar taxa local padrão.' });
  }
};

export const updateStandardFee = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, type, chargeType, value, pricingStatus, minValue, currency, percentBase, description, modalScope, active } = req.body;
    const current = await prisma.standardFee.findUnique({ where: { id } });
    if (!current) return res.status(404).json({ error: 'Taxa local não encontrada.' });
    const effectiveChargeType = chargeType || current.chargeType;
    const effectivePricingStatus = pricingStatus === 'ON_REQUEST' ? 'ON_REQUEST' : (pricingStatus === 'PRICED' ? 'PRICED' : (current as any).pricingStatus || 'PRICED');
    if (effectivePricingStatus === 'PRICED' && value !== undefined && (value === null || value === '')) return res.status(400).json({ error: 'Informe o valor ou selecione “A cotar”.' });

    const fee = await prisma.standardFee.update({
      where: { id },
      data: {
        name,
        type,
        chargeType,
        value: effectivePricingStatus === 'ON_REQUEST' ? 0 : (value !== undefined ? Number(value) : undefined),
        pricingStatus: effectivePricingStatus,
        minValue: minValue !== undefined ? (minValue !== null && minValue !== '' ? Number(minValue) : null) : undefined,
        currency,
        percentBase: percentBase !== undefined || chargeType !== undefined
          ? (effectiveChargeType === 'PERCENTAGE' ? (percentBase || current.percentBase || 'FREIGHT') : null)
          : undefined,
        description: description !== undefined ? (description || null) : undefined,
        modalScope: modalScope !== undefined ? normalizeModalScope(modalScope) : undefined,
        active
      } as any
    });
    res.json(fee);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar taxa local padrão.' });
  }
};

export const deleteStandardFee = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const linkedRules = await prisma.incotermRule.count({ where: { standardFeeId: id } });
    if (linkedRules > 0) {
      return res.status(409).json({
        error: `Esta taxa está vinculada a ${linkedRules} regra(s) de Incoterm. Remova os vínculos antes de excluir.`
      });
    }
    await prisma.standardFee.delete({ where: { id } });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao deletar taxa local padrão.' });
  }
};
