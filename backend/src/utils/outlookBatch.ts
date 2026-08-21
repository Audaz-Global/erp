export type BatchRecipient = {
  email: string;
  partnerId: string | null;
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

// Monta o array ccRecipients do MS Graph a partir de uma string com um ou mais
// e-mails separados por ; , ou quebra de linha (o Graph exige um objeto por endereço).
export function buildCcRecipients(ccEmail: unknown): { emailAddress: { address: string } }[] {
  return splitRecipientEmails(ccEmail).map(address => ({ emailAddress: { address } }));
}

export function normalizeBatchRecipients(raw: unknown, fallbackType = 'AGENTE'): BatchRecipient[] {
  if (!Array.isArray(raw)) return [];
  const normalizedFallback = PARTNER_TYPES.has(String(fallbackType).toUpperCase()) ? String(fallbackType).toUpperCase() : 'AGENTE';
  const seen = new Set<string>();
  const recipients: BatchRecipient[] = [];

  outer:
  for (const item of raw.slice(0, 50)) {
    if (!item || typeof item !== 'object') continue;
    const source = item as Record<string, unknown>;
    const typeCandidate = String(source.partnerType || normalizedFallback).toUpperCase();
    const partnerType = PARTNER_TYPES.has(typeCandidate) ? typeCandidate : normalizedFallback;
    const partnerId = String(source.partnerId || '').trim() || null;
    for (const email of splitRecipientEmails(source.email)) {
      if (recipients.length >= 50) break outer;
      if (seen.has(email)) continue;
      seen.add(email);
      recipients.push({
        email,
        partnerId,
        partnerName: String(source.partnerName || '').trim() || null,
        contactName: String(source.contactName || '').trim() || null,
        partnerType,
        ccEmail: splitRecipientEmails(source.ccEmail).join('; ') || null
      });
    }
  }
  return groupSiblingContactsIntoCc(recipients);
}

// Quando dois ou mais contatos compartilham o mesmo partnerId (mesmo parceiro/empresa,
// ex: Rafaela e Caroline da Fan Cargo), consolida num único e-mail: o primeiro contato
// adicionado à lista vira "Para" e os demais entram automaticamente em "Cc", em vez de
// disparar um e-mail separado por contato.
function groupSiblingContactsIntoCc(recipients: BatchRecipient[]): BatchRecipient[] {
  const grouped: BatchRecipient[] = [];
  const primaryByPartner = new Map<string, BatchRecipient>();

  for (const recipient of recipients) {
    const primary = recipient.partnerId ? primaryByPartner.get(recipient.partnerId) : undefined;
    if (!primary) {
      if (recipient.partnerId) primaryByPartner.set(recipient.partnerId, recipient);
      grouped.push(recipient);
      continue;
    }
    const ccSet = new Set(splitRecipientEmails(primary.ccEmail));
    ccSet.add(recipient.email);
    primary.ccEmail = [...ccSet].join('; ');
  }
  return grouped;
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
