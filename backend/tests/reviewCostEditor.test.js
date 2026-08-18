const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
const start = html.indexOf('function reviewCostNumber');
const end = html.indexOf('function reviewCostProvenance');
const calculationSource = html.slice(start, end);

function calculationContext(lines) {
  const context = { window: { reviewCostLines: lines } };
  vm.createContext(context);
  vm.runInContext(calculationSource, context);
  return context;
}

test('taxa percentual usa frete mais origem e converte moedas', () => {
  const percent = { billingUnit: 'PERCENTAGE', unitValue: 3, percentBase: 'FREIGHT_PLUS_ORIGIN', currency: 'USD', minValue: 0, maxValue: 0 };
  const context = calculationContext({
    freight: [{ special: 'MAIN_FREIGHT', quantity: 1, unitValue: 100, currency: 'USD' }],
    origin: [{ billingUnit: 'PER_SHIPMENT', quantity: 1, unitValue: 505, currency: 'BRL' }],
    destination: [percent]
  });
  assert.equal(context.reviewCostTotal(percent), 6);
});

test('mínimo e máximo limitam o total final da linha', () => {
  const context = calculationContext({ freight: [], origin: [], destination: [] });
  assert.equal(context.reviewCostTotal({ billingUnit:'PER_SHIPMENT', quantity:1, unitValue:10, minValue:25, maxValue:0 }), 25);
  assert.equal(context.reviewCostTotal({ billingUnit:'PER_SHIPMENT', quantity:3, unitValue:20, minValue:0, maxValue:50 }), 50);
});

test('editor mostra procedência e exclusão nas taxas aplicáveis', () => {
  assert.match(html, /cost-source-badge/);
  assert.match(html, /E-mail do agente/);
  assert.match(html, /Regra do sistema/);
  assert.match(html, /onclick="removeReviewCostLine/);
});

test('campos do editor mantêm contraste e alinhamento com a linha', () => {
  assert.match(html, /\.cost-line \{ align-items:start;/);
  assert.match(html, /\.cost-line input,\.cost-line select[^}]*color:#edf2fa;/);
  assert.match(html, /-webkit-text-fill-color:#b6c0d1/);
});
