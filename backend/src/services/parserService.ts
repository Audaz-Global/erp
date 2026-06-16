import { simpleParser } from 'mailparser';
import * as xlsx from 'xlsx';

// pdf-parse v2 usa export diferente
const pdfParse = require('pdf-parse');

export interface ParsedEmlResult {
  text: string;
  mediaParts: Array<{
    inlineData: {
      data: string;
      mimeType: string;
    };
    filename?: string;
  }>;
}

export const parseEmlWithMedia = async (buffer: Buffer): Promise<ParsedEmlResult> => {
  try {
    const parsed = await simpleParser(buffer);
    
    let fromText = '';
    if (parsed.from) {
      if (Array.isArray(parsed.from)) {
        fromText = parsed.from.map(f => f.text).join(', ');
      } else {
        fromText = parsed.from.text || '';
      }
    }

    let toText = '';
    if (parsed.to) {
      if (Array.isArray(parsed.to)) {
        toText = parsed.to.map(t => t.text).join(', ');
      } else {
        toText = parsed.to.text || '';
      }
    }

    let extractedText = `
--- EMAIL ---
De: ${fromText}
Para: ${toText}
Assunto: ${parsed.subject || ''}
Data: ${parsed.date || ''}

Corpo do Email:
${parsed.text || ''}
    `;

    const mediaParts: Array<{ inlineData: { data: string; mimeType: string }; filename?: string }> = [];

    // Try to parse text from attachments if they are PDF or Excel
    if (parsed.attachments && parsed.attachments.length > 0) {
      extractedText += '\n--- ANEXOS DO EMAIL ---\n';
      for (const attachment of parsed.attachments) {
        try {
          if (attachment.contentType === 'application/pdf') {
            const pdfData = await pdfParse(attachment.content);
            extractedText += `\n[Anexo PDF: ${attachment.filename}]\n${pdfData.text}\n`;
            
            // Adicionar como mídia multimodal
            mediaParts.push({
              inlineData: {
                data: attachment.content.toString('base64'),
                mimeType: 'application/pdf'
              },
              filename: attachment.filename
            });
          } else if (
            attachment.contentType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
            attachment.contentType === 'application/vnd.ms-excel'
          ) {
            const workbook = xlsx.read(attachment.content, { type: 'buffer' });
            extractedText += `\n[Anexo Excel: ${attachment.filename}]\n`;
            workbook.SheetNames.forEach(sheetName => {
              const sheet = workbook.Sheets[sheetName];
              if (sheet) {
                const csvText = xlsx.utils.sheet_to_csv(sheet);
                extractedText += `Aba ${sheetName}:\n${csvText}\n`;
              }
            });
          } else if (attachment.contentType && attachment.contentType.startsWith('image/')) {
            mediaParts.push({
              inlineData: {
                data: attachment.content.toString('base64'),
                mimeType: attachment.contentType
              },
              filename: attachment.filename
            });
            extractedText += `\n[Anexo Imagem: ${attachment.filename}]\n`;
          } else {
            extractedText += `\n[Anexo ignorado: ${attachment.filename} (${attachment.contentType})]\n`;
          }
        } catch (attachErr: any) {
          console.warn(`Aviso: Falha ao processar anexo "${attachment.filename}":`, attachErr.message);
          extractedText += `\n[Anexo com erro: ${attachment.filename}]\n`;
        }
      }
    }

    return { text: extractedText, mediaParts };
  } catch (error) {
    console.error('Erro ao fazer parse do .eml:', error);
    throw new Error('Falha ao processar arquivo .eml');
  }
};

export const parseEml = async (buffer: Buffer): Promise<string> => {
  const result = await parseEmlWithMedia(buffer);
  return result.text;
};

export const parsePdf = async (buffer: Buffer): Promise<string> => {
  try {
    const data = await pdfParse(buffer);
    return data.text;
  } catch (error) {
    console.error('Erro ao fazer parse do .pdf:', error);
    throw new Error('Falha ao processar arquivo .pdf');
  }
};

export const parseExcel = async (buffer: Buffer): Promise<string> => {
  try {
    const workbook = xlsx.read(buffer, { type: 'buffer' });
    let text = '';
    workbook.SheetNames.forEach(sheetName => {
      const sheet = workbook.Sheets[sheetName];
      if (sheet) {
        const csvText = xlsx.utils.sheet_to_csv(sheet);
        text += `Aba ${sheetName}:\n${csvText}\n`;
      }
    });
    return text;
  } catch (error) {
    console.error('Erro ao fazer parse do .xlsx:', error);
    throw new Error('Falha ao processar arquivo Excel');
  }
};
