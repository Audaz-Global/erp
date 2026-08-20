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

// Lista clientes e parceiros/agentes marcados como pendentes de validação
// (a sincronização com o Atlantis encontrou nomes parecidos e não decidiu sozinha).
export const listPendingValidation = async (_req: Request, res: Response) => {
  try {
    const [clients, agents] = await Promise.all([
      prisma.client.findMany({ where: { needsValidation: true }, orderBy: { updatedAt: 'desc' } }),
      prisma.agent.findMany({ where: { needsValidation: true }, orderBy: { updatedAt: 'desc' } })
    ]);
    res.json({ clients, agents });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Erro ao listar pendências de validação.' });
  }
};

// Resolve manualmente um cliente pendente: confirma o vínculo com um registro
// do Atlantis (opcionalmente atualizando os dados) ou apenas remove a flag.
export const resolveClientValidation = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { atlantisId, cnpj, contactName, contactEmail, contactPhone } = req.body || {};
    const client = await prisma.client.update({
      where: { id },
      data: {
        needsValidation: false,
        validationNote: null,
        atlantisId: atlantisId || null,
        cnpj: cnpj || undefined,
        contactName: contactName || undefined,
        contactEmail: contactEmail || undefined,
        contactPhone: contactPhone || undefined
      }
    });
    res.json(client);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Erro ao resolver pendência de cliente.' });
  }
};

// Mesma ideia para parceiros/agentes, mas em endpoint próprio (em vez de reusar
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
