const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { parseEmlWithMedia } = require('../dist/services/parserService');
const { extractAgentCosts } = require('../dist/services/aiService');

async function test() {
  console.log('=== INICIANDO TESTE DE EXTRAÇÃO MULTIMODAL INLINE ===');
  
  const emlPath = path.join(__dirname, '../../ADZ-QIA26060010/RE_ ADZ _ Imp Air x EXW _ Korea x GRU _ IACIT _ PO 024158 - RFHIC.eml');
  if (!fs.existsSync(emlPath)) {
    console.error('Arquivo EML de teste não encontrado!');
    process.exit(1);
  }
  
  const buffer = fs.readFileSync(emlPath);
  const parsed = await parseEmlWithMedia(buffer);
  
  console.log(`E-mail analisado com sucesso!`);
  console.log(`Mídias/Imagens extraídas: ${parsed.mediaParts.length}`);
  
  if (parsed.mediaParts.length === 0) {
    console.error('ERRO: Nenhuma imagem inline extraída do e-mail!');
    process.exit(1);
  }
  
  console.log('Enviando texto e imagens do e-mail para extração via Gemini...');
  try {
    const result = await extractAgentCosts(parsed.text, '', '', '', parsed.mediaParts);
    console.log('\n=== RESULTADO RETORNADO PELA IA ===');
    console.log(JSON.stringify(result, null, 2));
    
    if (result && result.costs) {
      console.log('\n=== VALIDAÇÃO DE CAMPOS ===');
      console.log(`Frete Internacional (freight_value): ${result.costs.freight_value}`);
      console.log(`Moeda (freight_currency): ${result.costs.freight_currency}`);
      
      const hasCorrectFreight = result.costs.freight_value === 257.26 || result.costs.freight_value === 12.09;
      if (hasCorrectFreight) {
        console.log('✅ SUCESSO: A IA extraiu o frete correto!');
      } else {
        console.log(`❌ FALHA: O valor do frete extraído (${result.costs.freight_value}) não corresponde ao esperado.`);
      }
    } else {
      console.log('❌ FALHA: Campo costs não encontrado no resultado.');
    }
  } catch (error) {
    console.error('Erro durante a chamada da IA:', error);
  }
}

test().catch(console.error);
