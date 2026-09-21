import { prisma } from '../prisma';
import { buildDraftPayload } from '../utils/draftPayload';
import { renderDraftSubject } from '../utils/emailTemplate';
import { findAgentDraftEmailTemplate } from './agentDraftEmailTemplateService';

const AGENT_DRAFT_EMAIL_SETTINGS_ID = 'default';
export const DEFAULT_SUBJECT_TEMPLATE = '{quotationCode} | {direction} {modal} - {incoterm} | {origin} x {destination} | {client} | {clientReference}';

export function isValidOperatorInitials(initials: unknown): initials is string {
  return typeof initials === 'string' && /^[A-Za-z]{2,4}$/.test(initials.trim());
}

// Gera "INICIAIS-DDMMYY-HHMM". Um minuto só tem um "slot" por prefixo, então
// duas cotações criadas no mesmo minuto (comum — mesmo operador, seguidas)
// colidiriam no @unique; acrescenta -1, -2... até achar uma referência livre.
// Única fonte desse formato no sistema (antes havia uma cópia divergente e
// sem checagem de unicidade em extractController.ts).
export async function generateQuotationReference(initials: string): Promise<string> {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date()).reduce<Record<string, string>>((acc, part) => ({ ...acc, [part.type]: part.value }), {});
  const datePart = `${parts.day || '01'}${parts.month || '01'}${(parts.year || '2000').slice(-2)}`;
  const timePart = `${parts.hour || '00'}${parts.minute || '00'}`;
  const prefix = initials.trim().toUpperCase();
  const base = `${prefix}-${datePart}-${timePart}`;
  let candidate = base;
  let suffix = 1;
  while (await prisma.quotation.findUnique({ where: { reference: candidate } })) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

// Monta o assunto do e-mail ao agente a partir do código da cotação e dos
// dados de rota/cliente — mesma lógica usada em "Gerar Rascunho"
// (extractController.generateDraft), reaproveitada para que o fluxo "Só
// Marcar Aguardando" grave o mesmo assunto sem depender daquele botão nem
// chamar a geração de rascunho por IA.
export async function buildAgentEmailSubject(
  quotation: any,
  agentEmailCode: string,
  selectedTemplate?: { subjectTemplate?: string | null } | null
): Promise<string> {
  const payload = buildDraftPayload({ ...quotation, agentEmailCode }, '');
  const template = selectedTemplate !== undefined ? selectedTemplate : await findAgentDraftEmailTemplate(quotation);
  const emailSettings = await prisma.agentDraftEmailSettings.upsert({
    where: { id: AGENT_DRAFT_EMAIL_SETTINGS_ID },
    update: {},
    create: { id: AGENT_DRAFT_EMAIL_SETTINGS_ID, subjectTemplate: DEFAULT_SUBJECT_TEMPLATE }
  });
  return renderDraftSubject(template?.subjectTemplate || emailSettings.subjectTemplate, {
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
}
