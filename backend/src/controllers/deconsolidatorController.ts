import { Request, Response } from 'express';
import { prisma } from '../prisma';

const DEFAULT_DECONSOLIDATORS: Array<{ name: string; location: string | null; modal: string; value: number; currency: string }> = [
  { name: 'Ohpers', location: null, modal: 'SEA_FCL', value: 146.76, currency: 'BRL' },
  { name: 'Ohpers', location: null, modal: 'SEA_LCL', value: 67.74, currency: 'BRL' },
  { name: 'Richard', location: 'GRU', modal: 'AIR', value: 71.50, currency: 'BRL' },
  { name: 'Cadu', location: 'VCP', modal: 'AIR', value: 71.50, currency: 'BRL' }
];

// Lista todos os desconsolidadores, com filtro opcional por modal
export const getDeconsolidators = async (req: Request, res: Response) => {
  try {
    const { modal } = req.query;
    const where: any = {};
    if (modal) where.modal = String(modal).toUpperCase();

    const rows = await prisma.deconsolidator.findMany({
      where,
      orderBy: [{ name: 'asc' }, { modal: 'asc' }]
    });
    res.json(rows);
  } catch (error) {
    console.error('Erro ao buscar desconsolidadores:', error);
    res.status(500).json({ error: 'Erro ao buscar desconsolidadores.' });
  }
};

// Cria um novo desconsolidador
export const createDeconsolidator = async (req: Request, res: Response) => {
  try {
    const { name, location, modal, value, currency, active } = req.body;
    if (!name || !modal || value === undefined) {
      return res.status(400).json({ error: 'Informe nome, modal e valor.' });
    }
    const row = await prisma.deconsolidator.create({
      data: {
        name,
        location: location || null,
        modal: String(modal).toUpperCase(),
        value: Number(value),
        currency: currency || 'BRL',
        active: active !== undefined ? active : true
      }
    });
    res.status(201).json(row);
  } catch (error) {
    console.error('Erro ao criar desconsolidador:', error);
    res.status(500).json({ error: 'Erro ao criar desconsolidador.' });
  }
};

// Atualiza um desconsolidador
export const updateDeconsolidator = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, location, modal, value, currency, active } = req.body;

    const row = await prisma.deconsolidator.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(location !== undefined && { location: location || null }),
        ...(modal !== undefined && { modal: String(modal).toUpperCase() }),
        ...(value !== undefined && { value: Number(value) }),
        ...(currency !== undefined && { currency }),
        ...(active !== undefined && { active })
      }
    });
    res.json(row);
  } catch (error) {
    console.error('Erro ao atualizar desconsolidador:', error);
    res.status(500).json({ error: 'Erro ao atualizar desconsolidador.' });
  }
};

// Remove um desconsolidador
export const deleteDeconsolidator = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.deconsolidator.delete({ where: { id } });
    res.status(204).send();
  } catch (error) {
    console.error('Erro ao excluir desconsolidador:', error);
    res.status(500).json({ error: 'Erro ao excluir desconsolidador.' });
  }
};

// Popula os desconsolidadores padrão (não duplica se já existirem)
export const seedDeconsolidators = async (_req: Request, res: Response) => {
  try {
    const count = await prisma.deconsolidator.count();
    if (count > 0) {
      return res.status(409).json({ error: 'Já existem desconsolidadores cadastrados. Remova-os antes de carregar os padrões novamente.' });
    }
    await prisma.deconsolidator.createMany({ data: DEFAULT_DECONSOLIDATORS });
    const rows = await prisma.deconsolidator.findMany({ orderBy: [{ name: 'asc' }, { modal: 'asc' }] });
    res.status(201).json(rows);
  } catch (error) {
    console.error('Erro ao popular desconsolidadores:', error);
    res.status(500).json({ error: 'Erro ao popular desconsolidadores.' });
  }
};
