import { Request, Response } from 'express';
import { prisma } from '../prisma';
import { isAtlantisConfigured, searchAtlantisParty } from '../services/atlantisService';

export const searchAtlantisCustomer = async (req: Request, res: Response) => {
  try {
    if (!isAtlantisConfigured()) return res.status(503).json({ error: 'Integração com o Atlantis não está configurada.' });
    const query = String(req.query.q || '');
    const taxId = req.query.taxId ? String(req.query.taxId) : undefined;
    const candidates = await searchAtlantisParty('CUSTOMER', query, taxId);
    res.json({ candidates });
  } catch (error: any) {
    console.error('Erro ao consultar cliente no Atlantis:', error);
    res.status(500).json({ error: 'Não foi possível consultar o Atlantis no momento.' });
  }
};

export const searchAtlantisAgent = async (req: Request, res: Response) => {
  try {
    if (!isAtlantisConfigured()) return res.status(503).json({ error: 'Integração com o Atlantis não está configurada.' });
    const query = String(req.query.q || '');
    const taxId = req.query.taxId ? String(req.query.taxId) : undefined;
    const candidates = await searchAtlantisParty('AGENT', query, taxId);
    res.json({ candidates });
  } catch (error: any) {
    console.error('Erro ao consultar parceiro/agente no Atlantis:', error);
    res.status(500).json({ error: 'Não foi possível consultar o Atlantis no momento.' });
  }
};

// Lista parceiros/agentes marcados como pendentes de validação (a sincronização
// com o Atlantis encontrou nomes parecidos e não decidiu sozinha). Pendências de
// clientes são revisadas direto na tela de Clientes, que já mostra o status.
export const listPendingValidation = async (_req: Request, res: Response) => {
  try {
    const agents = await prisma.agent.findMany({ where: { needsValidation: true }, orderBy: { updatedAt: 'desc' } });
    res.json({ agents });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Erro ao listar pendências de validação.' });
  }
};

// Resolve manualmente um parceiro/agente pendente, em endpoint próprio (em vez de reusar
// o update genérico de Agent, que sempre recalcula os papéis/type a partir do
// payload — reusar aqui apagaria os papéis já cadastrados do parceiro).
export const resolveAgentValidation = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { atlantisId, phone, website, address } = req.body || {};
    const agent = await prisma.agent.update({
      where: { id },
      data: {
        needsValidation: false,
        validationNote: null,
        atlantisId: atlantisId || null,
        phone: phone || undefined,
        website: website || undefined,
        address: address || undefined
      }
    });
    res.json(agent);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Erro ao resolver pendência de parceiro.' });
  }
};
