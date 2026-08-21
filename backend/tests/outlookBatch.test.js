const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeBatchRecipients, splitRecipientEmails, buildCcRecipients, mapWithConcurrency } = require('../dist/utils/outlookBatch');

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

test('mantém todos os e-mails de CC, não só o primeiro depois do separador', () => {
  const recipients = normalizeBatchRecipients([
    { email: 'agente@example.com', partnerType: 'AGENTE', ccEmail: 'um@example.com; dois@example.com,tres@example.com' }
  ]);
  assert.equal(recipients[0].ccEmail, 'um@example.com; dois@example.com; tres@example.com');
});

test('CC vazio ou só com endereços inválidos vira null', () => {
  const recipients = normalizeBatchRecipients([{ email: 'agente@example.com', partnerType: 'AGENTE', ccEmail: '  ; não-é-email ' }]);
  assert.equal(recipients[0].ccEmail, null);
});

test('buildCcRecipients gera um objeto do Graph por endereço de CC', () => {
  assert.deepEqual(buildCcRecipients('um@example.com; dois@example.com'), [
    { emailAddress: { address: 'um@example.com' } },
    { emailAddress: { address: 'dois@example.com' } }
  ]);
  assert.deepEqual(buildCcRecipients(''), []);
  assert.deepEqual(buildCcRecipients(undefined), []);
});

test('dois contatos do mesmo parceiro viram 1 e-mail: o primeiro em Para, o segundo em Cc', () => {
  const recipients = normalizeBatchRecipients([
    { partnerId: 'agent-fancargo', partnerName: 'Fan Cargo', contactName: 'Rafaela', email: 'rafaela@fancargo.com', partnerType: 'AGENTE' },
    { partnerId: 'agent-fancargo', partnerName: 'Fan Cargo', contactName: 'Caroline', email: 'caroline@fancargo.com', partnerType: 'AGENTE' }
  ]);
  assert.equal(recipients.length, 1);
  assert.equal(recipients[0].email, 'rafaela@fancargo.com');
  assert.equal(recipients[0].ccEmail, 'caroline@fancargo.com');
});

test('agrupamento preserva o CC manual já digitado e não duplica endereços', () => {
  const recipients = normalizeBatchRecipients([
    { partnerId: 'agent-fancargo', partnerName: 'Fan Cargo', contactName: 'Rafaela', email: 'rafaela@fancargo.com', partnerType: 'AGENTE', ccEmail: 'vendedor@audazglobal.com' },
    { partnerId: 'agent-fancargo', partnerName: 'Fan Cargo', contactName: 'Caroline', email: 'caroline@fancargo.com', partnerType: 'AGENTE', ccEmail: 'vendedor@audazglobal.com' }
  ]);
  assert.equal(recipients.length, 1);
  assert.deepEqual(splitRecipientEmails(recipients[0].ccEmail).sort(), ['caroline@fancargo.com', 'vendedor@audazglobal.com']);
});

test('sem partnerId (ou com partnerId diferente) os contatos continuam separados, como hoje', () => {
  const semPartnerId = normalizeBatchRecipients([
    { partnerName: 'Agente A', contactName: 'Pricing', email: 'a@example.com', partnerType: 'AGENTE' },
    { partnerName: 'Agente A', contactName: 'Operações', email: 'b@example.com', partnerType: 'AGENTE' }
  ]);
  assert.equal(semPartnerId.length, 2);

  const partnerIdDiferente = normalizeBatchRecipients([
    { partnerId: 'agent-1', partnerName: 'Agente A', email: 'a@example.com', partnerType: 'AGENTE' },
    { partnerId: 'agent-2', partnerName: 'Agente B', email: 'b@example.com', partnerType: 'AGENTE' }
  ]);
  assert.equal(partnerIdDiferente.length, 2);
});

test('três contatos do mesmo parceiro: o primeiro fica em Para, os outros dois em Cc', () => {
  const recipients = normalizeBatchRecipients([
    { partnerId: 'agent-fancargo', email: 'rafaela@fancargo.com', partnerType: 'AGENTE' },
    { partnerId: 'agent-fancargo', email: 'caroline@fancargo.com', partnerType: 'AGENTE' },
    { partnerId: 'agent-fancargo', email: 'joao@fancargo.com', partnerType: 'AGENTE' }
  ]);
  assert.equal(recipients.length, 1);
  assert.equal(recipients[0].email, 'rafaela@fancargo.com');
  assert.deepEqual(splitRecipientEmails(recipients[0].ccEmail), ['caroline@fancargo.com', 'joao@fancargo.com']);
});

test('executor preserva a ordem mesmo com concorrência controlada', async () => {
  const result = await mapWithConcurrency([30, 5, 15], 2, async value => {
    await new Promise(resolve => setTimeout(resolve, value));
    return value / 5;
  });
  assert.deepEqual(result, [6, 1, 3]);
});
