const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeBatchRecipients, splitRecipientEmails, mapWithConcurrency } = require('../dist/utils/outlookBatch');

test('aceita vários e-mails para o mesmo agente e remove duplicados', () => {
  const recipients = normalizeBatchRecipients([
    { partnerName: 'Agente A', contactName: 'Pricing', email: 'ONE@example.com; two@example.com', partnerType: 'AGENTE' },
    { partnerName: 'Agente A', contactName: 'Operações', email: 'one@example.com,three@example.com', partnerType: 'AGENTE' }
  ]);
  assert.deepEqual(recipients.map(item => item.email), ['one@example.com', 'two@example.com', 'three@example.com']);
  assert.equal(recipients[0].partnerName, 'Agente A');
});

test('descarta endereços inválidos e normaliza tipo desconhecido', () => {
  assert.deepEqual(splitRecipientEmails('válido@example.com; inválido; outro@example.com'), ['válido@example.com', 'outro@example.com']);
  const recipients = normalizeBatchRecipients([{ email: 'air@example.com', partnerType: 'QUALQUER' }], 'COLOADER');
  assert.equal(recipients[0].partnerType, 'COLOADER');
});

test('executor preserva a ordem mesmo com concorrência controlada', async () => {
  const result = await mapWithConcurrency([30, 5, 15], 2, async value => {
    await new Promise(resolve => setTimeout(resolve, value));
    return value / 5;
  });
  assert.deepEqual(result, [6, 1, 3]);
});
