const test = require('node:test');
const assert = require('node:assert/strict');
const { detectHybridModalSignals, applyHybridModalPolicy, enforceHybridModalAcknowledgement, HybridModalError } = require('../dist/services/hybridModalService');

test('detecta sinais fortes de aéreo e marítimo/LCL no mesmo texto', () => {
  const text = 'Favor cotar o embarque.\nAWB deve ser emitido em até 2 dias.\nA outra parte segue via LCL, favor enviar o B/L assim que possível.';
  const decision = detectHybridModalSignals(text);
  assert.equal(decision.detected, true);
  assert.match(decision.airEvidence, /AWB/);
  assert.match(decision.seaEvidence, /LCL/);
});

test('não detecta quando só um dos modais aparece', () => {
  const onlyAir = detectHybridModalSignals('Favor emitir o AWB assim que possível.');
  assert.equal(onlyAir.detected, false);

  const onlySea = detectHybridModalSignals('Precisamos do B/L da carga LCL.');
  assert.equal(onlySea.detected, false);
});

test('menção incidental a transporte terrestre não dispara falso positivo', () => {
  const decision = detectHybridModalSignals('Depois de desembarcar, seguir de caminhão até o cliente. Aguardamos a cotação do frete.');
  assert.equal(decision.detected, false);
});

test('applyHybridModalPolicy combina sinal da IA com a varredura determinística (OR)', () => {
  const onlyAiFlag = { cargo: { hybrid_shipment_detected: true, hybrid_shipment_note: 'IA identificou dois embarques distintos.' } };
  applyHybridModalPolicy(onlyAiFlag, 'Texto sem termos fortes de nenhum dos dois modais.');
  assert.equal(onlyAiFlag.cargo.hybrid_shipment_detected, true);
  assert.match(onlyAiFlag.cargo.hybrid_shipment_note, /IA identificou/);

  const onlyDeterministicFlag = { cargo: {} };
  applyHybridModalPolicy(onlyDeterministicFlag, 'Emitir o AWB do embarque aéreo. A carga LCL segue com B/L à parte.');
  assert.equal(onlyDeterministicFlag.cargo.hybrid_shipment_detected, true);
  assert.ok(onlyDeterministicFlag.cargo.hybrid_shipment_air_evidence);
  assert.ok(onlyDeterministicFlag.cargo.hybrid_shipment_sea_evidence);

  const neither = { cargo: {} };
  applyHybridModalPolicy(neither, 'Cotação simples de carga aérea, sem menção a modal marítimo.');
  assert.equal(neither.cargo.hybrid_shipment_detected, false);
});

test('enforceHybridModalAcknowledgement bloqueia quando detectado e não confirmado', () => {
  assert.throws(() => enforceHybridModalAcknowledgement({ hybridModalDetected: true, hybridModalAcknowledged: false }), HybridModalError);
  assert.throws(() => enforceHybridModalAcknowledgement({ hybridModalDetected: true }), HybridModalError);
});

test('enforceHybridModalAcknowledgement libera quando confirmado ou quando não há detecção', () => {
  assert.doesNotThrow(() => enforceHybridModalAcknowledgement({ hybridModalDetected: true, hybridModalAcknowledged: true }));
  assert.doesNotThrow(() => enforceHybridModalAcknowledgement({ hybridModalDetected: false, hybridModalAcknowledged: false }));
  assert.doesNotThrow(() => enforceHybridModalAcknowledgement({}));
});
