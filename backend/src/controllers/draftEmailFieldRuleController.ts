import { Request, Response } from 'express';
import { prisma } from '../prisma';

const DEFAULT_RULES: Array<{ modal: string; direction: string; fieldLabel: string; sortOrder: number }> = [
  { modal: 'ALL', direction: 'ALL', fieldLabel: 'Incoterm', sortOrder: 0 },
  { modal: 'ALL', direction: 'ALL', fieldLabel: 'Porto/Aeroporto de Origem e Destino', sortOrder: 1 },
  { modal: 'SEA', direction: 'ALL', fieldLabel: 'Quantidade e tipo de container', sortOrder: 2 },
  { modal: 'AIR', direction: 'ALL', fieldLabel: 'Dimensões e Peso', sortOrder: 2 },
  { modal: 'ALL', direction: 'ALL', fieldLabel: 'Valor do frete', sortOrder: 3 },
  { modal: 'ALL', direction: 'ALL', fieldLabel: 'Validade da cotação', sortOrder: 4 },
  { modal: 'ALL', direction: 'ALL', fieldLabel: 'Transit time', sortOrder: 5 },
  { modal: 'ALL', direction: 'ALL', fieldLabel: 'Free time', sortOrder: 6 }
];

// Lista todas as regras, com filtro opcional por modal e direção
export const getDraftEmailFieldRules = async (req: Request, res: Response) => {
  try {
    const { modal, direction } = req.query;
    const where: any = {};
    if (modal) where.modal = { in: [String(modal).toUpperCase(), 'ALL'] };
    if (direction) where.direction = { in: [String(direction).toUpperCase(), 'ALL'] };

    const rules = await prisma.draftEmailFieldRule.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }]
    });
    res.json(rules);
  } catch (error) {
    console.error('Erro ao buscar itens obrigatórios do e-mail:', error);
    res.status(500).json({ error: 'Erro ao buscar itens obrigatórios do e-mail.' });
  }
};

// Cria uma nova regra
export const createDraftEmailFieldRule = async (req: Request, res: Response) => {
  try {
    const { modal, direction, fieldLabel, sortOrder, active } = req.body;
    if (!fieldLabel) return res.status(400).json({ error: 'Informe o rótulo do item.' });

    const rule = await prisma.draftEmailFieldRule.create({
      data: {
        modal: modal ? String(modal).toUpperCase() : 'ALL',
        direction: direction ? String(direction).toUpperCase() : 'ALL',
        fieldLabel,
        sortOrder: sortOrder !== undefined ? Number(sortOrder) : 0,
        active: active !== undefined ? active : true
      }
    });
    res.status(201).json(rule);
  } catch (error) {
    console.error('Erro ao criar item obrigatório do e-mail:', error);
    res.status(500).json({ error: 'Erro ao criar item obrigatório do e-mail.' });
  }
};

// Atualiza uma regra
export const updateDraftEmailFieldRule = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { modal, direction, fieldLabel, sortOrder, active } = req.body;

    const rule = await prisma.draftEmailFieldRule.update({
      where: { id },
      data: {
        ...(modal !== undefined && { modal: String(modal).toUpperCase() }),
        ...(direction !== undefined && { direction: String(direction).toUpperCase() }),
        ...(fieldLabel !== undefined && { fieldLabel }),
        ...(sortOrder !== undefined && { sortOrder: Number(sortOrder) }),
        ...(active !== undefined && { active })
      }
    });
    res.json(rule);
  } catch (error) {
    console.error('Erro ao atualizar item obrigatório do e-mail:', error);
    res.status(500).json({ error: 'Erro ao atualizar item obrigatório do e-mail.' });
  }
};

// Remove uma regra
export const deleteDraftEmailFieldRule = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.draftEmailFieldRule.delete({ where: { id } });
    res.status(204).send();
  } catch (error) {
    console.error('Erro ao excluir item obrigatório do e-mail:', error);
    res.status(500).json({ error: 'Erro ao excluir item obrigatório do e-mail.' });
  }
};

// Popula os itens padrão (não duplica se já existirem itens cadastrados)
export const seedDraftEmailFieldRules = async (_req: Request, res: Response) => {
  try {
    const count = await prisma.draftEmailFieldRule.count();
    if (count > 0) {
      return res.status(409).json({ error: 'Já existem itens cadastrados. Remova-os antes de carregar os padrões novamente.' });
    }
    await prisma.draftEmailFieldRule.createMany({ data: DEFAULT_RULES });
    const rules = await prisma.draftEmailFieldRule.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
    res.status(201).json(rules);
  } catch (error) {
    console.error('Erro ao popular itens obrigatórios do e-mail:', error);
    res.status(500).json({ error: 'Erro ao popular itens obrigatórios do e-mail.' });
  }
};
