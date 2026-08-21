const test = require('node:test');
const assert = require('node:assert/strict');
const { personalizeGreeting } = require('../dist/utils/draftGreeting');

test('troca a saudação genérica do agente pelo nome do destinatário principal', () => {
  const draft = 'Prezado(a) Agente,\n\nSolicitamos sua melhor cotação...';
  assert.equal(personalizeGreeting(draft, 'Cindy Chen'), 'Prezado(a) Cindy Chen,\n\nSolicitamos sua melhor cotação...');
});

test('troca a saudação genérica da transportadora e a genérica curta', () => {
  assert.equal(personalizeGreeting('Prezada Transportadora,\nTexto', 'João'), 'Prezado(a) João,\nTexto');
  assert.equal(personalizeGreeting('Prezado(a),\nTexto', 'Maria'), 'Prezado(a) Maria,\nTexto');
});

test('não mexe quando o rascunho já foi gerado personalizado (1 destinatário na geração)', () => {
  const draft = 'Prezado(a) Rafaela,\n\nSolicitamos...';
  assert.equal(personalizeGreeting(draft, 'Cindy Chen'), draft);
});

test('não mexe sem nome de contato, ou com nomes que são só rótulos internos', () => {
  const draft = 'Prezado(a) Agente,\nTexto';
  assert.equal(personalizeGreeting(draft, ''), draft);
  assert.equal(personalizeGreeting(draft, null), draft);
  assert.equal(personalizeGreeting(draft, 'Contato'), draft);
  assert.equal(personalizeGreeting(draft, 'Principal'), draft);
  assert.equal(personalizeGreeting(draft, 'E-mail adicional'), draft);
});

test('ignora linhas em branco no início do rascunho ao localizar a saudação', () => {
  const draft = '\n\nPrezado(a) Agente,\nTexto';
  assert.equal(personalizeGreeting(draft, 'Sandro'), '\n\nPrezado(a) Sandro,\nTexto');
});
