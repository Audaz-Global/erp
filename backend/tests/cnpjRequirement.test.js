const test = require('node:test');
const assert = require('node:assert/strict');
const { requiresCnpj, enforceCnpjRequirement, CnpjRequiredError } = require('../dist/services/cnpjRequirementService');

test('CNPJ é obrigatório em cotações LCL', () => {
  assert.equal(requiresCnpj({ loadType: 'LCL' }), true);
  assert.equal(requiresCnpj({ loadType: 'lcl' }), true);
  assert.equal(requiresCnpj({ loadType: 'FCL_20' }), false);
});

test('CNPJ é obrigatório quando a estimativa de armazenagem é solicitada, independente do loadType', () => {
  assert.equal(requiresCnpj({ loadType: 'AIR_GENERAL', requiresStorageEstimate: true }), true);
  assert.equal(requiresCnpj({ loadType: 'AIR_GENERAL', requiresStorageEstimate: false }), false);
});

test('enforceCnpjRequirement não bloqueia quando CNPJ está preenchido', () => {
  assert.doesNotThrow(() => enforceCnpjRequirement({ loadType: 'LCL', clientCnpj: '00.000.000/0000-00' }));
});

test('enforceCnpjRequirement bloqueia LCL sem CNPJ', () => {
  assert.throws(() => enforceCnpjRequirement({ loadType: 'LCL', clientCnpj: '' }), CnpjRequiredError);
  assert.throws(() => enforceCnpjRequirement({ loadType: 'LCL', clientCnpj: '   ' }), CnpjRequiredError);
  assert.throws(() => enforceCnpjRequirement({ loadType: 'LCL', clientCnpj: null }), CnpjRequiredError);
});

test('enforceCnpjRequirement bloqueia armazenagem solicitada sem CNPJ mesmo fora de LCL', () => {
  assert.throws(() => enforceCnpjRequirement({ loadType: 'FCL_40', requiresStorageEstimate: true, clientCnpj: '' }), CnpjRequiredError);
});

test('enforceCnpjRequirement não bloqueia quando nada exige CNPJ', () => {
  assert.doesNotThrow(() => enforceCnpjRequirement({ loadType: 'FCL_40', requiresStorageEstimate: false, clientCnpj: '' }));
  assert.doesNotThrow(() => enforceCnpjRequirement({ loadType: 'AIR_GENERAL', clientCnpj: undefined }));
});
