const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("ERRO: GEMINI_API_KEY não definida!");
  process.exit(1);
}
const genAI = new GoogleGenerativeAI(apiKey);

async function main() {
  const files = ['image002.png', 'image003.png', 'image004.png', 'image005.jpg'];
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  for (const file of files) {
    const filePath = path.join(__dirname, file);
    if (!fs.existsSync(filePath)) {
      console.log(`Arquivo não existe: ${file}`);
      continue;
    }

    const data = fs.readFileSync(filePath);
    const base64Data = data.toString('base64');
    let mimeType = 'image/png';
    if (file.endsWith('.jpg') || file.endsWith('.jpeg')) {
      mimeType = 'image/jpeg';
    }

    console.log(`--- Analisando ${file} ---`);
    try {
      const result = await model.generateContent([
        'Descreva detalhadamente o que há nesta imagem, principalmente se houver qualquer cotação de frete, tarifas de origem/destino, valores monetários (como frete internacional, taxas locais, etc.) ou se for apenas uma imagem de assinatura/logotipo de empresa.',
        {
          inlineData: {
            data: base64Data,
            mimeType
          }
        }
      ]);
      console.log(result.response.text());
    } catch (err) {
      console.error(`Erro ao analisar ${file}:`, err.message);
    }
    console.log('\n');
  }
}

main().catch(console.error);
