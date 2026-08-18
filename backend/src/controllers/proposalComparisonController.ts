import { Request, Response } from 'express';
import { prisma } from '../prisma';
import { getPtaxRate } from '../services/ptaxService';
import { buildProposalComparison, proposalQuotationUpdate } from '../services/proposalComparisonService';
import { quotationChanges, recordQuotationEvent } from '../services/quotationHistoryService';

const PRICING_SETTINGS_ID = 'default';

async function comparisonRates() {
  const settings = await prisma.pricingSettings.upsert({
    where: { id: PRICING_SETTINGS_ID }, update: {}, create: { id: PRICING_SETTINGS_ID }
  });
  const usd = await getPtaxRate(settings.ptaxMode === 'D0_OPEN' ? 'D0_OPEN' : 'D1_CLOSE');
  return { BRL: 1, USD: usd, EUR: 5.5 };
}

async function loadComparison(quotationId: string) {
  const [quotation, responses, selectedEvent, rates] = await Promise.all([
    prisma.quotation.findUnique({ where: { id: quotationId } }),
    prisma.agentResponseVersion.findMany({
      where: { quotationId }, orderBy: [{ receivedAt: 'asc' }, { createdAt: 'asc' }],
      include: { requestCycle: true }
    }),
    prisma.quotationEvent.findFirst({ where: { quotationId, type: 'PARTNER_PROPOSAL_SELECTED' }, orderBy: { eventAt: 'desc' } }),
    comparisonRates()
  ]);
  if (!quotation) return null;
  return { quotation, comparison: buildProposalComparison(quotation, responses, rates, selectedEvent) };
}

export const getProposalComparison = async (req: Request, res: Response) => {
  try {
    const loaded = await loadComparison(String(req.params.id));
    if (!loaded) return res.status(404).json({ error: 'Cotação não encontrada.' });
    res.json(loaded.comparison);
  } catch (error: any) {
    console.error('Erro ao montar comparativo de propostas:', error);
    res.status(500).json({ error: error?.message || 'Erro ao montar comparativo de propostas.' });
  }
};

export const selectPartnerProposal = async (req: Request, res: Response) => {
  try {
    const quotationId = String(req.params.id);
    const selectedId = String(req.params.proposalId);
    const justification = String(req.body?.justification || '').trim().slice(0, 500);
    if (!justification) return res.status(400).json({ error: 'Informe a justificativa da escolha.' });
    const loaded = await loadComparison(quotationId);
    if (!loaded) return res.status(404).json({ error: 'Cotação não encontrada.' });
    const proposal = loaded.comparison.proposals.find((item: any) => item.id === selectedId);
    if (!proposal) return res.status(404).json({ error: 'Proposta não encontrada ou sem valores processados.' });

    const updateData = proposalQuotationUpdate(proposal);
    const updated = await prisma.$transaction(async tx => {
      const quotation = await tx.quotation.update({ where: { id: quotationId }, data: updateData });
      await recordQuotationEvent(tx, {
        quotationId, type: 'PARTNER_PROPOSAL_SELECTED', actorType: 'USER', channel: 'SYSTEM',
        actorId: req.user?.userId === 'teste-local-id' ? null : req.user?.userId,
        partnerEmail: proposal.partnerEmail || null, partnerName: proposal.partnerName || null,
        previousStatus: loaded.quotation.status, newStatus: quotation.status,
        changes: quotationChanges(loaded.quotation, quotation), sourceType: 'AGENT_RESPONSE', sourceId: proposal.responseIds.at(-1) || null,
        metadata: {
          proposalId: proposal.id, requestCycleId: proposal.requestCycleId, responseIds: proposal.responseIds,
          justification, totalComparableBrl: proposal.totalComparableBrl, completenessScore: proposal.completenessScore,
          warnings: proposal.warnings, rates: loaded.comparison.rates
        }
      });
      return quotation;
    });
    res.json({ message: 'Proposta selecionada e aplicada à cotação.', quotation: updated, proposal: { ...proposal, costs: { ...proposal.costs, total_brl: proposal.costs.total_brl ?? proposal.totalComparableBrl }, selected: true }, justification });
  } catch (error: any) {
    console.error('Erro ao selecionar proposta:', error);
    res.status(500).json({ error: error?.message || 'Erro ao selecionar proposta.' });
  }
};
