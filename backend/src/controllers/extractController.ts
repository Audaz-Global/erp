import { Request, Response } from 'express';
import { parseEml, parseEmlWithMedia, parsePdf, parseExcel, parseMsg } from '../services/parserService';
import { extractClientData, extractAgentCosts, extractSignatureOcr, generateAgentDraft, generateTruckerDraft } from '../services/aiService';
import { prisma } from '../prisma';
import { buildDraftPayload } from '../utils/draftPayload';
import { renderDraftBody, renderDraftSubject } from '../utils/emailTemplate';
import { getDraftEmailFieldLabels } from '../services/draftEmailFieldRuleService';
import { findAgentDraftEmailTemplate } from '../services/agentDraftEmailTemplateService';
import { applyRateValidityPolicy } from '../services/rateValidityService';
import { resolveFeeQuantities } from '../services/feeCalculationService';
import { applyDomesticTransportEvidencePolicy } from '../utils/quotationRequestPolicy';

const SINGLETON_ID = 'default';
const DEFAULT_SUBJECT_TEMPLATE = '{quotationCode} | {direction} {modal} - {incoterm} | {origin} x {destination} | {client} | {clientReference}';

function clientExtractionAudit(data: any, emailRecords: any[], signatureOcr: any[] = []) {
  const contact = emailRecords.map(item => item.extractedContact).find(item => item && (item.name || item.phone || item.email));
  const numericConfidence = (value: any) => Number.isFinite(Number(value)) ? Number(value) : null;
  const source = (field: string, value: any, fieldConfidence: any) => ({
    field, value: value ?? '', source: value ? 'EMAIL_BODY_OR_DOCUMENT' : 'NOT_FOUND',
    confidence: value ? numericConfidence(fieldConfidence) : 0
  });
  const entries: any[] = [
    source('Cliente', data?.client?.name, data?.client?.confidence),
    source('Referência do cliente', data?.client?.reference, data?.client?.confidence),
    source('Incoterm', data?.route?.incoterm, data?.route?.confidence),
    source('Origem', data?.route?.origin_city, data?.route?.confidence),
    source('Destino', data?.route?.destination_city, data?.route?.confidence),
    {
      field: 'Transporte rodoviário nacional',
      value: data?.route?.needs_transport ? data?.route?.transport_route || 'Solicitado' : 'Não solicitado',
      source: data?.route?.transport_source || 'NOT_REQUESTED',
      confidence: data?.route?.needs_transport ? 1 : 0,
      evidence: data?.route?.transport_evidence || ''
    },
    source('Peso bruto', data?.cargo?.gross_weight_kg, data?.cargo?.confidence),
    source('Dimensões', data?.cargo?.dimensions?.join('; '), data?.cargo?.confidence)
  ];
  entries.push({ field: 'Nome do contato', value: contact?.name || data?.client?.contact_name || '', source: contact?.source || (data?.client?.contact_name ? 'EMAIL_BODY_OR_DOCUMENT' : 'NOT_FOUND'), confidence: contact?.name ? contact.confidence : numericConfidence(data?.client?.confidence) || 0, evidence: contact?.evidence || '' });
  entries.push({ field: 'Telefone do contato', value: contact?.phone || data?.client?.contact_phone || '', source: contact?.source || (data?.client?.contact_phone ? 'EMAIL_BODY_OR_DOCUMENT' : 'NOT_FOUND'), confidence: contact?.phone ? contact.confidence : numericConfidence(data?.client?.confidence) || 0, evidence: contact?.evidence || '' });
  return { version: 1, processedAt: new Date().toISOString(), emails: emailRecords, fields: entries, signatureOcr };
}

function buildQuotationCode(initials: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date()).reduce<Record<string, string>>((acc, part) => ({ ...acc, [part.type]: part.value }), {});
  const datePart = `${parts.day || '01'}${parts.month || '01'}${(parts.year || '2000').slice(-2)}`;
  const timePart = `${parts.hour || '00'}${parts.minute || '00'}`;
  return `${initials.toUpperCase()}-${datePart}-${timePart}`;
}

