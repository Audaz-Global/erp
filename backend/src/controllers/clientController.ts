import { Request, Response } from 'express';
import { prisma } from '../prisma';
import { findClientByCnpjMatch, findClientByNameMatch } from '../services/clientMatchService';

export const listClients = async (req: Request, res: Response) => {
  try {
    const clients = await prisma.client.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { quotations: true } } }
    });
    res.json(clients);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Erro ao listar clientes.' });
  }
};

export const getClient = async (req: Request, res: Response) => {
  try {
    const client = await prisma.client.findUnique({ where: { id: req.params.id } });
    if (!client) return res.status(404).json({ error: 'Cliente não encontrado.' });
    res.json(client);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Erro ao buscar cliente.' });
  }
};

function clientData(body: any) {
  const name = String(body?.name || '').trim();
  if (!name) throw new Error('Informe o nome do cliente.');
  return {
    name,
    cnpj: body.cnpj ? String(body.cnpj).trim() : null,
    contactName: body.contactName ? String(body.contactName).trim() : null,
    contactEmail: body.contactEmail ? String(body.contactEmail).trim() : null,
    contactPhone: body.contactPhone ? String(body.contactPhone).trim() : null,
    productSegment: body.productSegment || null,
    atlantisId: body.atlantisId || null,
    needsValidation: Boolean(body.needsValidation),
    validationNote: body.validationNote || null
  };
}

export const createClient = async (req: Request, res: Response) => {
  try {
    const data = clientData(req.body);
    // Sem CNPJ informado não há como confirmar que são empresas distintas
    // (ex: filiais), então aqui também barramos por nome parecido.
    const existing = (await findClientByCnpjMatch(prisma, data.cnpj)) || (!data.cnpj ? await findClientByNameMatch(prisma, data.name) : null);
    if (existing) return res.status(409).json({ error: `Já existe um cliente cadastrado parecido: ${existing.name}.` });
    const client = await prisma.client.create({ data });
    res.status(201).json(client);
  } catch (error: any) {
    if (error.code === 'P2002') return res.status(409).json({ error: 'Já existe um cliente cadastrado com este CNPJ.' });
    res.status(400).json({ error: error.message || 'Erro ao cadastrar cliente.' });
  }
};

export const updateClient = async (req: Request, res: Response) => {
  try {
    const data = clientData(req.body);
    const existing = (await findClientByCnpjMatch(prisma, data.cnpj)) || (!data.cnpj ? await findClientByNameMatch(prisma, data.name) : null);
    if (existing && existing.id !== req.params.id) return res.status(409).json({ error: `Já existe um cliente cadastrado parecido: ${existing.name}.` });
    const client = await prisma.client.update({ where: { id: req.params.id }, data });
    res.json(client);
  } catch (error: any) {
    if (error.code === 'P2002') return res.status(409).json({ error: 'Já existe um cliente cadastrado com este CNPJ.' });
    res.status(400).json({ error: error.message || 'Erro ao atualizar cliente.' });
  }
};
