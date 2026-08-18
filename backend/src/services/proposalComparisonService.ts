import { createHash } from 'crypto';
import { normalizeCurrency, normalizeFeeList } from './feeCalculationService';

export type ComparisonRates = { BRL: number; USD: number; EUR: number };

function parseJson(value: any, fallback: any = {}) {
  try { return typeof value === 'string' ? JSON.parse(value) : (value || fallback); }
  catch { return fallback; }
}

function finite(value: any): number | null {
  const parsed = Number(value);
  return value !== null && value !== '' && Number.isFinite(parsed) ? parsed : null;
}

function plain(value: any) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function feeKey(fee: any) {
  return fee.canonicalCategory || plain(fee.name) || 'taxa-sem-nome';
}

function mergeFees(current: any[], incoming: any[]) {
  const result = [...current];
  for (const fee of normalizeFeeList(incoming)) {
    const index = result.findIndex(item => feeKey(item) === feeKey(fee));
    if (index >= 0) result[index] = { ...result[index], ...fee };
    else result.push(fee);
  }
  return result;
}

function mergeResponseCosts(current: any, incoming: any) {
  const merged = { ...current };
  const explicit: Set<string> = Array.isArray(incoming?.present_fields) && incoming.present_fields.length
    ? new Set<string>(incoming.present_fields.map((field: any) => String(field)))
    : new Set<string>(Object.keys(incoming || {}).filter(field => !['confidence', 'field_evidence', 'present_fields'].includes(field)));
  for (const field of explicit) {
    if (incoming[field] === undefined || incoming[field] === null) continue;
    if (field === 'origin_fees' || field === 'destination_fees') merged[field] = mergeFees(merged[field] || [], incoming[field]);
    else merged[field] = incoming[field];
  }
  merged.present_fields = [...new Set([...(merged.present_fields || []), ...explicit])];
  merged.field_evidence = [...(merged.field_evidence || []), ...(incoming?.field_evidence || [])];
  return merged;
}

function proposalId(groupKey: string) {
  return `prop_${createHash('sha1').update(groupKey).digest('hex').slice(0, 16)}`;
}

function convertToBrl(value: any, currency: any, rates: ComparisonRates) {
  const amount = finite(value);
  if (amount === null) return { valueBrl: null, currency: normalizeCurrency(currency), compatible: false };
  const normalized = normalizeCurrency(currency);
  const rate = rates[normalized as keyof ComparisonRates];
  return { valueBrl: rate ? amount * rate : null, currency: normalized, compatible: Boolean(rate) };
}

function makeLine(category: string, key: string, label: string, value: any, currency: any, rates: ComparisonRates, metadata: any = {}) {
  const converted = convertToBrl(value, currency, rates);
  return {
    category, key: `${category}:${key}`, label, value: finite(value) ?? 0,
    currency: converted.currency, valueBrl: converted.valueBrl,
    includedInFreight: metadata.includedInFreight === 'INCLUDED', explicitZero: Boolean(metadata.explicitZero),
    estimated: /estimat|aproxim|provis|conting/i.test([label, metadata.evidence, metadata.source].filter(Boolean).join(' ')),
    needsReview: Boolean(metadata.needsReview), evidence: metadata.evidence || null,
    provenanceLabel: metadata.provenanceLabel || (metadata.sourceOrigin === 'SYSTEM_CATALOG' ? 'Tabela cadastrada' : 'E-mail do parceiro')
  };
}

