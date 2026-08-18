const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveFirstResponseContact } = require('../dist/services/contactResolutionService');

test('usa o From da primeira resposta cronológica, não a ordem dos arquivos', () => {
  const records = [
    {
      senderName: 'Segundo Contato', senderEmail: 'segundo.contato@example.com', receivedAt: '2026-08-18T13:00:00Z',
      extractedContact: { name: 'Segundo Contato', phone: '+55 11 2222-2222' }
    },
    {
      senderName: 'Stephany Cristina Gomes', senderEmail: 'stephany.gomes@example.com', receivedAt: '2026-08-18T12:00:00Z', fileName: 'primeira-resposta.eml',
      extractedContact: { name: 'Stephany Cristina Gomes', phone: '' }
    }
  ];
  const contact = resolveFirstResponseContact(records, []);
  assert.equal(contact.name, 'Stephany Cristina Gomes');
  assert.equal(contact.email, 'stephany.gomes@example.com');
  assert.equal(contact.fileName, 'primeira-resposta.eml');
  assert.equal(contact.needsReview, false);
});

test('OCR da assinatura complementa telefone somente quando confirma o remetente', () => {
  const records = [{
    senderName: 'Stephany Cristina Gomes', senderEmail: 'stephany.gomes@example.com', receivedAt: '2026-08-18T12:00:00Z',
    extractedContact: { name: 'Stephany Cristina Gomes', phone: '' }
  }];
  const ocr = [{
    isSignature: true, confidence: 0.96, name: 'Stephany Cristina Gomes', phone: '+49 811 190 317',
    company: 'Schwartz GmbH', sourceEmailIndex: 0
  }];
  const contact = resolveFirstResponseContact(records, ocr);
  assert.equal(contact.name, 'Stephany Cristina Gomes');
  assert.equal(contact.phone, '+49 811 190 317');
  assert.equal(contact.company, 'Schwartz GmbH');
  assert.equal(contact.needsReview, false);
});

test('OCR divergente não substitui nome nem fornece telefone de outra pessoa', () => {
  const records = [{
    senderName: 'Stephany Cristina Gomes', senderEmail: 'stephany.gomes@example.com',
    extractedContact: { name: 'Stephany Cristina Gomes', phone: '' }
  }];
  const ocr = [{ isSignature: true, confidence: 0.99, name: 'Outra Pessoa', phone: '+55 11 99999-9999', sourceEmailIndex: 0 }];
  const contact = resolveFirstResponseContact(records, ocr);
  assert.equal(contact.name, 'Stephany Cristina Gomes');
  assert.equal(contact.phone, '');
});
