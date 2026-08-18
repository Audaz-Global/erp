import { htmlToStructuredText, parseExcel, parseMsg, parsePdf } from './parserService';
import { normalizeFeeList } from './feeCalculationService';

export interface ReplyParts {
  latestText: string;
  quotedHistory: string;
  signature: string;
}

export function normalizePartnerType(value: unknown) {
  const type = String(value || 'AGENTE').trim().toUpperCase();
  return ['AGENTE', 'COLOADER', 'ARMADOR', 'CIA_AEREA', 'DESCONSOLIDADOR'].includes(type) ? type : 'AGENTE';
}

export function partnerEmailProvenance(value: unknown) {
  const partnerType = normalizePartnerType(value);
  const labels: Record<string, string> = {
    AGENTE: 'E-mail do Agente', COLOADER: 'E-mail do Coloader', ARMADOR: 'E-mail do Armador',
    CIA_AEREA: 'E-mail da Cia. Aérea', DESCONSOLIDADOR: 'E-mail do Desconsolidador'
  };
  return { partnerType, provenanceType: `${partnerType}_EMAIL`, provenanceLabel: labels[partnerType] };
}

export function tagPartnerCosts(costs: any, partnerType: unknown) {
  if (!costs || typeof costs !== 'object') return costs;
  const provenance = partnerEmailProvenance(partnerType);
  costs.partner_type = provenance.partnerType;
  for (const field of ['origin_fees', 'destination_fees']) {
    if (Array.isArray(costs[field])) costs[field] = costs[field].map((fee: any) => fee?.sourceOrigin === 'SYSTEM_CATALOG'
      ? { ...fee, provenanceType: 'SYSTEM_RATE', provenanceLabel: 'Tabela cadastrada' }
      : { ...fee, ...provenance });
  }
  if (costs.origin_inland?.quoted) costs.origin_inland = { ...costs.origin_inland, ...provenance };
  return costs;
}

const crop = (value: string, max: number) => value.length > max ? value.slice(0, max) + '\n[conteúdo reduzido]' : value;

