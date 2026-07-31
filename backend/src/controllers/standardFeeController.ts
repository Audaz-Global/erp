import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

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
    const { name, type, chargeType, value, minValue, currency, percentBase, description, active } = req.body;
    const fee = await prisma.standardFee.create({
      data: {
        name,
        type,
        chargeType,
        value: Number(value),
        minValue: minValue !== undefined && minValue !== null && minValue !== '' ? Number(minValue) : null,
        currency: currency || 'USD',
        percentBase: chargeType === 'PERCENTAGE' ? (percentBase || 'FREIGHT') : null,
        description: description || null,
        active: active !== undefined ? active : true
      }
    });
    res.status(201).json(fee);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao criar taxa local padrão.' });
  }
};

export const updateStandardFee = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, type, chargeType, value, minValue, currency, percentBase, description, active } = req.body;
    const current = await prisma.standardFee.findUnique({ where: { id } });
    if (!current) return res.status(404).json({ error: 'Taxa local não encontrada.' });
    const effectiveChargeType = chargeType || current.chargeType;

    const fee = await prisma.standardFee.update({
      where: { id },
      data: {
        name,
        type,
        chargeType,
        value: value !== undefined ? Number(value) : undefined,
        minValue: minValue !== undefined ? (minValue !== null && minValue !== '' ? Number(minValue) : null) : undefined,
        currency,
        percentBase: percentBase !== undefined || chargeType !== undefined
          ? (effectiveChargeType === 'PERCENTAGE' ? (percentBase || current.percentBase || 'FREIGHT') : null)
          : undefined,
        description: description !== undefined ? (description || null) : undefined,
        active
      }
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
