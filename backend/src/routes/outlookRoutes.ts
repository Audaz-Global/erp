import { Router, Request, Response } from 'express';
import { prisma } from '../prisma';
import { replyOutlookEmail, sendOutlookEmail, searchEmails } from '../services/outlookService';
import { marked } from 'marked';
import { recordQuotationEvent } from '../services/quotationHistoryService';
import { normalizePartnerType } from '../services/agentResponseService';

const router = Router();

// Configuração do marked para quebrar linhas normalmente
marked.setOptions({ breaks: true });

async function recordSuccessfulDispatch(input: {
  quotationId: string; recipientType: string; recipientEmail: string; partnerName?: string | null;
  subject: string; conversationId: string | null; documents: Array<{ id: string; originalName: string }>;
}) {
  const sentAt = new Date();
  return prisma.$transaction(async tx => {
    let cycle = await tx.quotationRequestCycle.findFirst({
      where: { quotationId: input.quotationId, recipientType: input.recipientType, partnerEmail: { equals: input.recipientEmail, mode: 'insensitive' }, status: { in: ['OPEN', 'RESPONDED'] } },
      orderBy: { sentAt: 'desc' }
    });
    const isFollowUp = Boolean(cycle);
    if (cycle) cycle = await tx.quotationRequestCycle.update({ where: { id: cycle.id }, data: {
      followUpCount: { increment: 1 }, conversationId: cycle.conversationId || input.conversationId
    } });
    else cycle = await tx.quotationRequestCycle.create({ data: {
      quotationId: input.quotationId, recipientType: input.recipientType, partnerEmail: input.recipientEmail,
      partnerName: input.partnerName || null, conversationId: input.conversationId, sentAt
    } });
    const dispatch = await tx.quotationEmailDispatch.create({ data: {
      quotationId: input.quotationId, recipientType: input.recipientType, recipientEmail: input.recipientEmail,
      subject: input.subject, conversationId: input.conversationId,
      attachmentIds: JSON.stringify(input.documents.map(item => item.id)),
      attachmentNames: JSON.stringify(input.documents.map(item => item.originalName)), status: 'SENT', requestCycleId: cycle.id
    } });
    await recordQuotationEvent(tx, {
      quotationId: input.quotationId, type: isFollowUp ? 'FOLLOW_UP_SENT' : 'EMAIL_SENT', eventAt: sentAt,
      actorType: 'SYSTEM', channel: 'OUTLOOK', partnerEmail: input.recipientEmail, partnerName: input.partnerName,
      newStatus: 'AGUARDANDO_AGENTE', sourceType: 'EMAIL_DISPATCH', sourceId: dispatch.id,
      metadata: { recipientType: input.recipientType, attachmentNames: input.documents.map(item => item.originalName), requestCycleId: cycle.id }
    });
    return { dispatch, cycle };
  });
}