export const extractData = async (req: Request, res: Response) => {
  try {
    const rawText = req.body.text || '';
    const mode = req.body.mode || 'CLIENT'; // 'CLIENT' ou 'AGENT'
    let extractedFileText = '';
    const mediaParts: any[] = [];
    const signatureMediaParts: any[] = [];
    const emailRecords: any[] = [];

    const files = req.files as Express.Multer.File[];

    if (files && files.length > 0) {
      for (const file of files) {
        try {
          const ext = file.originalname.toLowerCase();

          if (file.mimetype === 'message/rfc822' || ext.endsWith('.eml')) {
            const emlResult = await parseEmlWithMedia(file.buffer);
            extractedFileText += emlResult.text;
            if (emlResult.emailRecord) emailRecords.push({ ...emlResult.emailRecord, fileName: file.originalname });
            if (emlResult.signatureMediaParts?.length) signatureMediaParts.push(...emlResult.signatureMediaParts);
            if (emlResult.mediaParts && emlResult.mediaParts.length > 0) {
              mediaParts.push(...emlResult.mediaParts);
            }
          } else if (file.mimetype === 'application/vnd.ms-outlook' || ext.endsWith('.msg')) {
            const msgResult = await parseMsg(file.buffer);
            extractedFileText += msgResult.text;
            if (msgResult.emailRecord) emailRecords.push({ ...msgResult.emailRecord, fileName: file.originalname });
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
      aiResult = applyDomesticTransportEvidencePolicy(aiResult, combinedText);
      const signatureContact = emailRecords.map(item => item.extractedContact).find(item => item?.source === 'SIGNATURE_TEXT' && (item.name || item.phone));
      if (signatureContact) {
        aiResult.client = aiResult.client || {};
        if (signatureContact.name) aiResult.client.contact_name = signatureContact.name;
        if (signatureContact.phone) aiResult.client.contact_phone = signatureContact.phone;
        if (signatureContact.email) aiResult.client.contact_email = signatureContact.email;
      }
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
- Carga perigosa: ${quotation.dangerousGoodsStatus === 'CONFIRMED' || quotation.isImo ? 'Sim' : quotation.dangerousGoodsStatus === 'TO_CONFIRM' ? 'A confirmar' : 'Não'}
- Quantidade de produtos perigosos distintos: ${quotation.dangerousGoodsProductCount ?? 'Não informada'}
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
          localFeesTable = `CATÁLOGO DE TAXAS POR ${modalLabel.toUpperCase()} (CADASTRADAS NO BANCO; respeite o grupo financeiro informado):\n\n`;
          fees.forEach(f => {
            localFeesTable += `- Cia: ${f.carrier || 'Geral'} | Taxa: ${f.name} | Valor: ${f.value} ${f.currency} | Escopo: ${f.type} | Grupo: ${f.financialGroup || 'TO_CONFIRM'} | Natureza: ${f.chargeNature || 'OTHER'}\n`;
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
      if (aiResult?.costs && quotation) {
        aiResult.costs.origin_fees = resolveFeeQuantities(aiResult.costs.origin_fees, quotation);
        aiResult.costs.destination_fees = resolveFeeQuantities(aiResult.costs.destination_fees, quotation);
      }
      
      // Regra de Negócio: Calcular Seguro Automático
      if (aiResult && aiResult.costs && aiResult.costs.insurance_requested) {
        const invoiceValue = aiResult.costs.invoice_value || 0;
        const freight = aiResult.costs.freight_value || 0;
        
        // Sum origin fees
        let originFeesTotal = 0;
        if (Array.isArray(aiResult.costs.origin_fees)) {
          originFeesTotal = aiResult.costs.origin_fees.reduce((sum: number, f: any) => sum + (parseFloat(f.totalValue ?? f.value) || 0), 0);
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
            currency: 'USD', financialGroup:'INSURANCE', chargeNature:'INSURANCE', classificationSource:'RULE', applicationScope:'DESTINATION'
          });
        }
      }
    }

    let signatureOcr: any[] = [];
    if (mode === 'CLIENT' && signatureMediaParts.length) {
      try { signatureOcr = await extractSignatureOcr(signatureMediaParts); }
      catch (ocrError: any) { console.warn('OCR de assinatura não concluído:', ocrError?.message || ocrError); }
    }
    const emailExtraction = mode === 'CLIENT' ? clientExtractionAudit(aiResult, emailRecords, signatureOcr) : null;
    res.json({ message: 'Extração concluída', data: aiResult, rawText: combinedText, emailExtraction });
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

    const selectedTemplate = await findAgentDraftEmailTemplate(quotation);
    const bodyTokens: Record<string, string> = {
      quotationCode: agentEmailCode, direction: quotation.direction === 'EXPORT' ? 'Exportação' : 'Importação', modal: payload.modal || '', incoterm: payload.incoterm || '',
      origin: payload.originPort || payload.originCity || 'Não informado', destination: payload.destinationPort || payload.destinationCity || 'Não informado', equipment: payload.loadType || 'Não informado',
      grossWeight: payload.totalGrossWeightKg != null ? String(payload.totalGrossWeightKg) : 'Não informado', cargoValue: payload.commercialValue != null ? `${payload.commercialCurrency || ''} ${payload.commercialValue}`.trim() : 'Não informado',
      imoStatus: payload.dangerousGoodsStatus === 'CONFIRMED' ? 'Sim' : payload.dangerousGoodsStatus === 'TO_CONFIRM' ? 'A confirmar' : 'Não', directService: payload.connections ? 'Conforme rota informada' : 'Quando aplicável', freeTime: 'Quando aplicável', client: payload.clientName || '', clientReference: payload.clientReferenceNumber || ''
    };
    const draftText = selectedTemplate ? renderDraftBody(selectedTemplate.bodyTemplate, bodyTokens) : await generateAgentDraft(payload, contextRules, contactName, requiredFieldLabels);

    const emailSettings = await prisma.agentDraftEmailSettings.upsert({
      where: { id: SINGLETON_ID },
      update: {},
      create: { id: SINGLETON_ID, subjectTemplate: DEFAULT_SUBJECT_TEMPLATE }
    });
    const draftSubject = renderDraftSubject(selectedTemplate?.subjectTemplate || emailSettings.subjectTemplate, {
      quotationCode: agentEmailCode,
      direction: quotation.direction === 'EXPORT' ? 'EXP' : 'IMP',
      modal: payload.modal || '',
      incoterm: payload.incoterm || '',
      origin: payload.originPort || payload.originCity || '',
      destination: payload.destinationPort || payload.destinationCity || '',
      client: payload.clientName || '',
      clientCnpj: payload.clientCnpj || '',
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

    // Atualizar no banco (sincronizando o código gerado com a referência oficial da cotação)
    const updated = await prisma.quotation.update({
      where: { id },
      data: {
        reference: agentEmailCode,
        draftEmail: draftText,
        draftEmailSubject: draftSubject,
        truckerDraftEmail: truckerDraftText,
        agentEmailCode
      }
    });

    res.json({ draft: draftText, draftSubject, template: selectedTemplate ? { id: selectedTemplate.id, name: selectedTemplate.name } : null, truckerDraft: truckerDraftText, quotation: updated });
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
