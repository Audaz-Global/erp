import { Router, Request, Response } from 'express';
import { prisma } from '../prisma';
import { replyOutlookEmail, sendOutlookEmail, searchEmails } from '../services/outlookService';
import { marked } from 'marked';
import { recordQuotationEvent } from '../services/quotationHistoryService';
import { normalizePartnerType } from '../services/agentResponseService';
import { mapWithConcurrency, normalizeBatchRecipients, splitRecipientEmails } from '../utils/outlookBatch';
import { appendProfessionalSignature, loadProfessionalSignature } from '../services/professionalSignatureService';
import { personalizeGreeting } from '../utils/draftGreeting';

const router = Router();
const activeBatchDispatches = new Set<string>();

// Configuração do marked para quebrar linhas normalmente
marked.setOptions({ breaks: true });

async function recordSuccessfulDispatch(input: {
  quotationId: string; recipientType: string; recipientEmail: string; partnerName?: string | null; ccEmails?: string | null;
  subject: string; conversationId: string | null; documents: Array<{ id: string; originalName: string }>;
  professional: { id:string; name:string; signatureVersion:number };
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
      ccEmails: input.ccEmails || null,
      subject: input.subject, conversationId: input.conversationId,
      attachmentIds: JSON.stringify(input.documents.map(item => item.id)),
      attachmentNames: JSON.stringify(input.documents.map(item => item.originalName)), status: 'SENT', requestCycleId: cycle.id,
      professionalId:input.professional.id, professionalName:input.professional.name, signatureVersion:input.professional.signatureVersion
    } });
    await recordQuotationEvent(tx, {
      quotationId: input.quotationId, type: isFollowUp ? 'FOLLOW_UP_SENT' : 'EMAIL_SENT', eventAt: sentAt,
      actorType: 'SYSTEM', channel: 'OUTLOOK', partnerEmail: input.recipientEmail, partnerName: input.partnerName,
      newStatus: 'AGUARDANDO_PARCEIRO', sourceType: 'EMAIL_DISPATCH', sourceId: dispatch.id,
      metadata: { recipientType: input.recipientType, ccEmails: input.ccEmails || null, attachmentNames: input.documents.map(item => item.originalName), requestCycleId: cycle.id,
        professionalId:input.professional.id, professionalName:input.professional.name, signatureVersion:input.professional.signatureVersion }
    });
    return { dispatch, cycle };
  });
}

