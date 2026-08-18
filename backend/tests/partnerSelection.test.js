const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');

function partnerContext() {
  const filterStart = html.indexOf('function normalizePartnerSearchText');
  const filterEnd = html.indexOf('async function populateAgentDropdown');
  const typesStart = html.indexOf('function partnerTypesOf');
  const typesEnd = html.indexOf('function openAgentModal');
  const context = {};
  vm.createContext(context);
  vm.runInContext(html.slice(filterStart, filterEnd) + html.slice(typesStart, typesEnd), context);
  return context;
}

test('cotação da Coreia encontra agentes com grafias equivalentes e modal ALL', () => {
  const context = partnerContext();
  const partners = [
    { id: '1', name: 'Marksman', active: true, type: 'AGENTE', types: '["AGENTE"]', origins: 'Coréia do Sul', modals: 'ALL' },
    { id: '2', name: 'Marksm', active: true, type: 'AGENTE', types: '["AGENTE"]', origins: 'Korea, Coreia do Sul', modals: 'AIR' },
    { id: '3', name: 'China Agent', active: true, type: 'AGENTE', types: '["AGENTE"]', origins: 'China', modals: 'ALL' },
    { id: '4', name: 'Inactive', active: false, type: 'AGENTE', types: '["AGENTE"]', origins: 'Korea', modals: 'AIR' }
  ];
  const result = context.eligiblePartners(partners, { type: 'AGENTE', originCountry: 'KOREA', loadType: 'AIR_GENERAL' });
  assert.deepEqual(Array.from(result, item => item.name), ['Marksman', 'Marksm']);
});

test('filtro respeita tipo de parceiro e compatibilidade de modal', () => {
  const context = partnerContext();
  const partners = [
    { name: 'Air Agent', active: true, type: 'AGENTE', types: '["AGENTE"]', origins: 'Korea', modals: 'AIR' },
    { name: 'Sea Agent', active: true, type: 'AGENTE', types: '["AGENTE"]', origins: 'Korea', modals: 'FCL' },
    { name: 'Airline', active: true, type: 'CIA_AEREA', types: '["CIA_AEREA"]', origins: '', modals: 'AIR' }
  ];
  const result = context.eligiblePartners(partners, { type: 'AGENTE', originCountry: 'Coreia do Sul', loadType: 'AIR_GENERAL' });
  assert.deepEqual(Array.from(result, item => item.name), ['Air Agent']);
});

test('contatos transformam e-mails múltiplos em opções individuais sem duplicar', () => {
  const context = partnerContext();
  const options = context.partnerContactOptions({
    email: 'principal@example.com; operacional@example.com',
    contacts: [
      { name: 'Air', role: 'Operations', email: 'operacional@example.com' },
      { name: 'Pricing', role: 'Pricing', email: 'pricing@example.com, pricing2@example.com' }
    ]
  });
  assert.deepEqual(Array.from(options, item => item.email), [
    'operacional@example.com', 'pricing@example.com', 'pricing2@example.com', 'principal@example.com'
  ]);
});

test('busca localiza parceiro por nome, país ou e-mail do contato', () => {
  const context = partnerContext();
  const partner = { name: 'Marksman Logistics', origins: 'Coréia do Sul', email: 'geral@example.com', contacts: [{ name: 'Air Pricing', email: 'air@emkm.com' }] };
  assert.equal(context.partnerMatchesSearch(partner, 'marksman'), true);
  assert.equal(context.partnerMatchesSearch(partner, 'coreia'), true);
  assert.equal(context.partnerMatchesSearch(partner, 'air@emkm.com'), true);
  assert.equal(context.partnerMatchesSearch(partner, 'china'), false);
  assert.match(html, /id="partner-list-search"/);
});

test('proteção visual diferencia rascunho pendente de envio confirmado', () => {
  const stateStart = html.indexOf('function setDraftDispatchState');
  const stateEnd = html.indexOf('async function generateDraftEmail');
  const status = { dataset: {}, style: {}, className: '', innerHTML: '' };
  const button = { style: {}, title: '' };
  const context = { document: { getElementById: id => id === 'draftDispatchStatus' ? status : id === 'btnSendOutlook' ? button : null } };
  vm.createContext(context);
  vm.runInContext(html.slice(stateStart, stateEnd), context);

  context.setDraftDispatchState('DRAFT');
  assert.equal(status.dataset.state, 'DRAFT');
  assert.match(status.innerHTML, /ainda não enviado/i);
  assert.equal(status.className, 'status-strip warn');

  context.setDraftDispatchState('SENT', { recipient: 'air@example.com' });
  assert.equal(status.dataset.state, 'SENT');
  assert.match(status.innerHTML, /confirmado pelo servidor/i);
  assert.match(status.innerHTML, /air@example.com/);
  assert.equal(status.className, 'status-strip ok');
});

test('recomendação reutiliza o mesmo filtro e seleciona um contato do dropdown', () => {
  assert.match(html, /eligiblePartners\(agents, \{ type: currentPartnerType/);
  assert.match(html, /selectRecommendedPartner\(partner\.id, contact\.email\)/);
  assert.doesNotMatch(html, /onclick="document\.getElementById\('r-agent-email'\)\.value/);
});
