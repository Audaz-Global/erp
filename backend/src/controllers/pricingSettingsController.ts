import { Request, Response } from 'express';
import { prisma } from '../prisma';
import { getPtaxRate } from '../services/ptaxService';

const SINGLETON_ID = 'default';

export const getPricingSettings = async (_req: Request, res: Response) => {
  try {
    const settings = await prisma.pricingSettings.upsert({
      where: { id: SINGLETON_ID },
      update: {},
      create: { id: SINGLETON_ID }
    });
    const currentPtaxRate = await getPtaxRate(settings.ptaxMode === 'D0_OPEN' ? 'D0_OPEN' : 'D1_CLOSE');
    res.json({ ...settings, currentPtaxRate });
  } catch (error: any) {
    console.error('Erro ao buscar configurações de câmbio/armazenagem:', error);
    res.status(500).json({ error: 'Erro ao buscar configurações de câmbio/armazenagem.' });
  }
};

export const updatePricingSettings = async (req: Request, res: Response) => {
  try {
    const { ptaxMode, minLclStorageBrl } = req.body;
    const settings = await prisma.pricingSettings.upsert({
      where: { id: SINGLETON_ID },
      update: {
        ...(ptaxMode !== undefined && { ptaxMode }),
        ...(minLclStorageBrl !== undefined && { minLclStorageBrl: Number(minLclStorageBrl) })
      },
      create: {
        id: SINGLETON_ID,
        ...(ptaxMode !== undefined && { ptaxMode }),
        ...(minLclStorageBrl !== undefined && { minLclStorageBrl: Number(minLclStorageBrl) })
      }
    });
    res.json(settings);
  } catch (error: any) {
    console.error('Erro ao atualizar configurações de câmbio/armazenagem:', error);
    res.status(500).json({ error: 'Erro ao atualizar configurações de câmbio/armazenagem.' });
  }
};
