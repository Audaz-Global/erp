import { Request, Response } from 'express';
import { getIncotermTree, updateIncotermTree, IncotermTreePayload } from '../services/incotermTreeService';

export const getTree = async (req: Request, res: Response) => {
  try {
    const { incoterm, direction, modal } = req.params;
    if (!incoterm || !direction || !modal) {
      return res.status(400).json({ error: 'Parâmetros incoterm, direction e modal são obrigatórios.' });
    }

    const tree = await getIncotermTree(incoterm, direction, modal);
    res.json(tree);
  } catch (error) {
    console.error('Erro ao buscar árvore de Incoterm:', error);
    res.status(500).json({ error: 'Erro interno ao buscar árvore de Incoterm.' });
  }
};

export const updateTree = async (req: Request, res: Response) => {
  try {
    const { incoterm, direction, modal } = req.params;
    if (!incoterm || !direction || !modal) {
      return res.status(400).json({ error: 'Parâmetros incoterm, direction e modal são obrigatórios.' });
    }

    const payload: IncotermTreePayload = req.body;
    
    // Assegura que o payload bata com a rota para evitar inconsistências
    payload.incoterm = incoterm;
    payload.direction = direction;
    payload.modal = modal;

    const result = await updateIncotermTree(payload);
    res.json(result);
  } catch (error: any) {
    console.error('Erro ao atualizar árvore de Incoterm:', error);
    if (error.message && error.message.includes('compatível com o modal')) {
       return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'Erro interno ao atualizar árvore de Incoterm.' });
  }
};
