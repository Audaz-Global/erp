import { Request, Response } from 'express';
import { parseEml, parseEmlWithMedia, parsePdf, parseExcel, parseMsg } from '../services/parserService';
import { extractClientData, extractAgentCosts, generateAgentDraft, generateTruckerDraft } from '../services/aiService';
import { prisma } from '../prisma';
import { buildDraftPayload } from '../utils/draftPayload';
import { renderDraftSubject } from '../utils/emailTemplate';
import { getDraftEmailFieldLabels } from '../services/draftEmailFieldRuleService';
import { applyRateValidityPolicy } from '../services/rateValidityService';

const SINGLETON_ID = 'default';
const DEFAULT_SUBJECT_TEMPLATE = '{quotationCode} | {direction} {modal} - {incoterm} | {origin} x {destination} | {client} | {clientReference}';

function buildQuotationCode(initials: string): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const datePart = `${pad(now.getDate())}${pad(now.getMonth() + 1)}${String(now.getFullYear()).slice(-2)}`;
  const timePart = `${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `${initials.toUpperCase()}-${datePart}-${timePart}`;
}

export const extractData = async (req: Request, res: Response) => {
  try {
    const rawText = req.body.text || '';
    const mode = req.body.mode || 'CLIENT'; // 'CLIENT' ou 'AGENT'
    let extractedFileText = '';
    const mediaParts: any[] = [];

    const files = req.files as Express.Multer.File[];

    if (files && files.length > 0) {
      for (const file of files) {
        try {
          const ext = file.originalname.toLowerCase();

          if (file.mimetype === 'message/rfc822' || ext.endsWith('.eml')) {
            const emlResult = await parseEmlWithMedia(file.buffer);
            extractedFileText += emlResult.text;
            if (emlResult.mediaParts && emlResult.mediaParts.length > 0) {
              mediaParts.push(...emlResult.mediaParts);
            }
          } else if (file.mimetype === 'application/vnd.ms-outlook' || ext.endsWith('.msg')) {
            const msgResult = await parseMsg(file.buffer);
            extractedFileText += msgResult.text;
            if (msgResult.mediaParts && msgResult.mediaParts.length > 0) {
              mediaParts.push(...msgResult.mediaParts);
            }
          } else if (file.mimetype === 'application/pdf' || ext.endsWith('.pdf')) {
            const pdfText = await parsePdf(file.buffer);
            extractedFileText += `\n[PDF: ${file.originalname}]\n${pdfText}\n`;
            // Evita enviar o mesmo PDF como texto e binário. O binário é
            // necessário apenas quando o documento não possui texto pesquisável.
            if (String(pdfText || '').trim().length < 200) {
              mediaParts.push({
                inlineData: {
                  data: file.buffer.toString('base64'),
                  mimeType: 'application/pdf'
                },
                filename: file.originalname
              });
            }
          } else if (
            ext.endsWith('.xlsx') || ext.endsWith('.xls') || ext.endsWith('.csv') ||
            file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
            file.mimetype === 'application/vnd.ms-excel'
          ) {
            const excelText = await parseExcel(file.buffer);
            extractedFileText += `\n[Excel: ${file.originalname}]\n${excelText}\n`;
          } else if (file.mimetype.startsWith('image/')) {
            mediaParts.push({
              inlineData: {
                data: file.buffer.toString('base64'),
                mimeType: file.mimetype
              },
              filename: file.originalname
            });
            extractedFileText += `\n[Imagem: ${file.originalname}]\n`;
          } else {
            extractedFileText += `\n[Arquivo ignorado: ${file.originalname}]\n`;
          }
        } catch (fileErr: any) {
          extractedFileText += `\n[Erro ao processar: ${file.originalname}]\n`;
        }
      }
    }

    const combinedText = `
      ${rawText ? `[TEXTO COLADO]:\n${rawText}` : ''}
      ${extractedFileText ? `[CONTEÚDO DOS ARQUIVOS]:\n${extractedFileText}` : ''}
    `;

    if (!combinedText.trim()) {
      return res.status(400).json({ error: 'Nenhum texto ou arquivo fornecido.' });
    }

    let contextRules = '';
    try {
      const rules = await prisma.knowledgeEntry.findMany({ where: { active: true }, select: { title: true, content: true } });
      contextRules = rules.map(r => `- ${r.title}: ${r.content}`).join('\n');
    } catch (dbErr) {}

    let aiResult;
    if (mode === 'CLIENT') {
      aiResult = await extractClientData(combinedText, contextRules, mediaParts);
    } else {
      // Buscar cotação original para passar como contexto de cálculo
      const quotationId = req.body.quotationId || '';
      let quotationContext = '';
      let quotation = null;
      if (quotationId) {
        try {
          quotation = await prisma.quotation.findUnique({ where: { id: quotationId } });
          if (quotation) {
            quotationContext = `
