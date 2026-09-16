import { Request, Response } from 'express';
import crypto from 'crypto';
import path from 'path';
import { prisma } from '../prisma';
import { ALLOWED_DOCUMENT_EXTENSIONS, safeDocumentName } from '../services/quotationDocumentService';

const TYPE_VALUES = new Set(['BUG', 'MELHORIA', 'DUVIDA', 'OUTRO']);
const PRIORITY_VALUES = new Set(['BAIXA', 'MEDIA', 'ALTA', 'URGENTE']);
const STATUS_VALUES = new Set(['ABERTO', 'EM_ANDAMENTO', 'RESOLVIDO', 'FECHADO']);
const RESOLVED_STATUSES = new Set(['RESOLVIDO', 'FECHADO']);

const ticketListSelect = {
  id: true, title: true, type: true, priority: true, status: true, module: true,
  createdAt: true, updatedAt: true, resolvedAt: true,
  createdBy: { select: { id: true, name: true } },
  assignedTo: { select: { id: true, name: true } },
  quotation: { select: { id: true, reference: true } },
  _count: { select: { comments: true, documents: true } }
} as const;

// Modo de teste local não passa por login real (ver middlewares/auth.ts) —
// resolve/gera o mesmo usuário de teste já usado em createQuotation, para
// que createdById/authorId sempre apontem para um User de verdade.
async function resolveUserId(req: Request): Promise<string> {
  const userId = req.user?.userId;
  if (userId && userId !== 'teste-local-id') return userId;
  let testUser = await prisma.user.findUnique({ where: { email: 'teste@audazglobal.com' } });
  if (!testUser) {
    testUser = await prisma.user.create({
      data: { name: 'Usuário de Teste Local', email: 'teste@audazglobal.com', password: 'senha-fake-nao-usada', role: 'ADMIN' }
    });
  }
  return testUser.id;
}

export async function listTickets(req: Request, res: Response) {
  const where: any = {};
  if (req.query.status) where.status = String(req.query.status);
  if (req.query.type) where.type = String(req.query.type);
  if (req.query.module) where.module = String(req.query.module);
  const tickets = await prisma.ticket.findMany({ where, select: ticketListSelect, orderBy: { createdAt: 'desc' } });
  res.json(tickets);
}

export async function getTicket(req: Request, res: Response) {
  const ticket = await prisma.ticket.findUnique({
    where: { id: req.params.id },
    include: {
      createdBy: { select: { id: true, name: true } },
      assignedTo: { select: { id: true, name: true } },
      quotation: { select: { id: true, reference: true } },
      comments: { orderBy: { createdAt: 'asc' } },
      documents: { select: { id: true, originalName: true, createdAt: true, blob: { select: { mimeType: true, size: true } } }, orderBy: { createdAt: 'asc' } }
    }
  });
  if (!ticket) return res.status(404).json({ error: 'Chamado não encontrado.' });
  res.json(ticket);
}

export async function createTicket(req: Request, res: Response) {
  try {
    const title = String(req.body?.title || '').trim();
    if (!title) throw new Error('Informe um título para o chamado.');
    const description = String(req.body?.description || '').trim();
    if (!description) throw new Error('Descreva o chamado.');
    const type = TYPE_VALUES.has(req.body?.type) ? req.body.type : 'MELHORIA';
    const priority = PRIORITY_VALUES.has(req.body?.priority) ? req.body.priority : 'MEDIA';
    const createdById = await resolveUserId(req);
    const ticket = await prisma.ticket.create({
      data: {
        title, description, type, priority, module: req.body?.module || null,
        quotationId: req.body?.quotationId || null, createdById
      },
      select: ticketListSelect
    });
    res.status(201).json(ticket);
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Erro ao abrir chamado.' });
  }
}