// Rota para disparar o e-mail de cotação via Outlook
router.post('/send-draft-batch', async (req: Request, res: Response) => {
  const quotationId = String(req.body?.quotationId || '');
  if (!quotationId) return res.status(400).json({ error: 'quotationId é obrigatório' });
  const recipients = normalizeBatchRecipients(req.body?.recipients, req.body?.partnerType);
  if (!recipients.length) return res.status(400).json({ error: 'Informe ao menos um destinatário válido.' });

  const batchKey = `${quotationId}:${recipients.map(item => item.email).sort().join(',')}`;
  if (activeBatchDispatches.has(batchKey)) return res.status(409).json({ error: 'Este lote já está sendo enviado. Aguarde a conclusão.' });
  activeBatchDispatches.add(batchKey);

  try {
    const quotation = await prisma.quotation.findUnique({ where: { id: quotationId }, include:{ groundServiceLegs:true } });
    if (!quotation) return res.status(404).json({ error: 'Cotação não encontrada' });

    const attachmentIds = Array.isArray(req.body?.attachmentIds) ? req.body.attachmentIds.map(String) : [];
    const truckerAttachmentIds = Array.isArray(req.body?.truckerAttachmentIds) ? req.body.truckerAttachmentIds.map(String) : [];
    const reference = quotation.reference || quotation.id.substring(0, 6).toUpperCase();
    const mailSubject = String(req.body?.subject || quotation.draftEmailSubject || `Solicitação de Cotação de Frete - REF: ${reference}`);
    const rawMarkdown = String(req.body?.htmlBody || quotation.draftEmail || '');
    if (!rawMarkdown.trim()) return res.status(400).json({ error: 'O rascunho do e-mail está vazio.' });
    const signature = await loadProfessionalSignature(req.body?.professionalId);

    const emailStyle = `<style>body{font-family:'Segoe UI',Arial,sans-serif;font-size:14px;color:#333;line-height:1.6}ul{margin-top:5px;margin-bottom:5px;padding-left:20px}strong{font-weight:600;color:#000}p{margin:0 0 10px}</style>`;
    // Renderizado por destinatário (não uma vez só) para poder trocar a
    // saudação genérica pelo nome de quem ficou como "Para" em cada e-mail,
    // sem precisar gerar o rascunho de novo pela IA.
    const buildFinalHtmlEmail = async (contactName?: string | null) =>
      appendProfessionalSignature(`<html><head>${emailStyle}</head><body>${await marked.parse(personalizeGreeting(rawMarkdown, contactName))}</body></html>`, signature.html);
    const selectedDocuments = await prisma.quotationDocument.findMany({
      where: { quotationId, id: { in: attachmentIds } }, include: { blob: true }
    });
    const outlookAttachments = selectedDocuments.map(document => ({
      name: document.originalName, contentType: document.blob.mimeType, content: Buffer.from(document.blob.content)
    }));
    const allowResend = req.body?.allowResend === true;
    const duplicateWindow = new Date(Date.now() - 60_000);

    const results = await mapWithConcurrency(recipients, 3, async recipient => {
      try {
        if (!allowResend) {
          const duplicate = await prisma.quotationEmailDispatch.findFirst({
            where: {
              quotationId, recipientEmail: { equals: recipient.email, mode: 'insensitive' }, subject: mailSubject,
              status: 'SENT', createdAt: { gte: duplicateWindow }
            }, orderBy: { createdAt: 'desc' }
          });
          if (duplicate) return { ...recipient, status: 'SKIPPED', conversationId: duplicate.conversationId, message: 'Envio recente já confirmado.' };
        }

        const effectiveCcEmail = recipient.ccEmail || String(req.body?.ccEmail || '') || undefined;
        const finalHtmlEmail = await buildFinalHtmlEmail(recipient.contactName);
        const { conversationId } = await sendOutlookEmail(recipient.email, mailSubject, finalHtmlEmail,
          effectiveCcEmail, [...outlookAttachments, signature.attachment]);
        await recordSuccessfulDispatch({
          quotationId, recipientType: recipient.partnerType, recipientEmail: recipient.email,
          partnerName: [recipient.partnerName, recipient.contactName].filter(Boolean).join(' - ') || null,
          ccEmails: effectiveCcEmail || null,
          subject: mailSubject, conversationId, documents: selectedDocuments, professional:signature.professional
        });
        return { ...recipient, status: 'SENT', conversationId, message: 'Enviado com sucesso.' };
      } catch (error: any) {
        const errorMessage = String(error?.message || 'Falha no envio').slice(0, 1000);
        const dispatch = await prisma.quotationEmailDispatch.create({ data: {
          quotationId, recipientType: recipient.partnerType, recipientEmail: recipient.email, subject: mailSubject,
          attachmentIds: JSON.stringify(attachmentIds), attachmentNames: JSON.stringify(selectedDocuments.map(item => item.originalName)),
          status: 'FAILED', errorMessage, professionalId:signature.professional.id,
          professionalName:signature.professional.name, signatureVersion:signature.professional.signatureVersion
        } }).catch(() => null);
        await recordQuotationEvent(prisma, {
          quotationId, type: 'EMAIL_SEND_FAILED', actorType: 'SYSTEM', channel: 'OUTLOOK',
          partnerEmail: recipient.email, partnerName: recipient.partnerName,
          sourceType: dispatch ? 'EMAIL_DISPATCH' : undefined, sourceId: dispatch?.id,
          metadata: { error: errorMessage, recipientType: recipient.partnerType, professionalId:signature.professional.id,
            professionalName:signature.professional.name, signatureVersion:signature.professional.signatureVersion }
        }).catch(() => undefined);
        return { ...recipient, status: 'FAILED', conversationId: null, message: errorMessage };
      }
    });

    const confirmed = results.filter(item => item.status === 'SENT' || item.status === 'SKIPPED');
    const newlySent = results.filter(item => item.status === 'SENT');
    let truckerResult: { status: string; email?: string; message?: string; conversationId?: string | null } | null = null;
    const groundServiceResults: Array<{ serviceType:string; status:string; email?:string; message?:string; conversationId?:string|null }> = [];

    const requestedGroundServices = Array.isArray(req.body?.groundServices) ? req.body.groundServices : [];
    if (newlySent.length && requestedGroundServices.length) {
      for (const request of requestedGroundServices) {
        const serviceType = String(request?.serviceType || '').toUpperCase();
        const requestedLegId = String(request?.legId || '');
        const leg = quotation.groundServiceLegs.find(item => (!requestedLegId || item.id === requestedLegId) && item.serviceType === serviceType && item.requested);
        const email = String(request?.email || leg?.partnerEmail || '').trim();
        if (!leg || !email || !['DTA','RODOVIARIO_NACIONAL'].includes(serviceType)) {
          groundServiceResults.push({ serviceType, status:'FAILED', email, message:'Trecho ou e-mail do prestador inválido.' });
          continue;
        }
        if (leg.sentAt && request?.allowResend !== true) {
          groundServiceResults.push({ serviceType, status:'SKIPPED', email, message:'Solicitação deste trecho já enviada.' });
          continue;
        }
        try {
          const documentIds = Array.isArray(request?.attachmentIds) ? request.attachmentIds.map(String) : [];
          const documents = await prisma.quotationDocument.findMany({ where:{ quotationId, id:{ in:documentIds } }, include:{ blob:true } });
          const label = serviceType === 'DTA' ? 'DTA / Trânsito Aduaneiro' : 'Frete Rodoviário Nacional';
          const prefix = serviceType === 'DTA' ? '[DTA]' : '[RODOVIÁRIO]';
          const groundSubject = `${prefix} ${mailSubject}`;
          const rawGroundDraft = String(request?.draftEmail || leg.draftEmail || '').trim();
          if (!rawGroundDraft) throw new Error(`Gere e revise o rascunho de ${label} antes do envio.`);
          const groundHtml = appendProfessionalSignature(`<html><head>${emailStyle}</head><body>${await marked.parse(rawGroundDraft)}</body></html>`, signature.html);
          const groundCcEmail = String(request?.ccEmail || '') || undefined;
          const sent = await sendOutlookEmail(email, groundSubject, groundHtml, groundCcEmail,
            [...documents.map(document => ({ name:document.originalName, contentType:document.blob.mimeType, content:Buffer.from(document.blob.content) })), signature.attachment]);
          await recordSuccessfulDispatch({ quotationId, recipientType:serviceType === 'DTA' ? 'DTA_PROVIDER' : 'TRUCKER', recipientEmail:email,
            partnerName:String(request?.partnerName || leg.partnerName || '') || null, ccEmails: groundCcEmail || null,
            subject:groundSubject, conversationId:sent.conversationId, documents, professional:signature.professional });
          await prisma.groundServiceLeg.update({ where:{ id:leg.id }, data:{ sentAt:new Date(), partnerEmail:email,
            partnerName:String(request?.partnerName || leg.partnerName || '') || null, draftEmail:String(request?.draftEmail || leg.draftEmail || '') } });
          groundServiceResults.push({ serviceType, status:'SENT', email, conversationId:sent.conversationId, message:'Enviado com sucesso.' });
        } catch (error: any) {
          groundServiceResults.push({ serviceType, status:'FAILED', email, message:String(error?.message || 'Falha no envio.') });
        }
      }
    }

    if (newlySent.length && !requestedGroundServices.length && req.body?.needsTransport && req.body?.truckerEmail) {
      const truckerEmail = String(req.body.truckerEmail).trim();
      if (quotation.truckerSentAt && req.body?.allowTruckerResend !== true) {
        truckerResult = { status: 'SKIPPED', email: truckerEmail, message: 'Transportadora já acionada anteriormente.' };
      } else {
        try {
          const truckerHtml = appendProfessionalSignature(`<html><head>${emailStyle}</head><body>${await marked.parse(String(quotation.truckerDraftEmail || ''))}</body></html>`, signature.html);
          const truckerDocuments = await prisma.quotationDocument.findMany({
            where: { quotationId, id: { in: truckerAttachmentIds } }, include: { blob: true }
          });
          const truckerCcEmail = String(req.body?.truckerCcEmail || '') || undefined;
          const truckerSubject = `[RODOVIÁRIO] ${mailSubject}`;
          const sent = await sendOutlookEmail(truckerEmail, truckerSubject, truckerHtml,
            truckerCcEmail, [...truckerDocuments.map(document => ({
              name: document.originalName, contentType: document.blob.mimeType, content: Buffer.from(document.blob.content)
            })), signature.attachment]);
          await recordSuccessfulDispatch({ quotationId, recipientType: 'TRUCKER', recipientEmail: truckerEmail,
            partnerName: String(req.body?.truckerName || '') || null, ccEmails: truckerCcEmail || null,
            subject: truckerSubject,
            conversationId: sent.conversationId, documents: truckerDocuments, professional:signature.professional });
          truckerResult = { status: 'SENT', email: truckerEmail, conversationId: sent.conversationId, message: 'Enviado com sucesso.' };
        } catch (error: any) {
          truckerResult = { status: 'FAILED', email: truckerEmail, message: String(error?.message || 'Falha no envio da transportadora') };
        }
      }
    }

    if (confirmed.length) {
      const partnerNames = [...new Set(confirmed.map(item => item.partnerName).filter((item): item is string => Boolean(item)))];
      const allConfirmedEmails = [...new Set([...splitRecipientEmails(quotation.agentEmail), ...confirmed.map(item => item.email)])];
      const firstNew = newlySent[0];
      await prisma.quotation.update({ where: { id: quotationId }, data: {
        status: 'AGUARDANDO_PARCEIRO', agentEmail: allConfirmedEmails.join('; '),
        agentName: [...new Set([...(quotation.agentName || '').split('|').map(item => item.trim()).filter(Boolean), ...partnerNames])].join(' | ') || quotation.agentName,
        partnerType: confirmed[0]?.partnerType || quotation.partnerType,
        draftEmail: rawMarkdown, sentAt: newlySent.length ? new Date() : quotation.sentAt,
        sentEmailConversationId: firstNew?.conversationId || quotation.sentEmailConversationId,
        ...(truckerResult?.status === 'SENT' ? { truckerEmail: truckerResult.email, truckerName: String(req.body?.truckerName || '') || null, truckerSentAt: new Date() } : {})
      } });
    }

    const failed = results.filter(item => item.status === 'FAILED').length;
    res.json({
      success: confirmed.length > 0 && failed === 0, partial: confirmed.length > 0 && failed > 0,
      quotationId, reference, sent: newlySent.length, skipped: results.filter(item => item.status === 'SKIPPED').length,
      failed, results, truckerResult, groundServiceResults
    });
  } catch (error: any) {
    console.error('Erro no envio múltiplo pelo Outlook:', error);
    res.status(500).json({ error: error.message || 'Falha no envio múltiplo.' });
  } finally {
    activeBatchDispatches.delete(batchKey);
  }
});

