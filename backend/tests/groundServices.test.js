const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeGroundServiceLegs, legacyRoadFields, groundServiceFinancialGroup } = require('../dist/services/groundServiceService');

const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
const schema = fs.readFileSync(path.join(__dirname, '../prisma/schema.prisma'), 'utf8');
const outlook = fs.readFileSync(path.join(__dirname, '../src/routes/outlookRoutes.ts'), 'utf8');
const pdf = fs.readFileSync(path.join(__dirname, '../src/services/pdfService.ts'), 'utf8');
const comparison = fs.readFileSync(path.join(__dirname, '../src/services/proposalComparisonService.ts'), 'utf8');
const outlookCron = fs.readFileSync(path.join(__dirname, '../src/services/outlookCron.ts'), 'utf8');

test('mantém DTA e rodoviário nacional como trechos independentes', () => {
  const result = normalizeGroundServiceLegs([
    { serviceType:'DTA', route:'GRU -> CLIA', partnerEmail:'dta@example.com' },
    { serviceType:'RODOVIARIO_NACIONAL', route:'CLIA -> Cliente', partnerEmail:'road@example.com' }
  ]);
  assert.equal(result.legs.length, 2);
  assert.equal(result.legs.find(item => item.serviceType === 'DTA').customsStatus, 'SOB_CONTROLE_ADUANEIRO');
  assert.equal(result.legs.find(item => item.serviceType === 'RODOVIARIO_NACIONAL').customsStatus, 'NACIONALIZADA');
});

test('migra transporte legado somente como rodoviário nacional', () => {
  const result = normalizeGroundServiceLegs(undefined, { needsTransport:true, transportRoute:'GRU x SJC', truckerValue:1000 });
  assert.equal(result.legs.length, 1);
  assert.equal(result.legs[0].serviceType, 'RODOVIARIO_NACIONAL');
  assert.equal(legacyRoadFields(result.legs).needsTransport, true);
});

test('DTA compõe frete e rodoviário compõe destino', () => {
  assert.equal(groundServiceFinancialGroup('DTA'), 'FREIGHT_COMPONENT');
  assert.equal(groundServiceFinancialGroup('RODOVIARIO_NACIONAL'), 'DESTINATION_CHARGE');
  assert.match(pdf, /leg\.serviceType === 'DTA' \? 'FREIGHT_COMPONENT' : 'DESTINATION_CHARGE'/);
});

test('interface, parâmetros, anexos e disparos são separados', () => {
  assert.match(schema, /model GroundServiceLeg/);
  assert.match(schema, /model GroundServiceTariff/);
  assert.match(html, /r-needs-dta/);
  assert.match(html, /r-needs-transport/);
  assert.match(html, /data-document-role="dta"/);
  assert.match(html, /DTA — Tarifas e Regras/);
  assert.match(html, /Rodoviário Nacional/);
  assert.match(outlook, /DTA_PROVIDER/);
  assert.match(outlook, /groundServiceResults/);
  assert.match(comparison, /\['TRUCKER','DTA_PROVIDER'\]/);
  assert.match(outlookCron, /groundServiceType/);
  assert.match(outlookCron, /DTA_PROVIDER_EMAIL/);
  assert.match(outlookCron, /TRUCKER_EMAIL/);
});
