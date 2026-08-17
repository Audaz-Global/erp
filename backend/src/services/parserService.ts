import { simpleParser } from 'mailparser';
import * as xlsx from 'xlsx';

// pdf-parse v2 usa export diferente
const pdfParse = require('pdf-parse');
const MsgReader = require('@kenjiuno/msgreader').default || require('@kenjiuno/msgreader');

export interface ParsedEmlResult {
  text: string;
  emailRecord?: {
    format: 'EML' | 'MSG';
    senderName?: string;
    senderEmail?: string;
    subject?: string;
    receivedAt?: string;
    originalBody: string;
    extractedContact?: {
      name?: string;
      phone?: string;
      email?: string;
      source: 'SIGNATURE_TEXT' | 'SENDER_HEADER' | 'NOT_FOUND';
      confidence: number;
      evidence?: string;
    };
  };
  mediaParts: Array<{
    inlineData: {
      data: string;
      mimeType: string;
    };
    filename?: string;
  }>;
  signatureMediaParts?: Array<{
    inlineData: { data: string; mimeType: string };
    filename?: string;
  }>;
}

function normalizePhone(value: string): string {
  const cleaned = String(value || '').replace(/[^\d+()\- .xX]/g, '').replace(/\s+/g, ' ').trim();
  return cleaned.replace(/\s*(?:ext\.?|ramal|x)\s*/i, ' x');
}

function safeIsoDate(value: any): string | undefined {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function extractContactFromSignature(body: string, senderName = '', senderEmail = '') {
  const lines = String(body || '').replace(/\r/g, '').split('\n').map(line => line.trim()).filter(Boolean);
  const signoffPattern = /^(atenciosamente|cordialmente|obrigad[oa]|best regards|kind regards|regards|sincerely|thanks(?: and regards)?|many thanks)[,!]?$/i;
  let signatureStart = -1;
  // O corpo pode terminar com "Obrigada" e a assinatura ainda conter "Best Regards".
  // A última despedida é o início correto da assinatura.
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (signoffPattern.test(lines[index] || '')) { signatureStart = index; break; }
  }
  const signatureLines = (signatureStart >= 0 ? lines.slice(signatureStart + 1) : lines.slice(-20)).slice(0, 20);
  const evidence = signatureLines.join(' | ');
  const phonePattern = /(?:tel(?:ephone)?|phone|mobile|cell|whatsapp|fone|cel(?:ular)?)?\s*[:.]?\s*(\+?\d[\d() .-]{6,}\d)(?:\s*(?:ext\.?|ramal|x)\s*\d+)?/gi;
  const phoneMatches = [...evidence.matchAll(phonePattern)].map(match => {
    const phone = normalizePhone(match[1] || '');
    const digits = phone.replace(/\D/g, '');
    const context = evidence.slice(Math.max(0, (match.index || 0) - 24), (match.index || 0) + match[0].length).toLowerCase();
    const explicitlyMobile = /whatsapp|mobile|cell|celular/.test(context);
    const brazilianMobile = (digits.length === 13 && digits.startsWith('55') && digits[4] === '9') || (digits.length === 11 && digits[2] === '9');
    return { phone, score: (explicitlyMobile ? 4 : 0) + (brazilianMobile ? 2 : 0) };
  }).filter(item => item.phone).sort((a, b) => b.score - a.score);
  const emailMatch = evidence.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const nameLine = signatureLines.find(line => {
    const compact = line.replace(/[|•·]/g, ' ').trim();
    return compact.length >= 3 && compact.length <= 80
      && !/@/.test(compact)
      && !signoffPattern.test(compact)
      && !/(tel|phone|mobile|cell|whatsapp|www\.|http|ltd|inc\.|logistics|cargo|freight|comercial|sales|supervisor|manager|director|coordinator|analyst|foreign trade|import|export|comex)/i.test(compact)
      && /^\p{L}+(?:['.-]\p{L}+)*(?:\s+\p{L}+(?:['.-]\p{L}+)*){1,5}$/u.test(compact);
  });
  const name = nameLine || senderName || '';
  const phone = phoneMatches[0]?.phone || '';
  const email = emailMatch?.[0] || senderEmail || '';
  const source: 'SIGNATURE_TEXT' | 'SENDER_HEADER' | 'NOT_FOUND' = signatureLines.length && (nameLine || phoneMatches.length || emailMatch) ? 'SIGNATURE_TEXT' : (senderName || senderEmail ? 'SENDER_HEADER' : 'NOT_FOUND');
  const confidence = source === 'SIGNATURE_TEXT' ? (name && phone ? 0.9 : 0.75) : (name || email ? 0.55 : 0);
  return { name, phone, email, source, confidence, evidence: evidence.slice(0, 600) };
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

function getPngDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 24 || buffer.toString('ascii', 1, 4) !== 'PNG') return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
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
    const signatureMediaParts: Array<{ inlineData: { data: string; mimeType: string }; filename?: string }> = [];

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
            const dimensions = getPngDimensions(attachment.content);
            const isKnownSignatureName = /logo|signature|assinatura|facebook|instagram|linkedin|twitter|icon/.test(filename);
            const isSmallRelatedAsset = Boolean((attachment as any).related) && (
              dimensions
                ? dimensions.width <= 64 && dimensions.height <= 64
                : imageSize < 4_000
            );
            const isSignatureAsset = isKnownSignatureName || isSmallRelatedAsset;
            const isSignatureCandidate = Boolean((attachment as any).related) && imageSize >= 4_000 && imageSize <= 1_500_000 && (
              !dimensions || (dimensions.width <= 1_200 && dimensions.height <= 600)
            );
            if (isSignatureAsset) {
              extractedText += `\n[Imagem inline/assinatura ignorada: ${attachment.filename}]\n`;
              if (imageSize >= 4_000 && imageSize <= 1_500_000 && signatureMediaParts.length < 2) {
                signatureMediaParts.push({
                  inlineData: { data: attachment.content.toString('base64'), mimeType: attachment.contentType },
                  filename: attachment.filename
                });
              }
              continue;
            }
            if (isSignatureCandidate && signatureMediaParts.length < 2) {
              signatureMediaParts.push({
                inlineData: { data: attachment.content.toString('base64'), mimeType: attachment.contentType },
                filename: attachment.filename
              });
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

    const fromValue = (parsed.from as any)?.value?.[0] || {};
    return {
      text: extractedText,
      mediaParts,
      signatureMediaParts,
      emailRecord: {
        format: 'EML', senderName: fromValue.name || '', senderEmail: fromValue.address || '',
        subject: parsed.subject || '', receivedAt: parsed.date ? safeIsoDate(parsed.date) : undefined,
        originalBody: String(parsed.text || ''),
        extractedContact: extractContactFromSignature(String(parsed.text || ''), fromValue.name || '', fromValue.address || '')
      }
    };
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
      mediaParts: [],
      signatureMediaParts: [],
      emailRecord: {
        format: 'MSG', senderName: fromName, senderEmail: fromEmail, subject: testMsg.subject || '',
        receivedAt: testMsg.messageDeliveryTime ? safeIsoDate(testMsg.messageDeliveryTime) : undefined,
        originalBody: String(testMsg.body || ''),
        extractedContact: extractContactFromSignature(String(testMsg.body || ''), fromName, fromEmail)
      }
    };
  } catch (error) {
    console.error('Erro ao fazer parse do .msg:', error);
    return { text: '\n[Erro ao processar arquivo .msg]\n', mediaParts: [] };
  }
};
