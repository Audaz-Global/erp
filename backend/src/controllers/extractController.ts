import { Request, Response } from 'express';
import { parseEml, parseEmlWithMedia, parsePdf, parseExcel } from '../services/parserService';
import { extractClientData, extractAgentCosts, generateAgentDraft, readLocalFeesTable } from '../services/aiService';
import { prisma } from '../prisma';

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
          } else if (file.mimetype === 'application/pdf' || ext.endsWith('.pdf')) {
            const pdfText = await parsePdf(file.buffer);
            extractedFileText += `\n[PDF: ${file.originalname}]\n${pdfText}\n`;
            mediaParts.push({
              inlineData: {
                data: file.buffer.toString('base64'),
                mimeType: 'application/pdf'
              },
              filename: file.originalname
            });
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
      if (quotationId) {
        try {
          const quotation = await prisma.quotation.findUnique({ where: { id: quotationId } });
          if (quotation) {
            quotationContext = `
- Rota: ${quotation.originCity || 'Não informada'} para ${quotation.destinationCity || 'Não informada'}
- Tipo de Carga: ${quotation.loadType || 'Não informado'}
- Dimensões/Carga: ${quotation.packages || 'Não informada'}
- Direção: ${quotation.direction || 'IMPORT'}
`;
          }
        } catch (dbErr) {
          console.error('Erro ao buscar cotação original na extração de custos:', dbErr);
        }
      }

      // Ler planilha de taxas locais de armador
      const localFeesTable = readLocalFeesTable();

      aiResult = await extractAgentCosts(combinedText, contextRules, localFeesTable, quotationContext);
    }

    res.json({ message: 'Extração concluída', data: aiResult, rawText: combinedText });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const generateDraft = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const quotation = await prisma.quotation.findUnique({ where: { id } });
    if (!quotation) return res.status(404).json({ error: 'Cotação não encontrada' });

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

    // Montar o objeto no formato esperado pela IA
    const payload = {
      reference: quotation.reference,
      modal: quotation.modal,
      route: { origin: quotation.originCity, destination: quotation.destinationCity, incoterm: quotation.incoterm },
      cargo: { 
        type: quotation.loadType, 
        gross_weight_kg: quotation.totalGrossWeightKg, 
        packages_count: quotation.totalPackages, 
        is_imo: quotation.isImo,
        dimensions: quotation.packages,
        commercial_value_usd: quotation.commercialValue
      },
      originalEmailText
    };

    const draftText = await generateAgentDraft(payload, contextRules);
    
    // Atualizar no banco
    const updated = await prisma.quotation.update({
      where: { id },
      data: { draftEmail: draftText }
    });

    res.json({ draft: draftText, quotation: updated });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};
