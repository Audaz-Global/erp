const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const schema = fs.readFileSync(path.join(root, 'prisma', 'schema.prisma'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const draftPayload = fs.readFileSync(path.join(root, 'src', 'utils', 'draftPayload.ts'), 'utf8');

const fields = [
  'commodityType',
  'commoditySubtype',
  'temperatureRequirement',
  'coolingPackage',
  'temperatureTrackingStatus',
  'activeContainerStatus',
  'screeningStatus',
  'diplomaticStatus',
  'expressStatus',
  'lithiumBatteryStatus'
];

test('quotation persists optional commodity requirements', () => {
  for (const field of fields) {
    assert.match(schema, new RegExp(`\\b${field}\\s+String\\?`));
    assert.match(draftPayload, new RegExp(`\\b${field}:`));
  }
});

test('commodity fields exist in both quotation forms and their payloads', () => {
  const ids = [
    'commodity-type',
    'commodity-subtype',
    'temperature-requirement',
    'cooling-package',
    'temperature-tracking-status',
    'active-container-status',
    'screening-status',
    'diplomatic-status',
    'express-status',
    'lithium-battery-status'
  ];

  for (const id of ids) {
    assert.match(html, new RegExp(`id="r-${id}"`));
    assert.match(html, new RegExp(`id="rev-${id}"`));
  }

  assert.match(html, /collectCommodityPayload\('r'\)/);
  assert.match(html, /collectCommodityPayload\('rev'\)/);
  assert.match(html, /populateCommodityFields\('r', d\.cargo\)/);
  assert.match(html, /populateCommodityFields\('rev', q\)/);
});

test('commodity section appears after the CIP details preview', () => {
  const cipPreviewIndex = html.indexOf('id="incoterm-rules-preview"');
  const commodityPanelIndex = html.indexOf('id="r-commodity-panel"');

  assert.notEqual(cipPreviewIndex, -1);
  assert.notEqual(commodityPanelIndex, -1);
  assert.ok(commodityPanelIndex > cipPreviewIndex);
});

test('deferred SPX, CRT, PER and SHC controls were not added', () => {
  assert.doesNotMatch(html, /id="(?:r|rev)-(?:spx|crt|per|shc)"/i);
});