export async function updateTicket(req: Request, res: Response) {
  try {
    const existing = await prisma.ticket.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Chamado não encontrado.' });
    const data: any = {};
    if (req.body?.title !== undefined) data.title = String(req.body.title).trim();
    if (req.body?.description !== undefined) data.description = String(req.body.description).trim();
    if (req.body?.module !== undefined) data.module = req.body.module || null;
    if (req.body?.type !== undefined) {
      if (!TYPE_VALUES.has(req.body.type)) throw new Error('Tipo inválido.');
      data.type = req.body.type;
    }
    if (req.body?.priority !== undefined) {
      if (!PRIORITY_VALUES.has(req.body.priority)) throw new Error('Prioridade inválida.');
      data.priority = req.body.priority;
    }
    if (req.body?.assignedToId !== undefined) data.assignedToId = req.body.assignedToId || null;
    if (req.body?.status !== undefined) {
      if (!STATUS_VALUES.has(req.body.status)) throw new Error('Status inválido.');
      data.status = req.body.status;
      data.resolvedAt = RESOLVED_STATUSES.has(req.body.status) ? new Date() : null;
    }
    const ticket = await prisma.ticket.update({ where: { id: existing.id }, data, select: ticketListSelect });
    res.json(ticket);
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Erro ao atualizar chamado.' });
  }
}

export async function addTicketComment(req: Request, res: Response) {
  try {
    const ticket = await prisma.ticket.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!ticket) return res.status(404).json({ error: 'Chamado não encontrado.' });
    const body = String(req.body?.body || '').trim();
    if (!body) throw new Error('Escreva um comentário.');
    const authorId = await resolveUserId(req);
    const comment = await prisma.ticketComment.create({ data: { ticketId: ticket.id, authorId, body } });
    res.status(201).json(comment);
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Erro ao comentar.' });
  }
}

export async function uploadTicketDocuments(req: Request, res: Response) {
  try {
    const ticket = await prisma.ticket.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!ticket) return res.status(404).json({ error: 'Chamado não encontrado.' });
    const files = (req.files as Express.Multer.File[]) || [];
    if (!files.length) return res.status(400).json({ error: 'Selecione pelo menos um arquivo.' });
    const totalSize = files.reduce((sum, file) => sum + file.size, 0);
    if (totalSize > 20 * 1024 * 1024) return res.status(413).json({ error: 'O conjunto de arquivos excede 20 MB.' });
    const createdById = await resolveUserId(req);
    const saved = [];
    for (const file of files) {
      const ext = path.extname(file.originalname || '').toLowerCase();
      if (!ALLOWED_DOCUMENT_EXTENSIONS.has(ext)) throw new Error(`Formato não permitido: ${ext || 'sem extensão'}.`);
      if (!file.size) throw new Error('O arquivo está vazio.');
      const originalName = safeDocumentName(file.originalname);
      const sha256 = crypto.createHash('sha256').update(file.buffer).digest('hex');
      const blob = await prisma.documentBlob.upsert({
        where: { sha256 },
        update: {},
        create: { sha256, mimeType: file.mimetype || 'application/octet-stream', size: file.buffer.length, content: file.buffer }
      });
      saved.push(await prisma.ticketDocument.create({
        data: { ticketId: ticket.id, blobId: blob.id, originalName, createdById },
        select: { id: true, originalName: true, createdAt: true, blob: { select: { mimeType: true, size: true } } }
      }));
    }
    res.status(201).json(saved);
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Não foi possível salvar os anexos.' });
  }
}

export async function downloadTicketDocument(req: Request, res: Response) {
  const document = await prisma.ticketDocument.findFirst({
    where: { id: req.params.documentId, ticketId: req.params.id }, include: { blob: true }
  });
  if (!document) return res.status(404).json({ error: 'Anexo não encontrado.' });
  res.setHeader('Content-Type', document.blob.mimeType);
  res.setHeader('Content-Length', String(document.blob.size));
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(document.originalName)}`);
  res.send(Buffer.from(document.blob.content));
}
