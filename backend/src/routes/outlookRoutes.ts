import { Router, Request, Response } from 'express';
import { prisma } from '../prisma';
import { sendOutlookEmail } from '../services/outlookService';

const router = Router();

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
    
    // Envia usando a Microsoft Graph API
    await sendOutlookEmail(agentEmail, mailSubject, htmlBody || quotation.draftEmail || '');

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
