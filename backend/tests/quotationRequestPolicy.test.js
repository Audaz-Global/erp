const test = require('node:test');
const assert = require('node:assert/strict');
const { applyDomesticTransportEvidencePolicy, findExplicitDomesticTransportRequest, findExplicitDtaRequest } = require('../dist/utils/quotationRequestPolicy');

test('não cria transporte a partir de assinatura ou destino inferido', () => {
  const source = 'FOB - Shanghai - SSZ\nBest Regards\nMAP Materiais\nTel: +55 12 3958-7295';
  const extracted = { route: { destination_airport: 'Santos', destination_city: 'São José dos Campos/SP', needs_transport: true, transport_route: 'Santos x SJC' } };
  applyDomesticTransportEvidencePolicy(extracted, source);
  assert.equal(extracted.route.needs_transport, false);
  assert.equal(extracted.route.transport_route, '');
  assert.equal(extracted.route.destination_city, 'Santos');
});

test('mantém transporte quando o pedido é explícito', () => {
  const source = 'Favor incluir transporte rodoviário de Santos até São José dos Campos.';
  const decision = findExplicitDomesticTransportRequest(source);
  assert.equal(decision.requested, true);
  assert.match(decision.evidence, /transporte rodoviário/i);
});

test('separa DTA de frete rodoviário nacional', () => {
  const source = 'Favor cotar DTA de GRU para o CLIA Campinas para carga ainda não nacionalizada.';
  assert.equal(findExplicitDtaRequest(source).requested, true);
  assert.equal(findExplicitDomesticTransportRequest(source).requested, false);
  const result = applyDomesticTransportEvidencePolicy({ route:{ destination_airport:'GRU' } }, source);
  assert.equal(result.route.needs_dta, true);
  assert.equal(result.route.needs_transport, false);
});

test('permite DTA e rodoviário nacional como trechos independentes', () => {
  const source = 'Cotar DTA de GRU ao porto seco.\nApós a nacionalização, incluir frete rodoviário até Sorocaba.';
  const result = applyDomesticTransportEvidencePolicy({ route:{} }, source);
  assert.equal(result.route.needs_dta, true);
  assert.equal(result.route.needs_transport, true);
});

test('aceita endereço completo detectado pela IA quando a evidência aparece na fonte', () => {
  const source = 'Segue abaixo os dados da próxima cotação:\nProduto: peças automotivas\nEndereço: Rua das Palmeiras, 450 - Itatiba/SP\nAguardo retorno.';
  const extracted = {
    route: {
      destination_airport: 'GRU', destination_city: 'Itatiba/SP', needs_transport: true,
      transport_route: 'GRU x Itatiba/SP', transport_source: 'ADDRESS_DETECTED',
      transport_evidence: 'Rua das Palmeiras, 450 - Itatiba/SP'
    }
  };
  applyDomesticTransportEvidencePolicy(extracted, source);
  assert.equal(extracted.route.needs_transport, true);
  assert.equal(extracted.route.transport_source, 'ADDRESS_DETECTED');
  assert.equal(extracted.route.transport_route, 'GRU x Itatiba/SP');
  assert.equal(extracted.route.destination_city, 'Itatiba/SP');
});

test('rejeita endereço de coleta/entrega sugerido pela IA sem número (não é endereço completo)', () => {
  const source = 'Segue abaixo os dados da próxima cotação:\nProduto: peças automotivas\nCidade de destino: Itatiba, São Paulo\nAguardo retorno.';
  const extracted = {
    route: {
      destination_airport: 'GRU', destination_city: 'Itatiba', needs_transport: true,
      transport_route: 'GRU x Itatiba', transport_source: 'ADDRESS_DETECTED',
      transport_evidence: 'Itatiba, São Paulo'
    }
  };
  applyDomesticTransportEvidencePolicy(extracted, source);
  assert.equal(extracted.route.needs_transport, false);
  assert.equal(extracted.route.transport_route, '');
  assert.equal(extracted.route.destination_city, 'GRU');
});

test('rejeita endereço alucinado pela IA que não aparece no texto de origem', () => {
  const source = 'FOB - Shanghai - SSZ\nBest Regards\nMAP Materiais';
  const extracted = {
    route: {
      destination_airport: 'Santos', destination_city: 'Santos', needs_transport: true,
      transport_route: 'Santos x Sorocaba', transport_source: 'ADDRESS_DETECTED',
      transport_evidence: 'Rua Inventada, 999 - Sorocaba/SP'
    }
  };
  applyDomesticTransportEvidencePolicy(extracted, source);
  assert.equal(extracted.route.needs_transport, false);
  assert.equal(extracted.route.transport_route, '');
});