function buildProposal(group: any, quotation: any, rates: ComparisonRates): any {
  const costs = group.costs;
  const lines: any[] = [];
  if (finite(costs.freight_value) !== null) lines.push(makeLine('FREIGHT', 'freight', 'Frete internacional', costs.freight_value, costs.freight_currency || 'USD', rates));
  if (costs.origin_inland?.quoted && finite(costs.origin_inland.value) !== null) {
    lines.push(makeLine('ORIGIN', 'origin-inland', costs.origin_inland.route ? `Inland de origem — ${costs.origin_inland.route}` : 'Inland de origem', costs.origin_inland.value, costs.origin_inland.currency || 'USD', rates, costs.origin_inland));
  }
  for (const fee of normalizeFeeList(costs.origin_fees, 'ORIGIN')) lines.push(makeLine('ORIGIN', feeKey(fee), fee.name || 'Taxa de origem', fee.totalValue ?? fee.value, fee.currency, rates, fee));
  for (const fee of normalizeFeeList(costs.destination_fees, 'DESTINATION')) lines.push(makeLine('DESTINATION', feeKey(fee), fee.name || 'Taxa de destino', fee.totalValue ?? fee.value, fee.currency, rates, fee));

  // Resumos entram apenas quando a resposta não trouxe as linhas detalhadas,
  // evitando somar a mesma taxa duas vezes.
  if (!lines.some(line => line.category === 'DESTINATION')) {
    if (finite(costs.storage_brl) !== null) lines.push(makeLine('DESTINATION', 'storage', 'Armazenagem', costs.storage_brl, 'BRL', rates, { evidence: 'Total informado na resposta' }));
    if (finite(costs.services_brl) !== null) lines.push(makeLine('DESTINATION', 'services', 'Serviços no destino', costs.services_brl, 'BRL', rates));
    if (finite(costs.taxes_brl) !== null) lines.push(makeLine('DESTINATION', 'taxes', 'Impostos no destino', costs.taxes_brl, 'BRL', rates));
  }
  if (finite(costs.iof_usd) !== null) lines.push(makeLine('DESTINATION', 'iof', 'IOF', costs.iof_usd, 'USD', rates));

  const countedLines = lines.filter(line => !line.includedInFreight);
  const incompatibleLines = countedLines.filter(line => line.valueBrl === null);
  const totals = {
    freightBrl: countedLines.filter(line => line.category === 'FREIGHT').reduce((sum, line) => sum + (line.valueBrl || 0), 0),
    originBrl: countedLines.filter(line => line.category === 'ORIGIN').reduce((sum, line) => sum + (line.valueBrl || 0), 0),
    destinationBrl: countedLines.filter(line => line.category === 'DESTINATION').reduce((sum, line) => sum + (line.valueBrl || 0), 0)
  };
  const totalComparableBrl = totals.freightBrl + totals.originBrl + totals.destinationBrl;
  const present = new Set(costs.present_fields || []);
  const missing: string[] = [];
  if (finite(costs.freight_value) === null) missing.push('Frete internacional não informado');
  if (!present.has('origin_fees') && !costs.origin_inland?.quoted) missing.push('Taxas de origem não informadas');
  if (!present.has('destination_fees') && finite(costs.services_brl) === null && finite(costs.storage_brl) === null) missing.push('Taxas de destino não informadas');
  if (!present.has('transit_time') && !present.has('transit_time_days')) missing.push('Prazo de trânsito não informado');
  if (!present.has('rate_valid_until') || costs.rate_validity_is_contingency) missing.push('Validade não confirmada pelo parceiro');
  const reviewLines = lines.filter(line => line.needsReview);
  const estimatedLines = lines.filter(line => line.estimated);
  const explicitZeroLines = lines.filter(line => line.explicitZero);
  const compatible = finite(costs.freight_value) !== null && incompatibleLines.length === 0;
  const completenessScore = Math.max(0, Math.round(100 - missing.length * 14 - reviewLines.length * 5 - incompatibleLines.length * 15));

  return {
    id: proposalId(group.key), groupKey: group.key, partnerName: group.partnerName || group.partnerEmail || 'Parceiro',
    partnerEmail: group.partnerEmail || '', partnerType: group.partnerType || quotation.partnerType || 'AGENTE',
    receivedAt: group.receivedAt, responseIds: group.responseIds, requestCycleId: group.requestCycleId,
    subject: group.subject || '', costs, lines, totals, totalComparableBrl,
    reportedTotalBrl: finite(costs.total_brl), carrier: costs.carrier || '', transitTime: costs.transit_time || costs.transit_time_days || '',
    validity: costs.rate_valid_until || '', frequency: costs.frequency || '', connections: costs.connections || '',
    confidence: finite(costs.confidence), missing, compatible, completenessScore,
    reviewCount: reviewLines.length, estimatedCount: estimatedLines.length, explicitZeroCount: explicitZeroLines.length,
    warnings: [
      ...missing,
      ...(incompatibleLines.length ? [`${incompatibleLines.length} linha(s) com moeda incompatível`] : []),
      ...(reviewLines.length ? [`${reviewLines.length} linha(s) precisam de revisão`] : []),
      ...(estimatedLines.length ? [`${estimatedLines.length} valor(es) estimado(s)`] : [])
    ]
  };
}

