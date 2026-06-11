import { Request, Response } from 'express';
import { fetchClientsFromSmartcomex, fetchQuotationsFromSmartcomex } from '../services/smartcomexService';

export const getClients = async (req: Request, res: Response) => {
  try {
    const clients = await fetchClientsFromSmartcomex();
    res.json(clients);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const getQuotations = async (req: Request, res: Response) => {
  try {
    const quotations = await fetchQuotationsFromSmartcomex();
    res.json(quotations);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};
