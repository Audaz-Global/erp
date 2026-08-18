const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const routes = fs.readFileSync(path.join(__dirname, '../src/routes/outlookRoutes.ts'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
const batchStart = routes.indexOf("router.post('/send-draft-batch'");
const legacyStart = routes.indexOf("router.post('/send-draft'", batchStart);
const batchRoute = routes.slice(batchStart, legacyStart);

test('envio múltiplo mantém uma única cotação e cria conversas individuais', () => {
  assert.ok(batchStart >= 0);
  assert.match(batchRoute, /mapWithConcurrency\(recipients, 3/);
  assert.match(batchRoute, /sendOutlookEmail\(recipient\.email/);
  assert.match(batchRoute, /recordSuccessfulDispatch/);
  assert.doesNotMatch(batchRoute, /quotation\.create/);
  assert.match(batchRoute, /prisma\.quotation\.update/);
});

test('transportadora é enviada uma vez e não repete quando já acionada', () => {
  assert.match(batchRoute, /quotation\.truckerSentAt/);
  assert.match(batchRoute, /allowTruckerResend/);
  assert.match(batchRoute, /Transportadora já acionada anteriormente/);
});

test('fluxo antigo não clona cotação sem autorização explícita', () => {
  assert.match(routes, /req\.body\?\.legacyClone === true/);
});

test('tela envia lote, mostra resultados e reenvia somente falhas', () => {
  assert.match(html, /\/outlook\/send-draft-batch/);
  assert.match(html, /selectedPartnerRecipients/);
  assert.match(html, /partner-dispatch-results/);
  assert.match(html, /Reenviar somente as falhas/);
  assert.match(html, /pendingPartnerRecipients\(\)/);
});
