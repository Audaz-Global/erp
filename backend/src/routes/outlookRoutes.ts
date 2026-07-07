import { Router, Request, Response } from 'express';
import { prisma } from '../prisma';
import { sendOutlookEmail } from '../services/outlookService';
import { marked } from 'marked';

const router = Router();

// Configuração do marked para quebrar linhas normalmente
marked.setOptions({ breaks: true });

// Rota para disparar o e-mail de cotação via Outlook
router.post('/send-draft', async (req: Request, res: Response) => {
  try {
    const { quotationId, htmlBody, subject, agentEmail } = req.body;

    if (!quotationId) return res.status(400).json({ error: 'quotationId é obrigatório' });
    if (!agentEmail) return res.status(400).json({ error: 'agentEmail é obrigatório' });

    const quotation = await prisma.quotation.findUnique({ where: { id: quotationId } });
    if (!quotation) return res.status(404).json({ error: 'Cotação não encontrada' });

    // Usa o assunto passado pelo frontend ou monta um padrão
    const mailSubject = subject || `Solicitação de Cotação de Frete - REF: ${quotation.reference || quotation.id.substring(0,6).toUpperCase()}`;
    
    // Converte o texto Markdown vindo do rascunho para HTML limpo usando o 'marked'
    const rawMarkdown = htmlBody || quotation.draftEmail || '';
    
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

    // Envia usando a Microsoft Graph API
    await sendOutlookEmail(agentEmail, mailSubject, finalHtmlEmail);

    // Atualiza status no banco para AGUARDANDO_AGENTE e salva o agentEmail
    const updated = await prisma.quotation.update({
      where: { id: quotationId },
      data: { 
        status: 'AGUARDANDO_AGENTE',
        agentEmail: agentEmail
      }
    });

    res.json({ success: true, quotation: updated });
  } catch (error: any) {
    console.error('Erro ao disparar Outlook:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