// Rota para disparar o e-mail de cotação via Outlook
router.post('/send-draft', async (req: Request, res: Response) => {
  let auditQuotationId = String(req.body?.quotationId || '');
  try {
    const { quotationId, htmlBody, subject, agentEmail, agentName, partnerType, ccEmail, needsTransport, truckerEmail, truckerName, truckerCcEmail, attachmentIds = [], truckerAttachmentIds = [] } = req.body;
    const normalizedPartnerType = normalizePartnerType(partnerType);

    if (!quotationId) return res.status(400).json({ error: 'quotationId é obrigatório' });
    if (!agentEmail) return res.status(400).json({ error: 'agentEmail é obrigatório' });

    const quotation = await prisma.quotation.findUnique({ where: { id: quotationId } });
    if (!quotation) return res.status(404).json({ error: 'Cotação não encontrada' });

    let targetQuotationId = quotation.id;
    let effectiveAttachmentIds: string[] = Array.isArray(attachmentIds) ? attachmentIds : [];
    let effectiveTruckerAttachmentIds: string[] = Array.isArray(truckerAttachmentIds) ? truckerAttachmentIds : [];
    let baseReference = quotation.reference || quotation.id.substring(0,6).toUpperCase();
    let targetReference = baseReference;
    let mailSubject = subject || `Solicitação de Cotação de Frete - REF: ${targetReference}`;
    let rawMarkdown = htmlBody || quotation.draftEmail || '';

    // Lógica de Múltiplos Agentes (Duplicação)
    // Se a cotação já tem um Agente definido e não é o mesmo
    if (quotation.agentEmail && quotation.agentEmail !== agentEmail) {
      // Contar quantas cópias existem
      const cloneCount = await prisma.quotation.count({
        where: { reference: { startsWith: baseReference + '-' } }
      });
      
      targetReference = `${baseReference}-${cloneCount + 2}`;

      // Substitui a referência antiga pela nova no Assunto e Corpo
      mailSubject = mailSubject.replace(baseReference, targetReference);
      rawMarkdown = rawMarkdown.replace(baseReference, targetReference);

      // Duplicar a cotação no banco
      const { id, createdAt, updatedAt, ...quotationData } = quotation;
      const clone = await prisma.quotation.create({
        data: {
          ...quotationData,
          reference: targetReference,
          agentEmail: agentEmail,
          agentName: agentName,
          partnerType: normalizedPartnerType,
          status: 'AGUARDANDO_AGENTE',
          draftEmail: rawMarkdown,
          sentAt: new Date()
        }
      });

      targetQuotationId = clone.id;
      auditQuotationId = clone.id;
      await recordQuotationEvent(prisma, {
        quotationId: clone.id, type: 'QUOTATION_CLONED', actorType: 'SYSTEM',
        previousStatus: quotation.status, newStatus: 'AGUARDANDO_AGENTE',
        partnerEmail: agentEmail, partnerName: agentName, metadata: { sourceQuotationId: quotation.id }
      });

      const sourceDocuments = await prisma.quotationDocument.findMany({ where: { quotationId: quotation.id } });
      if (sourceDocuments.length) {
        await prisma.quotationDocument.createMany({ data: sourceDocuments.map(document => ({
          quotationId: clone.id, blobId: document.blobId, originalName: document.originalName, origin: document.origin,
          sourceContainerName: document.sourceContainerName, forwardByDefault: document.forwardByDefault, createdById: document.createdById
        })), skipDuplicates: true });
        const clonedDocuments = await prisma.quotationDocument.findMany({ where: { quotationId: clone.id } });
        const remap = (ids: string[]) => ids.map(id => {
          const source = sourceDocuments.find(document => document.id === id);
          return source ? clonedDocuments.find(document => document.blobId === source.blobId && document.originalName === source.originalName)?.id : undefined;
        }).filter((id): id is string => Boolean(id));
        effectiveAttachmentIds = remap(effectiveAttachmentIds);
        effectiveTruckerAttachmentIds = remap(effectiveTruckerAttachmentIds);
      }
    }

    // Podemos adicionar uma folha de estilos básica para que o e-mail não fique feio no Outlook
    const emailStyle = `
      <style>
        body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 14px; color: #333; line-height: 1.6; }
        ul { margin-top: 5px; margin-bottom: 5px; padding-left: 20px; }
        strong { font-weight: 600; color: #000; }
        p { margin: 0 0 10px 0; }
      </style>
    `;

    // Processa o markdown e transforma em string HTML
    const renderedHtml = await marked.parse(rawMarkdown);
    const finalHtmlEmail = `<html><head>${emailStyle}</head><body>${renderedHtml}</body></html>`;

    // Envia usando a Microsoft Graph API (draft+send para capturar conversationId)
    const selectedDocuments = await prisma.quotationDocument.findMany({
      where: { quotationId: targetQuotationId, id: { in: effectiveAttachmentIds } }, include: { blob: true }
    });
    const outlookAttachments = selectedDocuments.map(document => ({
      name: document.originalName, contentType: document.blob.mimeType, content: Buffer.from(document.blob.content)
    }));
    const { conversationId } = await sendOutlookEmail(agentEmail, mailSubject, finalHtmlEmail, ccEmail, outlookAttachments);
    await recordSuccessfulDispatch({ quotationId: targetQuotationId, recipientType: normalizedPartnerType, recipientEmail: agentEmail,
      partnerName: agentName, subject: mailSubject, conversationId, documents: selectedDocuments });

    // Se houver necessidade de transporte terrestre e o e-mail da transportadora for fornecido
    let truckerConversationId = null;
    if (needsTransport && truckerEmail) {
      try {
        const truckerSubject = `Solicitação de Coleta/Entrega Rodoviária - REF: ${targetReference}`;
        const truckerMarkdown = quotation.truckerDraftEmail || '';
        const renderedTruckerHtml = await marked.parse(truckerMarkdown);
        const finalTruckerHtmlEmail = `<html><head>${emailStyle}</head><body>${renderedTruckerHtml}</body></html>`;
        
        const selectedTruckerDocuments = await prisma.quotationDocument.findMany({
          where: { quotationId: targetQuotationId, id: { in: effectiveTruckerAttachmentIds } }, include: { blob: true }
        });
        const truckerRes = await sendOutlookEmail(truckerEmail, truckerSubject, finalTruckerHtmlEmail, truckerCcEmail, selectedTruckerDocuments.map(document => ({
          name: document.originalName, contentType: document.blob.mimeType, content: Buffer.from(document.blob.content)
        })));
        truckerConversationId = truckerRes.conversationId;
        await recordSuccessfulDispatch({ quotationId: targetQuotationId, recipientType: 'TRUCKER', recipientEmail: truckerEmail,
          partnerName: truckerName, subject: truckerSubject, conversationId: truckerConversationId, documents: selectedTruckerDocuments });
        console.log(`[Outlook] E-mail de transportadora enviado para ${truckerEmail} | REF: ${targetReference} | ConversationId: ${truckerConversationId || 'N/A'}`);
      } catch (tErr: any) {
        console.error('Erro ao enviar e-mail da transportadora pelo Outlook:', tErr);
      }
    }

    // Atualiza status no banco para AGUARDANDO_AGENTE e salva o agentEmail + conversationId + dados da transportadora
    const updated = await prisma.quotation.update({
      where: { id: targetQuotationId },
      data: { 
        status: 'AGUARDANDO_AGENTE',
        agentEmail: agentEmail,
        agentName: agentName,
        partnerType: normalizedPartnerType,
        draftEmail: rawMarkdown,
        sentAt: new Date(),
        sentEmailConversationId: conversationId || null,
        ...(needsTransport && truckerEmail ? {
          truckerEmail,
          truckerName,
          truckerSentAt: new Date()
        } : {})
      }
    });

    console.log(`[Outlook] E-mail enviado para ${agentEmail} | REF: ${targetReference} | ConversationId: ${conversationId || 'N/A'}`);
    res.json({ success: true, quotation: updated });
  } catch (error: any) {
    console.error('Erro ao disparar Outlook:', error);
    const quotationId = auditQuotationId;
    const recipientEmail = String(req.body?.agentEmail || '');
    if (quotationId && recipientEmail) {
      await prisma.quotationEmailDispatch.create({ data: {
        quotationId, recipientType: 'PARTNER', recipientEmail, subject: req.body?.subject || null,
        attachmentIds: JSON.stringify(Array.isArray(req.body?.attachmentIds) ? req.body.attachmentIds : []),
        status: 'FAILED', errorMessage: String(error.message || 'Falha no envio').slice(0, 1000)
      } }).catch(() => undefined);
      await recordQuotationEvent(prisma, {
        quotationId, type: 'EMAIL_SEND_FAILED', actorType: 'SYSTEM', channel: 'OUTLOOK', partnerEmail: recipientEmail,
        metadata: { error: String(error.message || 'Falha no envio').slice(0, 1000) }
      }).catch(() => undefined);
    }
    res.status(500).json({ error: error.message });
  }
});

