const test = require('node:test');
const assert = require('node:assert/strict');
const { extractContactFromSignature } = require('../dist/services/parserService');

test('extrai o nome e prioriza o WhatsApp da assinatura da Lilian', () => {
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
  assert.equal(contact.name, 'Lilian Soares Ramos da Silva');
  assert.equal(contact.phone, '+55 12 99640-1059');
  assert.equal(contact.email, 'supervisora.comex@mapmateriais.com.br');
});

test('usa o último marcador de despedida e nunca o trata como nome', () => {
  const contact = extractContactFromSignature('Obrigada\n--\nBest Regards\nMaria Silva\nSales Manager', 'Maria Silva', 'maria@example.com');
  assert.equal(contact.name, 'Maria Silva');
});
