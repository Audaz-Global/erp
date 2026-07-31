import { simpleParser } from 'mailparser';
import * as xlsx from 'xlsx';

// pdf-parse v2 usa export diferente
const pdfParse = require('pdf-parse');
const MsgReader = require('@kenjiuno/msgreader').default || require('@kenjiuno/msgreader');

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

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' '
  };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_match, entity: string) => {
    if (entity[0] === '#') {
      const hex = entity[1]?.toLowerCase() === 'x';
      const codePoint = parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : ' ';
    }
    return named[entity.toLowerCase()] ?? ' ';
  });
}

export function htmlToStructuredText(html: string): string {
  return decodeHtmlEntities(String(html || ''))
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/(?:li|p|div|tr|h[1-6])>/gi, '\n')
    .replace(/<\/(?:td|th)>\s*<(?:td|th)[^>]*>/gi, ' | ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[\t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeComparableLine(value: string): string {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

export function extractUniqueHtmlText(html: string, plainText: string): string {
  const structured = htmlToStructuredText(html);
  if (!structured) return '';

  const plainComparable = normalizeComparableLine(plainText);
  const seen = new Set<string>();
  return structured.split(/\r?\n/).map(line => line.trim()).filter(line => {
    const comparable = normalizeComparableLine(line);
    if (comparable.length < 2 || seen.has(comparable)) return false;
    seen.add(comparable);
    return !plainComparable.includes(comparable);
  }).join('\n').trim();
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

    let htmlContent = '';
    // Alguns clientes mantêm tabelas e listas apenas no HTML. Incluímos somente
    // as linhas ausentes no texto simples para evitar perda e duplicação.
    if (parsed.html) {
      const cleanHtml = extractUniqueHtmlText(String(parsed.html), String(parsed.text || ''));
      if (cleanHtml) {
        htmlContent = `\n\n--- INFORMAÇÕES ADICIONAIS EXTRAÍDAS DO HTML ---\n${cleanHtml}`;
      }
    }

    let extractedText = `
--- EMAIL ---
De: ${fromText}
Para: ${toText}
Assunto: ${parsed.subject || ''}
Data: ${parsed.date || ''}

Corpo do Email (Texto Puro):
${parsed.text || ''}
${htmlContent}
    `;

    const mediaParts: Array<{ inlineData: { data: string; mimeType: string }; filename?: string }> = [];

    // Extrai imagens inline codificadas em Base64 do corpo HTML
    if (parsed.html) {
      const imgRegex = /<img[^>]+src=["']data:(image\/[^;]+);base64,([^"']+)["']/g;
      let match;
      let inlineCount = 0;
      while ((match = imgRegex.exec(parsed.html)) !== null) {
        if (match[1] && match[2]) {
          const mimeType = match[1];
          const base64Data = match[2];
          const approximateBytes = Math.floor(base64Data.length * 0.75);
          // Pequenos data URIs costumam ser logos/ícones de assinatura. Mantemos
          // no máximo duas imagens embutidas com tamanho relevante.
          if (approximateBytes < 20_000 || inlineCount >= 2) continue;
          inlineCount++;
          mediaParts.push({
            inlineData: {
              data: base64Data,
              mimeType
            },
            filename: `inline_image_${inlineCount}.${mimeType.split('/')[1] || 'png'}`
          });
          extractedText += `\n[Imagem Embutida #${inlineCount}]\n`;
        }
      }
    }

    // Try to parse text from attachments if they are PDF or Excel
    if (parsed.attachments && parsed.attachments.length > 0) {
      extractedText += '\n--- ANEXOS DO EMAIL ---\n';
      for (const attachment of parsed.attachments) {
        try {
          if (attachment.contentType === 'application/pdf') {
            const pdfData = await pdfParse(attachment.content);
            const pdfText = String(pdfData.text || '').trim();
            extractedText += `\n[Anexo PDF: ${attachment.filename}]\n${pdfText || '[PDF sem texto pesquisável]'}\n`;

            // PDFs com texto pesquisável já estão representados acima.
            // O binário fica reservado a PDFs digitalizados/imagens.
            if (pdfText.length < 200) {
              mediaParts.push({
                inlineData: {
                  data: attachment.content.toString('base64'),
                  mimeType: 'application/pdf'
                },
                filename: attachment.filename
              });
            }
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
            const filename = String(attachment.filename || '').toLowerCase();
            const imageSize = Number(attachment.content?.length || 0);
            const isKnownSignatureName = /logo|signature|assinatura|facebook|instagram|linkedin|twitter|icon/.test(filename);
            const isSmallRelatedAsset = Boolean((attachment as any).related) && imageSize < 20_000;
            const isSignatureAsset = isKnownSignatureName || isSmallRelatedAsset;
            if (isSignatureAsset) {
              extractedText += `\n[Imagem inline/assinatura ignorada: ${attachment.filename}]\n`;
              continue;
            }
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

export const parseMsg = async (buffer: Buffer): Promise<ParsedEmlResult> => {
  try {
    const msg = new MsgReader(buffer);
    const testMsg = msg.getFileData();
    const fromName = testMsg.senderName || '';
    const fromEmail = testMsg.senderEmail || '';
    
    let toText = '';
    if (testMsg.recipients && testMsg.recipients.length > 0) {
      toText = testMsg.recipients.map((r: any) => r.name || r.email || '').join(', ');
    }

    const extractedText = `
--- EMAIL (MSG/OUTLOOK) ---
De: ${fromName} ${fromEmail ? '<'+fromEmail+'>' : ''}
Para: ${toText}
Assunto: ${testMsg.subject || ''}
Data: ${testMsg.messageDeliveryTime || ''}

Corpo do Email:
${testMsg.body || ''}
    `;

    return {
      text: extractedText,
      mediaParts: []
    };
  } catch (error) {
    console.error('Erro ao fazer parse do .msg:', error);
    return { text: '\n[Erro ao processar arquivo .msg]\n', mediaParts: [] };
  }
};
