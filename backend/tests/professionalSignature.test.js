const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { appendProfessionalSignature } = require('../dist/services/professionalSignatureService');

const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
const routes = fs.readFileSync(path.join(__dirname, '../src/routes/outlookRoutes.ts'), 'utf8');
const outlook = fs.readFileSync(path.join(__dirname, '../src/services/outlookService.ts'), 'utf8');
const schema = fs.readFileSync(path.join(__dirname, '../prisma/schema.prisma'), 'utf8');

test('assinatura profissional entra dentro do body apenas uma vez', () => {
  const signature = '<div data-audaz-professional-signature="p1"><img src="cid:signature-p1"></div>';
  const first = appendProfessionalSignature('<html><body><p>Pedido</p></body></html>', signature);
  const second = appendProfessionalSignature(first, signature);
  assert.match(first, /<p>Pedido<\/p><div data-audaz-professional-signature="p1">/);
  assert.equal((second.match(/data-audaz-professional-signature/g) || []).length, 1);
});

test('envio exige perfil selecionado e registra profissional e versão da assinatura', () => {
  assert.match(html, /professionalId: activeProfessional\.id/);
  assert.match(html, /Selecione o profissional responsável com uma assinatura JPEG/);
  assert.match(routes, /loadProfessionalSignature\(req\.body\?\.professionalId\)/);
  assert.match(routes, /professionalName:input\.professional\.name/);
  assert.match(routes, /signatureVersion:input\.professional\.signatureVersion/);
});

test('imagem JPEG é enviada inline pelo Outlook e não como assinatura genérica', () => {
  assert.match(outlook, /isInline\?: boolean/);
  assert.match(outlook, /isInline:true, contentId:attachment\.contentId/);
  assert.match(routes, /signature\.attachment/);
});

test('cadastro é perfil operacional sem senha e possui um único JPEG', () => {
  assert.match(schema, /model ProfessionalProfile/);
  assert.match(schema, /signatureImage\s+Bytes\?/);
  assert.doesNotMatch(schema.slice(schema.indexOf('model ProfessionalProfile'), schema.indexOf('}', schema.indexOf('model ProfessionalProfile'))), /password/i);
  assert.match(html, /Perfis operacionais sem senha/);
  assert.match(html, /accept="image\/jpeg,\.jpg,\.jpeg"/);
});
