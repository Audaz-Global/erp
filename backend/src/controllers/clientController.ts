import { Request, Response } from 'express';
import { prisma } from '../prisma';
import { findClientByCnpjMatch, findClientByNameMatch, findSimilarClients } from '../services/clientMatchService';

const contactsOrder = [{ isPrimary: 'desc' as const }, { name: 'asc' as const }];

export const listClients = async (req: Request, res: Response) => {
  try {
    const clients = await prisma.client.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { quotations: true } }, contacts: { orderBy: contactsOrder } }
    });
    res.json(clients);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Erro ao listar clientes.' });
  }
};

export const getClient = async (req: Request, res: Response) => {
  try {
    const client = await prisma.client.findUnique({ where: { id: req.params.id }, include: { contacts: { orderBy: contactsOrder } } });
    if (!client) return res.status(404).json({ error: 'Cliente não encontrado.' });
    res.json(client);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Erro ao buscar cliente.' });
  }
};

// Substitui a lista de contatos do cliente pelo array enviado (o modal sempre
// manda o estado atual completo — adicionar/editar/remover é tudo resolvido
// no cliente e sincronizado aqui de uma vez). Mantém contactName/Phone/Email
// (campos legados) sincronizados com quem ficou marcado como principal, pra
// não quebrar nada que ainda lê só esses campos.
async function syncClientContacts(clientId: string, contacts: any[]) {
  const valid = (contacts || []).filter((c: any) => c && String(c.name || '').trim());
  await prisma.clientContact.deleteMany({ where: { clientId } });
  let primary: { name: string; phone: string | null; email: string | null } | null = null;
  for (const c of valid) {
    const isPrimary: boolean = Boolean(c.isPrimary) && !primary;
    const created: { name: string; phone: string | null; email: string | null } = await prisma.clientContact.create({
      data: {
        clientId,
        name: String(c.name).trim(),
        phone: c.phone ? String(c.phone).trim() : null,
        email: c.email ? String(c.email).trim() : null,
        isPrimary
      }
    });
    if (isPrimary) primary = created;
  }
  if (!primary && valid.length) {
    const first = await prisma.clientContact.findFirst({ where: { clientId }, orderBy: { createdAt: 'asc' } });
    if (first) {
      await prisma.clientContact.update({ where: { id: first.id }, data: { isPrimary: true } });
      primary = first;
    }
  }
  await prisma.client.update({
    where: { id: clientId },
    data: { contactName: primary?.name || null, contactPhone: primary?.phone || null, contactEmail: primary?.email || null }
  });
}

export const listClientContacts = async (req: Request, res: Response) => {
  try {
    const contacts = await prisma.clientContact.findMany({ where: { clientId: req.params.id }, orderBy: contactsOrder });
    res.json(contacts);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Erro ao listar contatos.' });
  }
};

// Adiciona UM contato à lista existente do cliente, sem mexer nos demais —
// usado no fluxo de extração quando o contato do e-mail é uma pessoa
// diferente da já cadastrada e o operador escolhe manter os dois.
export const createClientContact = async (req: Request, res: Response) => {
  try {
    const clientId = String(req.params.id);
    const name = String(req.body?.name || '').trim();
    if (!name) throw new Error('Informe o nome do contato.');
    const client = await prisma.client.findUnique({ where: { id: clientId } });
    if (!client) return res.status(404).json({ error: 'Cliente não encontrado.' });
    const makePrimary = Boolean(req.body?.isPrimary);
    if (makePrimary) await prisma.clientContact.updateMany({ where: { clientId }, data: { isPrimary: false } });
    const contact = await prisma.clientContact.create({
      data: {
        clientId,
        name,
        phone: req.body?.phone ? String(req.body.phone).trim() : null,
        email: req.body?.email ? String(req.body.email).trim() : null,
        isPrimary: makePrimary
      }
    });
    if (makePrimary) {
      await prisma.client.update({ where: { id: clientId }, data: { contactName: contact.name, contactPhone: contact.phone, contactEmail: contact.email } });
    }
    res.status(201).json(contact);
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Erro ao adicionar contato.' });
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
    validationNote: body.validationNote || null,
    insuranceRateOverride: body.insuranceRateOverride !== undefined && body.insuranceRateOverride !== null && body.insuranceRateOverride !== ''
      ? Number(body.insuranceRateOverride)
      : null
  };
}

export const createClient = async (req: Request, res: Response) => {
  try {
    const data = clientData(req.body);

    // Confirmação de duplicidade: na primeira tentativa (sem confirmedNew),
    // devolve os candidatos parecidos pro operador escolher em vez de criar
    // direto. Só cria de fato quando o front reenviar com confirmedNew:true
    // (usuário confirmou que é mesmo um cliente novo).
    if (!req.body?.confirmedNew) {
      const candidates = await findSimilarClients(prisma, { name: data.name, cnpj: data.cnpj });
      if (candidates.length) {
        return res.status(409).json({ needsConfirmation: true, candidates });
      }
    }

    let client = await prisma.client.create({ data });
    if (Array.isArray(req.body?.contacts)) {
      await syncClientContacts(client.id, req.body.contacts);
      client = await prisma.client.findUnique({ where: { id: client.id }, include: { contacts: { orderBy: contactsOrder } } }) as any;
    }
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
    let client = await prisma.client.update({ where: { id: req.params.id }, data });
    if (Array.isArray(req.body?.contacts)) {
      await syncClientContacts(client.id, req.body.contacts);
      client = await prisma.client.findUnique({ where: { id: client.id }, include: { contacts: { orderBy: contactsOrder } } }) as any;
    }
    res.json(client);
  } catch (error: any) {
    if (error.code === 'P2002') return res.status(409).json({ error: 'Já existe um cliente cadastrado com este CNPJ.' });
    res.status(400).json({ error: error.message || 'Erro ao atualizar cliente.' });
  }
};

// Bloqueia a exclusão de cliente com cotações vinculadas — evita que
// cotações históricas fiquem órfãs (sem cliente) por causa do onDelete
// implícito da FK. O operador precisa resolver/realocar as cotações antes.
export const deleteClient = async (req: Request, res: Response) => {
  try {
    const client = await prisma.client.findUnique({ where: { id: req.params.id }, include: { _count: { select: { quotations: true } } } });
    if (!client) return res.status(404).json({ error: 'Cliente não encontrado.' });
    if (client._count.quotations > 0) {
      return res.status(409).json({ error: `Este cliente tem ${client._count.quotations} cotação(ões) vinculada(s) e não pode ser excluído.` });
    }
    await prisma.client.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Erro ao excluir cliente.' });
  }
};
