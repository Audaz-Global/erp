import { Router, Request, Response } from 'express';
import { prisma } from '../prisma';
import { sendOutlookEmail, searchEmails } from '../services/outlookService';
import { marked } from 'marked';

const router = Router();

// Configuração do marked para quebrar linhas normalmente
marked.setOptions({ breaks: true });

// Rota para disparar o e-mail de cotação via Outlook
router.post('/send-draft', async (req: Request, res: Response) => {
  try {
    const { quotationId, htmlBody, subject, agentEmail, agentName, ccEmail, needsTransport, truckerEmail, truckerName, truckerCcEmail } = req.body;

    if (!quotationId) return res.status(400).json({ error: 'quotationId é obrigatório' });
    if (!agentEmail) return res.status(400).json({ error: 'agentEmail é obrigatório' });

    const quotation = await prisma.quotation.findUnique({ where: { id: quotationId } });
    if (!quotation) return res.status(404).json({ error: 'Cotação não encontrada' });

    let targetQuotationId = quotation.id;
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
          status: 'AGUARDANDO_AGENTE',
          draftEmail: rawMarkdown,
          sentAt: new Date()
        }
      });

      targetQuotationId = clone.id;
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
    const { conversationId } = await sendOutlookEmail(agentEmail, mailSubject, finalHtmlEmail, ccEmail);

    // Se houver necessidade de transporte terrestre e o e-mail da transportadora for fornecido
    let truckerConversationId = null;
    if (needsTransport && truckerEmail) {
      try {
        const truckerSubject = `Solicitação de Coleta/Entrega Rodoviária - REF: ${targetReference}`;
        const truckerMarkdown = quotation.truckerDraftEmail || '';
        const renderedTruckerHtml = await marked.parse(truckerMarkdown);
        const finalTruckerHtmlEmail = `<html><head>${emailStyle}</head><body>${renderedTruckerHtml}</body></html>`;
        
        const truckerRes = await sendOutlookEmail(truckerEmail, truckerSubject, finalTruckerHtmlEmail, truckerCcEmail);
        truckerConversationId = truckerRes.conversationId;
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
    res.status(500).json({ error: error.message });
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

export default router;
