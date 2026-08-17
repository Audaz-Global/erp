const test = require('node:test');
const assert = require('node:assert/strict');
const {
  applyStorageEstimateRequestPolicy,
  ensureStorageEstimateRequest,
  findExplicitStorageEstimateRequest,
  storageEstimatePdfFee
} = require('../dist/services/storageEstimateService');

test('identifica a solicitação de estimativa de armazenagem da Lilian', () => {
  const decision = findExplicitStorageEstimateRequest('Carga não empilhável\nFavor enviar a estimativa de armazenagem\nObrigada');
  assert.equal(decision.requested, true);
  assert.equal(decision.evidence, 'Favor enviar a estimativa de armazenagem');

  const extracted = { cargo: {} };
  applyStorageEstimateRequestPolicy(extracted, decision.evidence);
  assert.equal(extracted.cargo.requires_storage_estimate, true);
});

test('garante o pedido no rascunho mesmo quando a IA o omite', () => {
  const draft = ensureStorageEstimateRequest('Favor cotar o frete LCL.', true);
  assert.match(draft, /estimativa de armazenagem no destino/i);
  assert.equal((draft.match(/armazenagem/gi) || []).length, 1);
});

test('gera linha de PDF para piso LCL e para valor pendente', () => {
  const fallback = storageEstimatePdfFee({ requested: true, value: 5700, source: 'MINIMUM_FALLBACK' });
  assert.match(fallback.name, /Piso mínimo LCL/i);
  assert.equal(fallback.total, 'BRL 5700.00');

  const pending = storageEstimatePdfFee({ requested: true, value: null });
  assert.match(pending.name, /A confirmar/i);
  assert.equal(pending.total, 'A confirmar');
});
