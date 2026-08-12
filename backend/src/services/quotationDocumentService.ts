import crypto from 'crypto';
import path from 'path';
import { simpleParser } from 'mailparser';
import { prisma } from '../prisma';

const MsgReader = require('@kenjiuno/msgreader').default || require('@kenjiuno/msgreader');

export const ALLOWED_DOCUMENT_EXTENSIONS = new Set([
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.ppt', '.pptx',
  '.jpg', '.jpeg', '.png', '.webp', '.txt', '.eml', '.msg', '.zip'
]);

const signaturePattern = /(?:logo|signature|assinatura|facebook|instagram|linkedin|twitter|icon|spacer|pixel)/i;

export function safeDocumentName(value: string) {
  return path.basename(String(value || 'documento')).replace(/[\x00-\x1f<>:"/\\|?*]+/g, '_').slice(0, 240) || 'documento';
}

export function validateDocument(file: { originalname: string; size: number }) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (!ALLOWED_DOCUMENT_EXTENSIONS.has(ext)) throw new Error(`Formato não permitido: ${ext || 'sem extensão'}.`);
  if (!file.size) throw new Error('O arquivo está vazio.');
}

async function persistBlob(buffer: Buffer, mimeType: string) {
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  return prisma.documentBlob.upsert({
    where: { sha256 },
    update: {},
    create: { sha256, mimeType: mimeType || 'application/octet-stream', size: buffer.length, content: buffer }
  });
}

export async function persistQuotationDocument(input: {
  quotationId: string; buffer: Buffer; originalName: string; mimeType: string;
  origin: string; sourceContainerName?: string; forwardByDefault?: boolean; createdById?: string;
}) {
  const originalName = safeDocumentName(input.originalName);
  validateDocument({ originalname: originalName, size: input.buffer.length });
  const blob = await persistBlob(input.buffer, input.mimeType);
  return prisma.quotationDocument.upsert({
    where: { quotationId_blobId_originalName_origin: { quotationId: input.quotationId, blobId: blob.id, originalName, origin: input.origin } },
    update: { forwardByDefault: input.forwardByDefault !== false, sourceContainerName: input.sourceContainerName || null },
    create: {
      quotationId: input.quotationId, blobId: blob.id, originalName, origin: input.origin,
      sourceContainerName: input.sourceContainerName || null,
      forwardByDefault: input.forwardByDefault !== false, createdById: input.createdById || null
    },
    include: { blob: { select: { mimeType: true, size: true } } }
  });
}

export async function extractEmailAttachments(file: Express.Multer.File) {
  const ext = path.extname(file.originalname).toLowerCase();
  const extracted: Array<{ buffer: Buffer; originalName: string; mimeType: string }> = [];
  if (ext === '.eml') {
    const parsed = await simpleParser(file.buffer);
    for (const item of parsed.attachments || []) {
      const name = safeDocumentName(item.filename || 'anexo');
      const content = Buffer.from(item.content);
      if (item.related || signaturePattern.test(name) || content.length < 512) continue;
      if (!ALLOWED_DOCUMENT_EXTENSIONS.has(path.extname(name).toLowerCase())) continue;
      extracted.push({ buffer: content, originalName: name, mimeType: item.contentType || 'application/octet-stream' });
    }
  } else if (ext === '.msg') {
    const reader = new MsgReader(file.buffer);
    const data = reader.getFileData();
    for (const item of data.attachments || []) {
      const attachment = reader.getAttachment(item);
      const name = safeDocumentName(attachment.fileName || item.fileName || 'anexo');
      const content = Buffer.from(attachment.content || []);
      if (signaturePattern.test(name) || content.length < 512) continue;
      if (!ALLOWED_DOCUMENT_EXTENSIONS.has(path.extname(name).toLowerCase())) continue;
      extracted.push({ buffer: content, originalName: name, mimeType: item.mimeType || 'application/octet-stream' });
    }
  }
  return extracted;
}

export const documentPublicSelect = {
  id: true, originalName: true, origin: true, sourceContainerName: true,
  forwardByDefault: true, createdAt: true,
  blob: { select: { mimeType: true, size: true } }
} as const;