router.post('/reply/:responseId', async (req: Request, res: Response) => {
  try {
    const responseVersion = await prisma.agentResponseVersion.findUnique({ where: { id: req.params.responseId } });
    if (!responseVersion) return res.status(404).json({ error: 'Resposta do parceiro não encontrada.' });
    const htmlBody = String(req.body?.htmlBody || '').trim();
    if (!htmlBody) return res.status(400).json({ error: 'Escreva uma mensagem antes de responder.' });
    const attachmentIds = Array.isArray(req.body?.attachmentIds) ? req.body.attachmentIds : [];
    const documents = await prisma.quotationDocument.findMany({
      where: { quotationId: responseVersion.quotationId, id: { in: attachmentIds } }, include: { blob: true }
    });
    const renderedHtml = await marked.parse(htmlBody);
    const result = await replyOutlookEmail(responseVersion.messageId, String(renderedHtml), documents.map(document => ({
      name: document.originalName, contentType: document.blob.mimeType, content: Buffer.from(document.blob.content)
    })));
    await prisma.quotationEmailDispatch.create({ data: {
      quotationId: responseVersion.quotationId, recipientType: 'PARTNER_REPLY', recipientEmail: responseVersion.senderEmail || '',
      subject: responseVersion.subject ? `RE: ${responseVersion.subject}` : 'Resposta ao parceiro', conversationId: result.conversationId,
      attachmentIds: JSON.stringify(documents.map(item => item.id)), attachmentNames: JSON.stringify(documents.map(item => item.originalName)),
      status: 'SENT', requestCycleId: responseVersion.requestCycleId
    } });
    await recordQuotationEvent(prisma, {
      quotationId: responseVersion.quotationId, type: 'EMAIL_REPLY_SENT', actorType: 'USER', channel: 'OUTLOOK',
      partnerEmail: responseVersion.senderEmail, sourceType: 'AGENT_RESPONSE', sourceId: responseVersion.id,
      metadata: { attachmentNames: documents.map(item => item.originalName) }
    });
    res.json({ success: true });
  } catch (error: any) {
    console.error('Erro ao responder e-mail pelo Outlook:', error);
    res.status(500).json({ error: error.message || 'Falha ao responder o e-mail.' });
  }
});

