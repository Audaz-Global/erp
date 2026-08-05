import { Request, Response } from 'express';
import { prisma } from '../prisma';

const SINGLETON_ID = 'default';
const DEFAULT_SUBJECT = '{quotationCode} | {direction} {modal} - {incoterm} | {origin} x {destination} | {client} | {clientReference}';

export const getAgentDraftEmailSettings = async (_req: Request, res: Response) => {
  try {
    const settings = await prisma.agentDraftEmailSettings.upsert({
      where: { id: SINGLETON_ID },
      update: {},
      create: { id: SINGLETON_ID, subjectTemplate: DEFAULT_SUBJECT }
    });
    res.json(settings);
  } catch (error: any) {
    console.error('Erro ao buscar configurações de e-mail:', error);
    res.status(500).json({ error: 'Erro ao buscar configurações de e-mail.' });
  }
};

export const updateAgentDraftEmailSettings = async (req: Request, res: Response) => {
  try {
    const { subjectTemplate } = req.body;
    const settings = await prisma.agentDraftEmailSettings.upsert({
      where: { id: SINGLETON_ID },
      update: { subjectTemplate },
      create: { id: SINGLETON_ID, subjectTemplate: subjectTemplate || DEFAULT_SUBJECT }
    });
    res.json(settings);
  } catch (error: any) {
    console.error('Erro ao atualizar configurações de e-mail:', error);
    res.status(500).json({ error: 'Erro ao atualizar configurações de e-mail.' });
  }
};
