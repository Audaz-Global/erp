export type BatchRecipient = {
  email: string;
  partnerName: string | null;
  contactName: string | null;
  partnerType: string;
  ccEmail: string | null;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PARTNER_TYPES = new Set(['AGENTE', 'COLOADER', 'ARMADOR', 'CIA_AEREA', 'DESCONSOLIDADOR']);

export function splitRecipientEmails(value: unknown) {
  return String(value || '').split(/[;,\n]/).map(item => item.trim().toLowerCase()).filter(item => EMAIL_PATTERN.test(item));
}

export function normalizeBatchRecipients(raw: unknown, fallbackType = 'AGENTE'): BatchRecipient[] {
  if (!Array.isArray(raw)) return [];
  const normalizedFallback = PARTNER_TYPES.has(String(fallbackType).toUpperCase()) ? String(fallbackType).toUpperCase() : 'AGENTE';
  const seen = new Set<string>();
  const recipients: BatchRecipient[] = [];

  for (const item of raw.slice(0, 50)) {
    if (!item || typeof item !== 'object') continue;
    const source = item as Record<string, unknown>;
    const typeCandidate = String(source.partnerType || normalizedFallback).toUpperCase();
    const partnerType = PARTNER_TYPES.has(typeCandidate) ? typeCandidate : normalizedFallback;
    for (const email of splitRecipientEmails(source.email)) {
      if (recipients.length >= 50) return recipients;
      if (seen.has(email)) continue;
      seen.add(email);
      recipients.push({
        email,
        partnerName: String(source.partnerName || '').trim() || null,
        contactName: String(source.contactName || '').trim() || null,
        partnerType,
        ccEmail: splitRecipientEmails(source.ccEmail)[0] || null
      });
    }
  }
  return recipients;
}

export async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]!, index);
    }
  });
  await Promise.all(runners);
  return results;
}