export function buildProposalComparison(quotation: any, responses: any[], rates: ComparisonRates, selectedEvent?: any) {
  const groups = new Map<string, any>();
  const ordered = [...responses].filter(response => response.processingStatus === 'SUCCESS' && response.extractedData)
    .sort((a, b) => new Date(a.receivedAt || a.createdAt).getTime() - new Date(b.receivedAt || b.createdAt).getTime());
  for (const response of ordered) {
    const key = response.requestCycleId ? `cycle:${response.requestCycleId}` : `email:${String(response.senderEmail || response.id).toLowerCase()}`;
    const current = groups.get(key) || {
      key, requestCycleId: response.requestCycleId || null, partnerEmail: response.requestCycle?.partnerEmail || response.senderEmail || '',
      partnerName: response.requestCycle?.partnerName || '', partnerType: response.requestCycle?.recipientType || quotation.partnerType,
      costs: {}, responseIds: []
    };
    current.costs = mergeResponseCosts(current.costs, parseJson(response.extractedData));
    current.responseIds.push(response.id);
    current.receivedAt = response.receivedAt || response.createdAt;
    current.subject = response.subject || current.subject;
    groups.set(key, current);
  }
  const proposals = [...groups.values()].map(group => buildProposal(group, quotation, rates));
  // Uma proposta incompleta nunca recebe o selo de melhor preço, pois a
  // ausência de taxas pode fazê-la parecer artificialmente mais barata.
  const priceEligible = proposals.filter(item => item.compatible && item.totalComparableBrl > 0 && item.missing.length === 0 && item.reviewCount === 0);
  const minPrice = priceEligible.length ? Math.min(...priceEligible.map(item => item.totalComparableBrl)) : null;
  const maxCompleteness = proposals.length ? Math.max(...proposals.map(item => item.completenessScore)) : null;
  const transitNumber = (value: any) => finite(String(value || '').match(/\d+(?:[.,]\d+)?/)?.[0]?.replace(',', '.'));
  const transitEligible = proposals.map(item => ({ item, days: transitNumber(item.transitTime) })).filter(item => item.days !== null);
  const minTransit = transitEligible.length ? Math.min(...transitEligible.map(item => item.days as number)) : null;
  for (const proposal of proposals) {
    proposal.badges = [
      ...(minPrice !== null && proposal.totalComparableBrl === minPrice ? ['BEST_PRICE'] : []),
      ...(maxCompleteness !== null && proposal.completenessScore === maxCompleteness ? ['MOST_COMPLETE'] : []),
      ...(minTransit !== null && transitNumber(proposal.transitTime) === minTransit ? ['BEST_TRANSIT'] : [])
    ];
  }
  proposals.sort((a, b) => Number(b.compatible) - Number(a.compatible) || a.totalComparableBrl - b.totalComparableBrl);
  const selectedMetadata = parseJson(selectedEvent?.metadata, null);
  return {
    quotationId: quotation.id, reference: quotation.reference, rates, generatedAt: new Date().toISOString(), proposals,
    selectedProposalId: selectedMetadata?.proposalId || null,
    selectedJustification: selectedMetadata?.justification || null
  };
}

export function proposalQuotationUpdate(proposal: any) {
  const costs = proposal.costs || {};
  const appliedCosts = { ...costs, total_brl: finite(costs.total_brl) ?? finite(proposal.totalComparableBrl) };
  const update: any = {
    status: 'RETORNO_RECEBIDO', costsData: JSON.stringify(appliedCosts), costCompositionReviewed: false,
    freightValue: finite(costs.freight_value), freightCurrency: normalizeCurrency(costs.freight_currency || 'USD'),
    totalUsd: finite(costs.freight_usd), iofUsd: finite(costs.iof_usd), carrier: costs.carrier || null,
    frequency: costs.frequency || null, weightBreak: costs.weight_break || null,
    connections: costs.connections || null, originServices: JSON.stringify(normalizeFeeList(costs.origin_fees, 'ORIGIN')),
    destinationServices: JSON.stringify(normalizeFeeList(costs.destination_fees, 'DESTINATION')),
    destinationStorage: finite(costs.storage_brl), destinationStorageCurrency: costs.storage_brl != null ? 'BRL' : null,
    destinationStorageSource: costs.storage_brl != null ? 'PARTNER_RESPONSE' : null,
    destinationServicesTotal: finite(costs.services_brl), destinationTaxes: finite(costs.taxes_brl),
    destinationTaxesCurrency: costs.taxes_brl != null ? 'BRL' : null, totalBrl: finite(appliedCosts.total_brl),
    needsOriginInland: Boolean(costs.origin_inland?.quoted), originInlandRoute: costs.origin_inland?.route || null,
    originInlandValue: finite(costs.origin_inland?.value), originInlandCurrency: normalizeCurrency(costs.origin_inland?.currency || 'USD'),
    originInlandTransitTime: costs.origin_inland?.transit_time || null
  };
  const transit = finite(String(costs.transit_time || '').match(/\d+/)?.[0]);
  if (transit !== null) update.transitTimeDays = Math.round(transit);
  if (/^\d{4}-\d{2}-\d{2}/.test(String(costs.rate_valid_until || ''))) {
    update.rateValidUntil = new Date(`${String(costs.rate_valid_until).slice(0, 10)}T12:00:00Z`);
    update.rateValiditySource = costs.rate_validity_source || 'AGENT_EMAIL';
    update.rateValidityEvidence = costs.rate_validity_evidence || null;
    update.rateValidityConfidence = finite(costs.rate_validity_confidence);
    update.rateValidityNeedsReview = Boolean(costs.rate_validity_needs_review);
  }
  return update;
}
