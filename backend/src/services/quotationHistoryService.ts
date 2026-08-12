import { Prisma, PrismaClient } from '@prisma/client';

type DbClient = PrismaClient | Prisma.TransactionClient;

export type QuotationEventInput = {
  quotationId: string;
  type: string;
  eventAt?: Date;
  actorType?: string;
  actorId?: string | null;
  actorName?: string | null;
  channel?: string | null;
  partnerEmail?: string | null;
  partnerName?: string | null;
  previousStatus?: string | null;
  newStatus?: string | null;
  changes?: unknown;
  metadata?: unknown;
  sourceType?: string | null;
  sourceId?: string | null;
  inferred?: boolean;
};

const trackedFields = [
  'status', 'agentEmail', 'agentName', 'incoterm', 'modal', 'loadType', 'originCity', 'originPort',
  'destinationCity', 'destinationPort', 'totalGrossWeightKg', 'totalCbm', 'totalPackages', 'commercialValue',
  'freightValue', 'freightCurrency', 'carrier', 'vesselName', 'voyageNumber', 'freeTimeDays', 'rateValidUntil',
  'destinationStorage', 'destinationServicesTotal', 'destinationTaxes', 'originServicesTotal', 'originInlandValue',
  'totalBrl', 'totalUsd', 'expectedProfit', 'customsClearanceIncluded', 'requiresInsurance', 'needsTransport'
];

function comparable(value: any) {
  if (value instanceof Date) return value.toISOString();
  if (value === undefined) return null;
  return value;
}

export function quotationChanges(before: any, after: any) {
  const changes: Record<string, { from: any; to: any }> = {};
  for (const field of trackedFields) {
    const from = comparable(before?.[field]);
    const to = comparable(after?.[field]);
    if (JSON.stringify(from) !== JSON.stringify(to)) changes[field] = { from, to };
  }
  return changes;
}

export async function recordQuotationEvent(db: DbClient, input: QuotationEventInput) {
  return db.quotationEvent.create({ data: {
    quotationId: input.quotationId, type: input.type, eventAt: input.eventAt || new Date(),
    actorType: input.actorType || 'SYSTEM', actorId: input.actorId || null, actorName: input.actorName || null,
    channel: input.channel || null, partnerEmail: input.partnerEmail || null, partnerName: input.partnerName || null,
    previousStatus: input.previousStatus || null, newStatus: input.newStatus || null,
    changes: input.changes == null ? null : JSON.stringify(input.changes),
    metadata: input.metadata == null ? null : JSON.stringify(input.metadata),
    sourceType: input.sourceType || null, sourceId: input.sourceId || null, inferred: Boolean(input.inferred)
  } });
}

export function elapsedMinutes(sentAt: Date, receivedAt: Date) {
  return Math.max(0, Math.round((receivedAt.getTime() - sentAt.getTime()) / 60000));
}

export async function findRequestCycle(db: DbClient, input: {
  quotationId: string; conversationId?: string | null; senderEmail?: string | null; receivedAt: Date;
}) {
  const candidates = await db.quotationRequestCycle.findMany({
    where: {
      quotationId: input.quotationId, sentAt: { lte: input.receivedAt },
      OR: [
        ...(input.conversationId ? [{ conversationId: input.conversationId }] : []),
        ...(input.senderEmail ? [{ partnerEmail: { equals: input.senderEmail, mode: 'insensitive' as const } }] : [])
      ]
    }, orderBy: { sentAt: 'desc' }, take: 5
  });
  return candidates.find(item => input.conversationId && item.conversationId === input.conversationId) || candidates[0] || null;
}

export async function markCycleResponse(db: DbClient, cycle: any, receivedAt: Date, substantive: boolean) {
  const data: any = {};
  if (!cycle.firstResponseAt) {
    data.firstResponseAt = receivedAt;
    data.firstResponseMinutes = elapsedMinutes(cycle.sentAt, receivedAt);
    data.status = substantive ? 'COMPLETED' : 'RESPONDED';
  }
  if (substantive && !cycle.substantiveResponseAt) {
    data.substantiveResponseAt = receivedAt;
    data.substantiveResponseMinutes = elapsedMinutes(cycle.sentAt, receivedAt);
    data.status = 'COMPLETED';
    data.closedAt = receivedAt;
  }
  if (!Object.keys(data).length) return cycle;
  return db.quotationRequestCycle.update({ where: { id: cycle.id }, data });
}

export async function backfillQuotationHistory(prisma: PrismaClient) {
  const quotations = await prisma.quotation.findMany({ include: { agentResponses: { orderBy: { receivedAt: 'asc' } }, requestCycles: true } });
  let created = 0;
  for (const quotation of quotations) {
    const ensureEvent = async (sourceId: string, input: Omit<QuotationEventInput, 'quotationId' | 'sourceId'>) => {
      const exists = await prisma.quotationEvent.findFirst({ where: { quotationId: quotation.id, sourceType: 'LEGACY', sourceId } });
      if (!exists) {
        await recordQuotationEvent(prisma, { ...input, quotationId: quotation.id, sourceType: 'LEGACY', sourceId, inferred: true });
        created++;
      }
    };
    await ensureEvent(`${quotation.id}:created`, { type: 'QUOTATION_CREATED', eventAt: quotation.createdAt, newStatus: 'SOLICITADO' });
    if (quotation.sentAt) await ensureEvent(`${quotation.id}:sent`, {
      type: 'EMAIL_SENT', eventAt: quotation.sentAt, channel: 'OUTLOOK', partnerEmail: quotation.agentEmail,
      partnerName: quotation.agentName, previousStatus: 'SOLICITADO', newStatus: 'AGUARDANDO_AGENTE'
    });
    for (const response of quotation.agentResponses) await ensureEvent(`${response.id}:received`, {
      type: 'PARTNER_RESPONSE_RECEIVED', eventAt: response.receivedAt || response.createdAt, actorType: 'OUTLOOK', channel: 'OUTLOOK',
      partnerEmail: response.senderEmail, sourceType: 'AGENT_RESPONSE', metadata: { processingStatus: response.processingStatus }
    });

    if (quotation.sentAt && quotation.agentEmail && !quotation.requestCycles.length) {
      const eligible = quotation.agentResponses.filter(response => response.receivedAt && response.receivedAt >= quotation.sentAt!);
      const first = eligible[0];
      const substantive = eligible.find(response => response.processingStatus === 'SUCCESS');
      const cycle = await prisma.quotationRequestCycle.create({ data: {
        quotationId: quotation.id, partnerEmail: quotation.agentEmail, partnerName: quotation.agentName,
        conversationId: quotation.sentEmailConversationId, sentAt: quotation.sentAt,
        firstResponseAt: first?.receivedAt || null,
        firstResponseMinutes: first?.receivedAt ? elapsedMinutes(quotation.sentAt, first.receivedAt) : null,
        substantiveResponseAt: substantive?.receivedAt || null,
        substantiveResponseMinutes: substantive?.receivedAt ? elapsedMinutes(quotation.sentAt, substantive.receivedAt) : null,
        status: substantive ? 'COMPLETED' : first ? 'RESPONDED' : 'OPEN',
        closedAt: substantive?.receivedAt || null
      } });
      if (eligible.length) await prisma.agentResponseVersion.updateMany({ where: { id: { in: eligible.map(item => item.id) } }, data: { requestCycleId: cycle.id } });
      created++;
    }
  }
  return created;
}
