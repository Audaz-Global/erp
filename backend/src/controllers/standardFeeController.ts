import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const getAllStandardFees = async (req: Request, res: Response) => {
  try {
    const fees = await prisma.standardFee.findMany({
      orderBy: { createdAt: 'desc' }
    });
    res.json(fees);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar taxas locais padrão.' });
  }
};

export const createStandardFee = async (req: Request, res: Response) => {
  try {
    const { name, type, chargeType, value, currency, active } = req.body;
    const fee = await prisma.standardFee.create({
      data: {
        name,
        type,
        chargeType,
        value: Number(value),
        currency: currency || 'USD',
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
    const { name, type, chargeType, value, currency, active } = req.body;
    
    const fee = await prisma.standardFee.update({
      where: { id },
      data: {
        name,
        type,
        chargeType,
        value: value !== undefined ? Number(value) : undefined,
        currency,
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
    await prisma.standardFee.delete({ where: { id } });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao deletar taxa local padrão.' });
  }
};
