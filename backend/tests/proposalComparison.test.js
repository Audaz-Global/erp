const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildProposalComparison, proposalQuotationUpdate } = require('../dist/services/proposalComparisonService');

const quotation = { id: 'q1', reference: 'GDS-180826-1200', partnerType: 'AGENTE', incoterm: 'EXW' };
const response = (overrides) => ({
  id: overrides.id, processingStatus: 'SUCCESS', receivedAt: overrides.receivedAt || '2026-08-18T12:00:00Z',
  senderEmail: overrides.senderEmail, requestCycleId: overrides.requestCycleId,
  requestCycle: { id: overrides.requestCycleId, partnerEmail: overrides.senderEmail, partnerName: overrides.partnerName, recipientType: 'AGENTE' },
  extractedData: JSON.stringify(overrides.costs)
});

test('compara propostas por ciclo sem misturar valores de parceiros diferentes', () => {
  const responses = [
    response({ id:'r1', requestCycleId:'c1', senderEmail:'a@example.com', partnerName:'Agente A', costs:{
      freight_value:1000, freight_currency:'USD', transit_time:'7 dias', rate_valid_until:'2026-08-30',
      origin_fees:[{name:'Handling',value:100,currency:'USD',billingUnit:'TOTAL_SHIPMENT',quantity:1,financialGroup:'ORIGIN_CHARGE'}], destination_fees:[{name:'Desconsolidação',value:500,currency:'BRL',billingUnit:'TOTAL_SHIPMENT',quantity:1,financialGroup:'DESTINATION_CHARGE'}],
      present_fields:['freight_value','freight_currency','transit_time','rate_valid_until','origin_fees','destination_fees']
    }}),
    response({ id:'r2', requestCycleId:'c2', senderEmail:'b@example.com', partnerName:'Agente B', costs:{
      freight_value:900, freight_currency:'USD', transit_time:'10 dias', rate_valid_until:'2026-08-31',
      origin_fees:[{name:'Handling',value:80,currency:'USD',billingUnit:'TOTAL_SHIPMENT',quantity:1,financialGroup:'ORIGIN_CHARGE'}], destination_fees:[{name:'Desconsolidação',value:400,currency:'BRL',billingUnit:'TOTAL_SHIPMENT',quantity:1,financialGroup:'DESTINATION_CHARGE'}],
      present_fields:['freight_value','freight_currency','transit_time','rate_valid_until','origin_fees','destination_fees']
    }})
  ];
  const result = buildProposalComparison(quotation, responses, {BRL:1,USD:5,EUR:6});
  assert.equal(result.proposals.length, 2);
  const b = result.proposals.find(item => item.partnerName === 'Agente B');
  assert.equal(b.totalComparableBrl, 5300);
  assert.ok(b.badges.includes('BEST_PRICE'));
  assert.equal(b.missing.length, 0);
});

test('mescla respostas complementares do mesmo ciclo e preserva linhas detalhadas', () => {
  const responses = [
    response({ id:'r1', requestCycleId:'c1', senderEmail:'a@example.com', partnerName:'Agente A', costs:{freight_value:1000,freight_currency:'USD',present_fields:['freight_value','freight_currency']} }),
    response({ id:'r2', requestCycleId:'c1', senderEmail:'a@example.com', partnerName:'Agente A', receivedAt:'2026-08-18T13:00:00Z', costs:{origin_fees:[{name:'AWB Fee',value:50,currency:'USD'}],present_fields:['origin_fees']} })
  ];
  const result = buildProposalComparison(quotation, responses, {BRL:1,USD:5,EUR:6});
  assert.equal(result.proposals.length, 1);
  assert.deepEqual(result.proposals[0].responseIds, ['r1','r2']);
  assert.equal(result.proposals[0].totals.freightBrl, 5000);
  assert.equal(result.proposals[0].totals.originBrl, 250);
});

test('não chama proposta incompleta de melhor preço', () => {
  const result = buildProposalComparison(quotation, [response({ id:'r1', requestCycleId:'c1', senderEmail:'a@example.com', partnerName:'Agente A', costs:{
    freight_value:500, freight_currency:'USD', present_fields:['freight_value','freight_currency']
  }})], {BRL:1,USD:5,EUR:6});
  assert.ok(result.proposals[0].missing.length > 0);
  assert.ok(!result.proposals[0].badges.includes('BEST_PRICE'));
});

test('seleção transforma a proposta em composição editável da cotação', () => {
  const comparison = buildProposalComparison(quotation, [response({ id:'r1', requestCycleId:'c1', senderEmail:'a@example.com', partnerName:'Agente A', costs:{
    freight_value:1200, freight_currency:'EUR', carrier:'Lufthansa', transit_time:'5 dias',
    destination_fees:[{name:'Delivery',value:300,currency:'BRL'}], present_fields:['freight_value','freight_currency','carrier','transit_time','destination_fees']
  }})], {BRL:1,USD:5,EUR:6});
  const update = proposalQuotationUpdate(comparison.proposals[0]);
  assert.equal(update.freightValue, 1200);
  assert.equal(update.freightCurrency, 'EUR');
  assert.equal(update.carrier, 'Lufthansa');
  assert.equal(update.transitTimeDays, 5);
  assert.equal(JSON.parse(update.destinationServices)[0].name, 'Delivery');
  assert.equal(update.totalBrl, 7500);
  assert.equal(update.costCompositionReviewed, false);
});

test('tela oferece comparação, filtros e seleção auditável', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  assert.match(html, /Comparativo automático de propostas/);
  assert.match(html, /Só diferenças/);
  assert.match(html, /Com alertas/);
  assert.match(html, /selectPartnerProposal/);
  assert.match(html, /Justificativa da escolha/);
});
