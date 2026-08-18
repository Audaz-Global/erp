import { isLikelyPersonName, nameMatchesSenderEmail } from './parserService';

function normalize(value: any): string {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function normalizeEmail(value: any): string {
  return String(value || '').trim().toLowerCase();
}

function earliestOfficialEmail(emailRecords: any[]): { record: any; originalIndex: number } | null {
  const candidates = (emailRecords || []).map((record, originalIndex) => ({ record, originalIndex }))
    .filter(item => normalizeEmail(item.record?.senderEmail));
  candidates.sort((left, right) => {
    const leftTime = Date.parse(left.record?.receivedAt || '');
    const rightTime = Date.parse(right.record?.receivedAt || '');
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) return leftTime - rightTime;
    if (Number.isFinite(leftTime) !== Number.isFinite(rightTime)) return Number.isFinite(leftTime) ? -1 : 1;
    return left.originalIndex - right.originalIndex;
  });
  return candidates[0] || null;
}

export function resolveFirstResponseContact(emailRecords: any[] = [], signatureOcr: any[] = []) {
  const selected = earliestOfficialEmail(emailRecords);
  if (!selected) return null;

  const { record, originalIndex } = selected;
  const extracted = record.extractedContact || {};
  const senderName = String(record.senderName || '').trim();
  const senderEmail = normalizeEmail(record.senderEmail);
  const headerIsPerson = isLikelyPersonName(senderName);
  const headerMatchesEmail = headerIsPerson && nameMatchesSenderEmail(senderName, senderEmail);

  const ocrCandidates = (signatureOcr || []).filter(item => {
    if (!item?.isSignature || Number(item.confidence || 0) < 0.45) return false;
    return item.sourceEmailIndex == null || Number(item.sourceEmailIndex) === originalIndex;
  });
  const matchingOcr = ocrCandidates.find(item => {
    const ocrEmail = normalizeEmail(item.email);
    const sameEmail = ocrEmail && ocrEmail === senderEmail;
    const sameName = headerIsPerson && normalize(item.name) === normalize(senderName);
    const nameMatchesEmail = isLikelyPersonName(item.name) && nameMatchesSenderEmail(item.name, senderEmail);
    return sameEmail || sameName || nameMatchesEmail;
  });

  const name = headerIsPerson ? senderName : (matchingOcr && nameMatchesSenderEmail(matchingOcr.name, senderEmail) ? String(matchingOcr.name).trim() : String(extracted.name || '').trim());
  const phone = String(extracted.phone || matchingOcr?.phone || '').trim();
  const nameValidation = headerIsPerson
    ? (headerMatchesEmail || normalize(matchingOcr?.name) === normalize(senderName) ? 'HEADER_AND_EMAIL_OR_SIGNATURE' : 'HEADER_ONLY')
    : (name && nameMatchesSenderEmail(name, senderEmail) ? 'SIGNATURE_AND_EMAIL' : 'NEEDS_REVIEW');
  const needsReview = !name || nameValidation === 'HEADER_ONLY' || nameValidation === 'NEEDS_REVIEW';
  const confidence = nameValidation === 'HEADER_AND_EMAIL_OR_SIGNATURE' ? 0.98
    : nameValidation === 'SIGNATURE_AND_EMAIL' ? 0.78
      : nameValidation === 'HEADER_ONLY' ? 0.82 : 0.4;

  return {
    name,
    phone,
    email: senderEmail,
    company: matchingOcr?.company || '',
    source: 'FIRST_RESPONSE_SENDER_HEADER',
    confidence,
    nameValidation,
    needsReview,
    emailRecordIndex: originalIndex,
    receivedAt: record.receivedAt || null,
    fileName: record.fileName || null,
    ocrEvidence: matchingOcr || null,
    evidence: `Primeira resposta: From: ${senderName || '(nome não informado)'} <${senderEmail}>${phone ? ` | Telefone da assinatura: ${phone}` : ''}`
  };
}