/**
 * Busca manual de e-mails na caixa do Outlook.
 * Útil para encontrar respostas de agentes que escaparam do watcher automático.
 * GET /api/outlook/search?q=4500697368&from=agente@email.com
 */
router.get('/search', async (req: Request, res: Response) => {
  try {
    const { q, from } = req.query;

    if (!q && !from) {
      return res.status(400).json({ error: 'Informe ao menos um parâmetro: q (termo de busca) ou from (e-mail do remetente)' });
    }

    // Monta a query KQL para o MS Graph $search
    let searchQuery = '';
    if (q && from) {
      searchQuery = `${q} from:${from}`;
    } else if (from) {
      searchQuery = `from:${from}`;
    } else {
      searchQuery = String(q);
    }

    const emails = await searchEmails(searchQuery);

    // Retorna dados resumidos (sem o body completo para não poluir)
    const results = emails.map((email: any) => ({
      id: email.id,
      subject: email.subject,
      from: email.from?.emailAddress?.address,
      fromName: email.from?.emailAddress?.name,
      receivedDateTime: email.receivedDateTime,
      bodyPreview: email.bodyPreview,
      conversationId: email.conversationId
    }));

    res.json({ count: results.length, results });
  } catch (error: any) {
    console.error('Erro na busca de e-mails:', error);
    res.status(500).json({ error: error.message });
  }
});

/** Histórico auditável das respostas processadas para uma cotação. */
router.get('/responses/:quotationId', async (req: Request, res: Response) => {
  try {
    const responses = await prisma.agentResponseVersion.findMany({
      where: { quotationId: req.params.quotationId },
      orderBy: [{ receivedAt: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true, messageId: true, subject: true, senderEmail: true, receivedAt: true,
        matchLayer: true, latestText: true, signature: true, attachmentNames: true,
        extractedData: true, confidence: true, processingStatus: true, errorMessage: true,
        attempts: true, processedAt: true
      }
    });
    res.json(responses);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Erro ao consultar histórico de retornos.' });
  }
});

export default router;
