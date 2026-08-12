import { Request, Response } from 'express';
import { prisma } from '../prisma';

const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2);
};

const average = (values: number[]) => values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;

export async function getQuotationTimeline(req: Request, res: Response) {
  try {
    const [events, cycles] = await Promise.all([
      prisma.quotationEvent.findMany({ where: { quotationId: req.params.id }, orderBy: [{ eventAt: 'asc' }, { recordedAt: 'asc' }] }),
      prisma.quotationRequestCycle.findMany({
        where: { quotationId: req.params.id }, orderBy: { sentAt: 'asc' },
        include: {
          dispatches: { select: { id: true, status: true, createdAt: true, recipientType: true } },
          responses: { select: { id: true, receivedAt: true, processingStatus: true, subject: true } }
        }
      })
    ]);
    res.json({ events, cycles });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Erro ao consultar a linha do tempo.' });
  }
}

export async function getPartnerResponseMetrics(_req: Request, res: Response) {
  try {
    const cycles = await prisma.quotationRequestCycle.findMany({ where: { recipientType: 'PARTNER' }, orderBy: { sentAt: 'desc' } });
    const groups = new Map<string, typeof cycles>();
    for (const cycle of cycles) {
      const key = cycle.partnerEmail.trim().toLowerCase();
      groups.set(key, [...(groups.get(key) || []), cycle]);
    }
    const partners = [...groups.entries()].map(([partnerEmail, items]) => {
      const firstTimes = items.map(item => item.firstResponseMinutes).filter((value): value is number => value != null);
      const completeTimes = items.map(item => item.substantiveResponseMinutes).filter((value): value is number => value != null);
      const open = items.filter(item => item.status === 'OPEN');
      return {
        partnerEmail, partnerName: items.find(item => item.partnerName)?.partnerName || null,
        requests: items.length, responses: firstTimes.length, completeResponses: completeTimes.length,
        responseRate: items.length ? Math.round(firstTimes.length * 1000 / items.length) / 10 : 0,
        averageFirstResponseMinutes: average(firstTimes), medianFirstResponseMinutes: median(firstTimes),
        averageCompleteResponseMinutes: average(completeTimes), medianCompleteResponseMinutes: median(completeTimes),
        pending: open.length,
        oldestPendingMinutes: open.length ? Math.max(...open.map(item => Math.max(0, Math.round((Date.now() - item.sentAt.getTime()) / 60000)))) : null
      };
    }).sort((a, b) => (a.medianFirstResponseMinutes ?? Number.MAX_SAFE_INTEGER) - (b.medianFirstResponseMinutes ?? Number.MAX_SAFE_INTEGER));
    const allFirst = cycles.map(item => item.firstResponseMinutes).filter((value): value is number => value != null);
    const allComplete = cycles.map(item => item.substantiveResponseMinutes).filter((value): value is number => value != null);
    res.json({
      summary: {
        requests: cycles.length, responses: allFirst.length, completeResponses: allComplete.length,
        pending: cycles.filter(item => item.status === 'OPEN').length,
        responseRate: cycles.length ? Math.round(allFirst.length * 1000 / cycles.length) / 10 : 0,
        averageFirstResponseMinutes: average(allFirst), medianFirstResponseMinutes: median(allFirst),
        averageCompleteResponseMinutes: average(allComplete), medianCompleteResponseMinutes: median(allComplete)
      }, partners
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Erro ao calcular indicadores de resposta.' });
  }
}
