// Carrega variáveis do arquivo .env primeiro
require('dotenv').config();

const { extractAgentCosts } = require('./dist/services/aiService');

async function runTest() {
  console.log('=== TESTE DE EXTRAÇÃO DE FREQUÊNCIA DE VOOS COM IA ===\n');

  console.log('GEMINI_API_KEY ativa:', process.env.GEMINI_API_KEY ? 'Sim (definida)' : 'Não');

  const simulatedAgentEmail = `
    Prezados, segue nossa cotação para o embarque aéreo:
    
    Frete Aéreo: USD 4.50/kg
    Transit Time: 5-6 dias
    Frequência dos voos: D26
    Cia Aérea: Lufthansa Cargo
    
    Taxas de Origem:
    AWB Fee: USD 50.00
    Handling: USD 75.00
    
    Aguardamos sua aprovação.
  `;

  console.log('Enviando texto simulado de e-mail do agente para a API do Gemini...');
  try {
    const result = await extractAgentCosts(simulatedAgentEmail);
    console.log('\n=== RESULTADO DA EXTRAÇÃO ===');
    console.log(JSON.stringify(result, null, 2));

    if (result.costs) {
      const freq = result.costs.frequency;
      console.log(`\nFrequência extraída: "${freq}"`);
      if (freq && (freq.includes('2x') || freq.includes('D26') || freq.includes('bi-semanal') || freq.includes('Segunda'))) {
        console.log('✅ SUCESSO: A IA identificou a frequência "D26" corretamente!');
      } else {
        console.log('❌ FALHA: A IA não identificou a frequência de forma esperada.');
      }
    } else {
      console.log('❌ FALHA: Seção costs não encontrada no resultado.');
    }
  } catch (error) {
    console.error('Erro na chamada da API:', error);
  }
}

runTest();
