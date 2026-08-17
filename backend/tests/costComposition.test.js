const test = require('node:test');
const assert = require('node:assert/strict');
const { shouldHydrateAutomaticCosts } = require('../dist/services/costCompositionService');

test('mantém regras automáticas antes da revisão final', () => {
  assert.equal(shouldHydrateAutomaticCosts({ costCompositionReviewed: false }), true);
  assert.equal(shouldHydrateAutomaticCosts({}), true);
});

test('usa somente as linhas aprovadas depois da revisão final', () => {
  assert.equal(shouldHydrateAutomaticCosts({ costCompositionReviewed: true }), false);
});
