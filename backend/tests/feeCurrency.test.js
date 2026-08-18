const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeCurrency, normalizeFee, normalizeFeeList } = require('../dist/services/feeCalculationService');
const { partnerEmailProvenance, tagPartnerCosts } = require('../dist/services/agentResponseService');

test('normaliza símbolos de real e dólar sem duplicar moedas', () => {
  assert.equal(normalizeCurrency('R$'), 'BRL');
  assert.equal(normalizeCurrency('US$'), 'USD');
  assert.equal(normalizeFee({ name:'Capatazia', value:2472.84, currency:'R$' }).currency, 'BRL');
});

test('preserva taxa explicitamente zerada', () => {
  const fees = normalizeFeeList([{ name:'Desconsolidação', value:0, totalValue:0, unitValue:0, quantity:1, billingUnit:'TOTAL_SHIPMENT', currency:'R$', explicitZero:true, applicationScope:'DESTINATION' }]);
  assert.equal(fees.length, 1);
  assert.equal(fees[0].totalValue, 0);
  assert.equal(fees[0].explicitZero, true);
  assert.equal(fees[0].currency, 'BRL');
});

test('marca custos pelo papel real do parceiro sem confundir catálogo', () => {
  assert.equal(partnerEmailProvenance('COLOADER').provenanceLabel, 'E-mail do Coloader');
  const costs = tagPartnerCosts({ destination_fees:[
    { name:'Armazenagem', value:100, sourceOrigin:'PARTNER_EMAIL' },
    { name:'Taxa tabelada', value:50, sourceOrigin:'SYSTEM_CATALOG' }
  ] }, 'COLOADER');
  assert.equal(costs.destination_fees[0].provenanceType, 'COLOADER_EMAIL');
  assert.equal(costs.destination_fees[1].provenanceType, 'SYSTEM_RATE');
});
