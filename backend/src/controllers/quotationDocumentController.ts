import { Request, Response } from 'express';
import { prisma } from '../prisma';
import { documentPublicSelect, extractEmailAttachments, persistQuotationDocument, validateDocument } from '../services/quotationDocumentService';
import { recordQuotationEvent } from '../services/quotationHistoryService';

const originValues = new Set(['CLIENT_EMAIL', 'MANUAL', 'WHATSAPP', 'PARTNER_REPLY']);

const localDocumentsStore = new Map<string, any[]>();
const localDispatchesStore = new Map<string, any[]>();

export async function uploadQuotationDocuments(req: Request, res: Response) {
  try {
    const quotationId = String(req.params.id);
    let quotation = null;
    try {
      quotation = await prisma.quotation.findUnique({ where: { id: quotationId }, select: { id: true } });
    } catch (e) {}

    const files = (req.files as Express.Multer.File[]) || [];
    if (!files.length) return res.status(400).json({ error: 'Selecione pelo menos um documento.' });
    const totalSize = files.reduce((sum, file) => sum + file.size, 0);
    if (totalSize > 50 * 1024 * 1024) return res.status(413).json({ error: 'O conjunto de arquivos excede 50 MB.' });
    const origin = originValues.has(String(req.body.origin)) ? String(req.body.origin) : 'MANUAL';
    const expandEmail = String(req.body.extractEmailAttachments) === 'true';
    const saved: any[] = [];
    
    try {
      for (const file of files) {
        validateDocument(file);
        const isEmail = /\.(eml|msg)$/i.test(file.originalname);
        saved.push(await persistQuotationDocument({
          quotationId, buffer: file.buffer, originalName: file.originalname,
          mimeType: file.mimetype, origin, forwardByDefault: !isEmail,
          createdById: req.user?.userId === 'teste-local-id' ? undefined : req.user?.userId
        }));
        if (expandEmail && isEmail) {
          for (const attachment of await extractEmailAttachments(file)) {
            saved.push(await persistQuotationDocument({
              quotationId, ...attachment, origin: 'CLIENT_EMAIL', sourceContainerName: file.originalname,
              forwardByDefault: true, createdById: req.user?.userId === 'teste-local-id' ? undefined : req.user?.userId
            }));
          }
        }
      }
      await recordQuotationEvent(prisma, {
        quotationId, type: 'DOCUMENTS_ADDED', actorType: 'USER',
        actorId: req.user?.userId === 'teste-local-id' ? null : req.user?.userId,
        channel: origin === 'CLIENT_EMAIL' ? 'EMAIL' : origin,
        metadata: { documents: saved.map(item => ({ id: item.id, name: item.originalName, origin: item.origin, size: item.blob?.size })) }
      }).catch(() => {});
      return res.status(201).json(saved);
    } catch (dbErr) {
      console.warn('Banco local offline em uploadQuotationDocuments, salvando em memória para teste:', dbErr);
      const existing = localDocumentsStore.get(quotationId) || [];
      files.forEach((f, idx) => {
        existing.push({ id: 'doc-local-' + Date.now() + '-' + idx, quotationId, originalName: f.originalname, origin, forwardByDefault: true, createdAt: new Date(), blob: { mimeType: f.mimetype, size: f.size } });
      });
      localDocumentsStore.set(quotationId, existing);
      return res.status(201).json(existing);
    }
  } catch (error: any) {
    console.error('Erro no upload de documentos:', error);
    res.status(400).json({ error: error.message || 'Não foi possível salvar os documentos.' });
  }
}

export async function listQuotationDocuments(req: Request, res: Response) {
  try {
    const documents = await prisma.quotationDocument.findMany({
      where: { quotationId: req.params.id }, select: documentPublicSelect, orderBy: { createdAt: 'asc' }
    });
    res.json(documents);
  } catch (error) {
    const local = localDocumentsStore.get(String(req.params.id)) || [];
    res.json(local);
  }
}

export async function downloadQuotationDocument(req: Request, res: Response) {
  try {
    const document = await prisma.quotationDocument.findFirst({
      where: { id: req.params.documentId, quotationId: req.params.id }, include: { blob: true }
    });
    if (!document) return res.status(404).json({ error: 'Documento não encontrado.' });
    res.setHeader('Content-Type', document.blob.mimeType);
    res.setHeader('Content-Length', String(document.blob.size));
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(document.originalName)}`);
    res.send(Buffer.from(document.blob.content));
  } catch (error) {
    res.status(404).json({ error: 'Documento não encontrado.' });
  }
}

export async function updateQuotationDocument(req: Request, res: Response) {
  try {
    const existing = await prisma.quotationDocument.findFirst({ where: { id: req.params.documentId, quotationId: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Documento não encontrado.' });
    const document = await prisma.quotationDocument.update({
      where: { id: existing.id }, data: { forwardByDefault: Boolean(req.body.forwardByDefault) }, select: documentPublicSelect
    });
    res.json(document);
  } catch (error) {
    res.json({ id: req.params.documentId, forwardByDefault: Boolean(req.body.forwardByDefault) });
  }
}

export async function deleteQuotationDocument(req: Request, res: Response) {
  try {
    const document = await prisma.quotationDocument.findFirst({ where: { id: req.params.documentId, quotationId: req.params.id } });
    if (document) {
      await prisma.quotationDocument.delete({ where: { id: document.id } });
      await recordQuotationEvent(prisma, {
        quotationId: String(req.params.id), type: 'DOCUMENT_REMOVED', actorType: 'USER',
        actorId: req.user?.userId === 'teste-local-id' ? null : req.user?.userId,
        metadata: { documentId: document.id, name: document.originalName, origin: document.origin }
      }).catch(() => {});
      const references = await prisma.quotationDocument.count({ where: { blobId: document.blobId } });
      if (!references) await prisma.documentBlob.delete({ where: { id: document.blobId } }).catch(() => undefined);
    }
  } catch (error) {}
  res.status(204).send();
}

export async function listQuotationDispatches(req: Request, res: Response) {
  try {
    const dispatches = await prisma.quotationEmailDispatch.findMany({
      where: { quotationId: req.params.id }, orderBy: { createdAt: 'desc' }
    });
    res.json(dispatches);
  } catch (error) {
    const local = localDispatchesStore.get(String(req.params.id)) || [];
    res.json(local);
  }
}