router.post('/send-draft', async (req: Request, res: Response) => {
  let auditQuotationId = String(req.body?.quotationId || '');
  let auditProfessional: any = null;
  try {
    const { quotationId, htmlBody, subject, agentEmail, agentName, partnerType, ccEmail, needsTransport, truckerEmail, truckerName, truckerCcEmail, attachmentIds = [], truckerAttachmentIds = [] } = req.body;
    const normalizedPartnerType = normalizePartnerType(partnerType);

    if (!quotationId) return res.status(400).json({ error: 'quotationId é obrigatório' });
    if (!agentEmail) return res.status(400).json({ error: 'agentEmail é obrigatório' });

    const quotation = await prisma.quotation.findUnique({ where: { id: quotationId } });
    if (!quotation) return res.status(404).json({ error: 'Cotação não encontrada' });
    const signature = await loadProfessionalSignature(req.body?.professionalId);
    auditProfessional = signature.professional;

    let targetQuotationId = quotation.id;
    let effectiveAttachmentIds: string[] = Array.isArray(attachmentIds) ? attachmentIds : [];
    let effectiveTruckerAttachmentIds: string[] = Array.isArray(truckerAttachmentIds) ? truckerAttachmentIds : [];
    let baseReference = quotation.reference || quotation.id.substring(0,6).toUpperCase();
    let targetReference = baseReference;
    let mailSubject = subject || `Solicitação de Cotação de Frete - REF: ${targetReference}`;
    let rawMarkdown = htmlBody || quotation.draftEmail || '';

    // Compatibilidade temporária: a clonagem antiga só ocorre quando um cliente legado a solicita explicitamente.
    // O painel atual sempre usa /send-draft-batch e mantém uma única cotação.
    if (req.body?.legacyClone === true && quotation.agentEmail && quotation.agentEmail !== agentEmail) {
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
          status: 'AGUARDANDO_PARCEIRO',
          draftEmail: rawMarkdown,
          sentAt: new Date()
        }
      });

      targetQuotationId = clone.id;
      auditQuotationId = clone.id;
      await recordQuotationEvent(prisma, {
        quotationId: clone.id, type: 'QUOTATION_CLONED', actorType: 'SYSTEM',
        previousStatus: quotation.status, newStatus: 'AGUARDANDO_PARCEIRO',
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
    const finalHtmlEmail = appendProfessionalSignature(`<html><head>${emailStyle}</head><body>${renderedHtml}</body></html>`, signature.html);

    // Envia usando a Microsoft Graph API (draft+send para capturar conversationId)
    const selectedDocuments = await prisma.quotationDocument.findMany({
      where: { quotationId: targetQuotationId, id: { in: effectiveAttachmentIds } }, include: { blob: true }
    });
    const outlookAttachments = selectedDocuments.map(document => ({
      name: document.originalName, contentType: document.blob.mimeType, content: Buffer.from(document.blob.content)
    }));
    const { conversationId } = await sendOutlookEmail(agentEmail, mailSubject, finalHtmlEmail, ccEmail, [...outlookAttachments, signature.attachment]);
    await recordSuccessfulDispatch({ quotationId: targetQuotationId, recipientType: normalizedPartnerType, recipientEmail: agentEmail,
      partnerName: agentName, ccEmails: ccEmail || null, subject: mailSubject, conversationId, documents: selectedDocuments, professional:signature.professional });

    // Se houver necessidade de transporte terrestre e o e-mail da transportadora for fornecido
    let truckerConversationId = null;
    if (needsTransport && truckerEmail) {
      try {
        const truckerSubject = `[RODOVIÁRIO] ${mailSubject}`;
        const truckerMarkdown = quotation.truckerDraftEmail || '';
        const renderedTruckerHtml = await marked.parse(truckerMarkdown);
        const finalTruckerHtmlEmail = appendProfessionalSignature(`<html><head>${emailStyle}</head><body>${renderedTruckerHtml}</body></html>`, signature.html);
        
        const selectedTruckerDocuments = await prisma.quotationDocument.findMany({
          where: { quotationId: targetQuotationId, id: { in: effectiveTruckerAttachmentIds } }, include: { blob: true }
        });
        const truckerRes = await sendOutlookEmail(truckerEmail, truckerSubject, finalTruckerHtmlEmail, truckerCcEmail, [...selectedTruckerDocuments.map(document => ({
          name: document.originalName, contentType: document.blob.mimeType, content: Buffer.from(document.blob.content)
        })), signature.attachment]);
        truckerConversationId = truckerRes.conversationId;
        await recordSuccessfulDispatch({ quotationId: targetQuotationId, recipientType: 'TRUCKER', recipientEmail: truckerEmail,
          partnerName: truckerName, ccEmails: truckerCcEmail || null, subject: truckerSubject, conversationId: truckerConversationId, documents: selectedTruckerDocuments, professional:signature.professional });
        console.log(`[Outlook] E-mail de transportadora enviado para ${truckerEmail} | REF: ${targetReference} | ConversationId: ${truckerConversationId || 'N/A'}`);
      } catch (tErr: any) {
        console.error('Erro ao enviar e-mail da transportadora pelo Outlook:', tErr);
      }
    }

    // Atualiza status no banco para AGUARDANDO_PARCEIRO e salva o agentEmail + conversationId + dados da transportadora
    const updated = await prisma.quotation.update({
      where: { id: targetQuotationId },
      data: {
        status: 'AGUARDANDO_PARCEIRO',
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
        status: 'FAILED', errorMessage: String(error.message || 'Falha no envio').slice(0, 1000),
        professionalId:auditProfessional?.id || null, professionalName:auditProfessional?.name || null,
        signatureVersion:auditProfessional?.signatureVersion || null
      } }).catch(() => undefined);
      await recordQuotationEvent(prisma, {
        quotationId, type: 'EMAIL_SEND_FAILED', actorType: 'SYSTEM', channel: 'OUTLOOK', partnerEmail: recipientEmail,
        metadata: { error: String(error.message || 'Falha no envio').slice(0, 1000), professionalId:auditProfessional?.id || null,
          professionalName:auditProfessional?.name || null, signatureVersion:auditProfessional?.signatureVersion || null }
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
