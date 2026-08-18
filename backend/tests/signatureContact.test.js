const test = require('node:test');
const assert = require('node:assert/strict');
const { extractContactFromSignature } = require('../dist/services/parserService');

test('mantém o nome oficial do cabeçalho e prioriza o WhatsApp da assinatura da Lilian', () => {
  const body = `Boa tarde a todos

Favor enviar uma cotação considerando LCL.

Obrigada

--

Best Regards

Email address: supervisora.comex@mapmateriais.com.br

Lilian Soares Ramos da Silva
Foreign Trade Supervisor
MAP Materiais de Alta Performance LTDA
Tel: +55 12 3958-7295/+55 12 3958-2184/+55 12 3958-4615/+55 12 3958-7294 - Ramal:212

+55 12 99640-1059`;

  const contact = extractContactFromSignature(body, 'Lilian Ramos', 'supervisora.comex@mapmateriais.com.br');
  assert.equal(contact.name, 'Lilian Ramos');
  assert.equal(contact.phone, '+55 12 99640-1059');
  assert.equal(contact.email, 'supervisora.comex@mapmateriais.com.br');
});

test('não troca o remetente oficial por empresa ou e-mail encontrados no corpo', () => {
  const body = `Olá\n\nBest Regards\nSchwartz GmbH\nTel: 811 190 317\ncontato-antigo@schwartz.example`;
  const contact = extractContactFromSignature(body, 'Stephany Cristina Gomes', 'stephany.gomes@example.com');
  assert.equal(contact.name, 'Stephany Cristina Gomes');
  assert.equal(contact.email, 'stephany.gomes@example.com');
  assert.equal(contact.phone, '811 190 317');
  assert.equal(contact.source, 'SENDER_HEADER_VERIFIED');
  assert.equal(contact.needsReview, false);
});

test('bloqueia razão social como nome de pessoa', () => {
  const contact = extractContactFromSignature('Best Regards\nSchwartz GmbH\nTel: 811 190 317', 'Schwartz GmbH', 'info@schwartz.example');
  assert.equal(contact.name, '');
  assert.equal(contact.email, 'info@schwartz.example');
  assert.equal(contact.needsReview, true);
});

test('usa o último marcador de despedida e nunca o trata como nome', () => {
  const contact = extractContactFromSignature('Obrigada\n--\nBest Regards\nMaria Silva\nSales Manager', 'Maria Silva', 'maria@example.com');
  assert.equal(contact.name, 'Maria Silva');
});
