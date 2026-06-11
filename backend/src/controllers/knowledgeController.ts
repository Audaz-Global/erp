import { Request, Response } from 'express';
import { prisma } from '../prisma';

// 1. Create a Knowledge Entry
export const createEntry = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: 'Não autorizado' });

    const data = {
      ...req.body,
      createdById: userId,
    };

    const entry = await prisma.knowledgeEntry.create({ data });
    res.status(201).json(entry);
  } catch (error) {
    console.error('Erro ao criar entrada de base de conhecimento:', error);
    res.status(500).json({ error: 'Erro ao salvar a regra/cenário' });
  }
};

// 2. Get all Knowledge Entries (Optional Category Filter)
export const getEntries = async (req: Request, res: Response) => {
  try {
    const { category, active } = req.query;
    
    const filter: any = {};
    if (category) filter.category = category as string;
    if (active !== undefined) filter.active = active === 'true';

    const entries = await prisma.knowledgeEntry.findMany({
      where: filter,
      orderBy: { priority: 'desc' }
    });
    
    res.json(entries);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar regras da base de conhecimento' });
  }
};

// 3. Get single Entry
export const getEntryById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const entry = await prisma.knowledgeEntry.findUnique({ where: { id } });
    if (!entry) return res.status(404).json({ error: 'Regra/Cenário não encontrado' });
    
    res.json(entry);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar a regra/cenário' });
  }
};

// 4. Update Entry
export const updateEntry = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const entry = await prisma.knowledgeEntry.update({
      where: { id },
      data: req.body
    });
    
    res.json(entry);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar a regra/cenário' });
  }
};

// 5. Delete Entry
export const deleteEntry = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.knowledgeEntry.delete({ where: { id } });
    
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: 'Erro ao excluir a regra/cenário' });
  }
};