export function splitAgentReply(body: string): ReplyParts {
  const raw = String(body || '');
  const htmlBoundary = raw.search(/<div[^>]+id=["'](?:divRplyFwdMsg|appendonsend)["'][^>]*>|<hr[^>]+(?:tabindex=["']?-1|id=["']stopSpelling)[^>]*>/i);
  const beforeQuotedHtml = htmlBoundary >= 0 ? raw.slice(0, htmlBoundary) : raw;
  const quotedHtml = htmlBoundary >= 0 ? raw.slice(htmlBoundary) : '';
  const structured = htmlToStructuredText(beforeQuotedHtml);
  const textBoundary = structured.search(/^\s*(?:-{2,}\s*(?:Original Message|Mensagem original)\s*-{2,}|(?:From|De|Sent|Enviado):.*|On .+ wrote:.*|Em .+ escreveu:.*)\s*$/im);
  let latest = (textBoundary >= 0 ? structured.slice(0, textBoundary) : structured).trim();
  const quotedFromText = textBoundary >= 0 ? structured.slice(textBoundary).trim() : '';

  const lines = latest.split('\n');
  let signatureIndex = -1;
  for (let index = Math.max(1, Math.floor(lines.length * 0.35)); index < lines.length; index++) {
    if (/^\s*(?:--\s*$|best regards[,!]?$|kind regards[,!]?$|regards[,!]?$|sincerely[,!]?$|atenciosamente[,!]?$|cordialmente[,!]?$)/i.test(lines[index] || '')) {
      signatureIndex = index;
      break;
    }
  }
  const signature = signatureIndex >= 0 ? lines.slice(signatureIndex).join('\n').trim() : '';
  if (signatureIndex >= 0) latest = lines.slice(0, signatureIndex).join('\n').trim();

  return {
    latestText: crop(latest, 60_000),
    quotedHistory: crop([quotedFromText, htmlToStructuredText(quotedHtml)].filter(Boolean).join('\n').trim(), 60_000),
    signature: crop(signature, 10_000)
  };
}

export function buildThreadContext(messages: any[], currentMessageId: string, currentReceivedAt?: string) {
  const currentTime = currentReceivedAt ? Date.parse(currentReceivedAt) : Number.MAX_SAFE_INTEGER;
  return messages
    .filter(message => message.id !== currentMessageId && (!message.receivedDateTime || Date.parse(message.receivedDateTime) <= currentTime))
    .sort((a, b) => Date.parse(a.receivedDateTime || '') - Date.parse(b.receivedDateTime || ''))
    .slice(-6)
    .map(message => {
      const sender = message.from?.emailAddress?.address || message.from?.emailAddress?.name || 'desconhecido';
      const text = splitAgentReply(message.body?.content || message.bodyPreview || '').latestText;
      return `[${message.receivedDateTime || 'sem data'} | ${sender} | ${message.subject || 'sem assunto'}]\n${crop(text, 5_000)}`;
    })
    .join('\n\n');
}

export async function extractOutlookAttachments(attachments: any[]) {
  const textBlocks: string[] = [];
  const mediaParts: any[] = [];
  const names: string[] = [];
  let totalBytes = 0;

  for (const attachment of attachments.slice(0, 15)) {
    const name = String(attachment.name || 'anexo');
    const mime = String(attachment.contentType || 'application/octet-stream').toLowerCase();
    const buffer = Buffer.from(String(attachment.contentBytes || ''), 'base64');
    const lowerName = name.toLowerCase();
    const isSignatureAsset = Boolean(attachment.isInline) || /logo|signature|assinatura|facebook|instagram|linkedin|twitter|icon/.test(lowerName);
    if (!buffer.length || isSignatureAsset || buffer.length > 8 * 1024 * 1024 || totalBytes + buffer.length > 15 * 1024 * 1024) continue;
    totalBytes += buffer.length;
    names.push(name);
    try {
      if (mime === 'application/pdf' || lowerName.endsWith('.pdf')) {
        const text = (await parsePdf(buffer)).trim();
        textBlocks.push(`[Anexo PDF: ${name}]\n${text || '[PDF sem texto pesquisável]'}`);
        if (text.length < 200 && mediaParts.length < 6) mediaParts.push({ inlineData: { data: buffer.toString('base64'), mimeType: 'application/pdf' }, filename: name });
      } else if (/spreadsheet|excel/.test(mime) || /\.(xlsx?|csv)$/.test(lowerName)) {
        const text = lowerName.endsWith('.csv') ? buffer.toString('utf8') : await parseExcel(buffer);
        textBlocks.push(`[Anexo de planilha: ${name}]\n${crop(text, 80_000)}`);
      } else if (mime.startsWith('image/') && mediaParts.length < 6) {
        mediaParts.push({ inlineData: { data: buffer.toString('base64'), mimeType: mime }, filename: name });
        textBlocks.push(`[Anexo de imagem: ${name}]`);
      } else if (/text\//.test(mime) || /\.(txt|html?)$/.test(lowerName)) {
        textBlocks.push(`[Anexo de texto: ${name}]\n${crop(buffer.toString('utf8'), 80_000)}`);
      } else if (lowerName.endsWith('.msg')) {
        const parsed = await parseMsg(buffer);
        textBlocks.push(`[Anexo MSG: ${name}]\n${crop(parsed.text, 80_000)}`);
        mediaParts.push(...parsed.mediaParts.slice(0, Math.max(0, 6 - mediaParts.length)));
      } else {
        textBlocks.push(`[Anexo não processado: ${name} (${mime})]`);
      }
    } catch (error: any) {
      textBlocks.push(`[Falha ao ler anexo: ${name} — ${error.message}]`);
    }
  }
  return { text: textBlocks.join('\n\n'), mediaParts, names };
}

function parseJsonArray(value: string | null | undefined) {
  try { const parsed = JSON.parse(value || '[]'); return Array.isArray(parsed) ? parsed : []; }
  catch { return []; }
}

export function mergeFeeLists(savedValue: string | null | undefined, incoming: any[]) {
  const result = parseJsonArray(savedValue);
  const key = (fee: any) => String(fee?.name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  for (const fee of incoming || []) {
    const index = result.findIndex((existing: any) => key(existing) === key(fee));
    const normalizedFee = normalizeFeeList([fee])[0] || fee;
    if (index >= 0) result[index] = { ...result[index], ...normalizedFee };
    else result.push(normalizedFee);
  }
  return normalizeFeeList(result);
}

export function mergeExtractedCosts(previousValue: string | null | undefined, incoming: any, presentFields: Set<string>) {
  let previous: any = {};
  try { previous = JSON.parse(previousValue || '{}') || {}; } catch { previous = {}; }
  const merged = { ...previous };
  for (const field of presentFields) {
    if (incoming[field] !== undefined && incoming[field] !== null) merged[field] = incoming[field];
  }
  merged.present_fields = [...new Set([...(previous.present_fields || []), ...presentFields])];
  merged.field_evidence = [...(previous.field_evidence || []), ...(incoming.field_evidence || [])];
  return merged;
}