- Rota: ${quotation.originCity || 'Não informada'} para ${quotation.destinationCity || 'Não informada'}
- Tipo de Carga: ${quotation.loadType || 'Não informado'}
- Dimensões/Carga: ${quotation.packages || 'Não informada'}
- Direção: ${quotation.direction || 'IMPORT'}
- Inland de Origem solicitado: ${quotation.needsOriginInland ? 'Sim' : 'Não'}
- Rota do Inland de Origem: ${quotation.originInlandRoute || 'Não informada'}
`;
          }
        } catch (dbErr) {
          console.error('Erro ao buscar cotação original na extração de custos:', dbErr);
        }
      }

      // Carregar taxas locais cadastradas no banco (Companhia Marítima ou Aérea, conforme o modal da cotação)
      let localFeesTable = '';
      if (quotation) {
        try {
          const feeModal = quotation.modal === 'AIR' ? 'AIR' : (quotation.loadType === 'LCL' ? 'SEA_LCL' : 'SEA_FCL');
          const modalLabel = quotation.modal === 'AIR' ? 'Companhia Aérea' : 'Companhia Marítima';
          const fees = await prisma.fixedFee.findMany({
            where: { active: true, modal: { in: [feeModal, 'ALL'] } }
          });
          const deconsolidators = await prisma.deconsolidator.findMany({
            where: { active: true, modal: feeModal }
          });
          localFeesTable = `TABELA DE TAXAS LOCAIS DE DESTINO POR ${modalLabel.toUpperCase()} (CADASTRADAS NO BANCO):\n\n`;
          fees.forEach(f => {
            localFeesTable += `- Cia: ${f.carrier || 'Geral'} | Taxa: ${f.name} | Valor: ${f.value} ${f.currency} (${f.type === 'ORIGIN' ? 'Origem' : 'Destino'})\n`;
          });
          deconsolidators.forEach(d => {
            localFeesTable += `- Desconsolidação (${d.name}${d.location ? ' - ' + d.location : ''}): ${d.value} ${d.currency}\n`;
          });
        } catch (dbErr) {
          console.error('Erro ao carregar taxas locais no banco:', dbErr);
        }
      }

      aiResult = await extractAgentCosts(combinedText, contextRules, localFeesTable, quotationContext, mediaParts);
      if (aiResult?.costs) applyRateValidityPolicy(aiResult.costs);
      
      // Regra de Negócio: Calcular Seguro Automático
      if (aiResult && aiResult.costs && aiResult.costs.insurance_requested) {
        const invoiceValue = aiResult.costs.invoice_value || 0;
        const freight = aiResult.costs.freight_value || 0;
        
        // Sum origin fees
        let originFeesTotal = 0;
        if (Array.isArray(aiResult.costs.origin_fees)) {
          originFeesTotal = aiResult.costs.origin_fees.reduce((sum: number, f: any) => sum + (parseFloat(f.value) || 0), 0);
        }
        
        const base = invoiceValue + freight + originFeesTotal;
        const insuranceValue = Math.max(base * 0.002, 40.00);
        
        if (!Array.isArray(aiResult.costs.destination_fees)) {
          aiResult.costs.destination_fees = [];
        }
        
        // Evitar duplicidade se a IA já tiver adicionado o seguro
        const hasInsurance = aiResult.costs.destination_fees.some((f: any) => String(f.name).toLowerCase().includes('seguro'));
        if (!hasInsurance) {
          aiResult.costs.destination_fees.push({
            name: 'Seguro Internacional',
            value: parseFloat(insuranceValue.toFixed(2)),
            currency: 'USD'
          });
        }
      }
    }

    res.json({ message: 'Extração concluída', data: aiResult, rawText: combinedText });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const generateDraft = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { contactName, operatorInitials } = req.body || {};

    const quotation = await prisma.quotation.findUnique({ where: { id }, include: { client: true } });
    if (!quotation) return res.status(404).json({ error: 'Cotação não encontrada' });

    // Gera o Código da Cotação (iniciais do operador + data + hora) uma única vez
    let agentEmailCode = quotation.agentEmailCode;
    if (!agentEmailCode) {
      const initials = String(operatorInitials || '').trim();
      if (!/^[A-Za-z]{2,4}$/.test(initials)) {
        return res.status(400).json({ error: 'Informe as iniciais do operador (2 a 4 letras) para gerar o Código da Cotação.' });
      }
      agentEmailCode = buildQuotationCode(initials);
    }

    // Buscar regras de conhecimento ativas do banco de dados
    let contextRules = '';
    try {
      const rules = await prisma.knowledgeEntry.findMany({ where: { active: true }, select: { title: true, content: true } });
      contextRules = rules.map(r => `- ${r.title}: ${r.content}`).join('\n');
    } catch (dbErr) {
      console.error('Erro ao buscar regras para o rascunho:', dbErr);
    }

    // Parsear o e-mail original se houver
    let originalEmailText = '';
    if (quotation.sourceEmails) {
      try {
        const emailsArr = JSON.parse(quotation.sourceEmails);
        if (Array.isArray(emailsArr) && emailsArr.length > 0) {
          originalEmailText = emailsArr.join('\n');
        } else {
          originalEmailText = quotation.sourceEmails;
        }
      } catch (e) {
        originalEmailText = quotation.sourceEmails;
      }
    }

    // Um único formato tipado alimenta os rascunhos do agente e da transportadora.
    const payload = buildDraftPayload({ ...quotation, agentEmailCode }, originalEmailText);

    const requiredFieldLabels = await getDraftEmailFieldLabels(quotation.modal, quotation.direction);

    const draftText = await generateAgentDraft(payload, contextRules, contactName, requiredFieldLabels);

    const emailSettings = await prisma.agentDraftEmailSettings.upsert({
      where: { id: SINGLETON_ID },
      update: {},
      create: { id: SINGLETON_ID, subjectTemplate: DEFAULT_SUBJECT_TEMPLATE }
    });
    const draftSubject = renderDraftSubject(emailSettings.subjectTemplate, {
      quotationCode: agentEmailCode,
      direction: quotation.direction === 'EXPORT' ? 'EXP' : 'IMP',
      modal: payload.modal || '',
      incoterm: payload.incoterm || '',
      origin: payload.originPort || payload.originCity || '',
      destination: payload.destinationPort || payload.destinationCity || '',
      client: payload.clientName || '',
      clientReference: payload.clientReferenceNumber || ''
    });

    let truckerDraftText = null;
    if (quotation.needsTransport) {
      try {
        // Obter nome de contato da transportadora se houver no banco ou gerar padrão
        truckerDraftText = await generateTruckerDraft(payload, contextRules);
      } catch (err) {
        console.error('Erro ao gerar rascunho de transportadora:', err);
      }
    }

    // Atualizar no banco
    const updated = await prisma.quotation.update({
      where: { id },
      data: {
        draftEmail: draftText,
        draftEmailSubject: draftSubject,
        truckerDraftEmail: truckerDraftText,
        agentEmailCode
      }
    });

    res.json({ draft: draftText, draftSubject, truckerDraft: truckerDraftText, quotation: updated });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const translateDraftController = async (req: Request, res: Response) => {
  try {
    const { text, targetLanguage, originCountry } = req.body;
    if (!text || !targetLanguage) {
      return res.status(400).json({ error: 'Faltam parâmetros de tradução' });
    }

    const { translateDraftText } = await import('../services/aiService');
    const translatedText = await translateDraftText(text, targetLanguage, originCountry);

    res.json({ translatedText });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};
