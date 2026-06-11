// Teste direto da chave API contra a API REST do Google (sem biblioteca)
const https = require('https');

const API_KEY = 'AIzaSyBdMJjSU8g3t5fr3PGYSSaEYtQ-lrkLHL8';

// 1. Primeiro listar modelos disponíveis
const listModels = () => {
  return new Promise((resolve, reject) => {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) {
            console.log('❌ Erro ao listar modelos:', JSON.stringify(json.error, null, 2));
            resolve(null);
          } else {
            const modelNames = json.models?.map(m => m.name) || [];
            console.log('✅ Modelos disponíveis para esta chave:');
            modelNames.forEach(n => console.log('  -', n));
            resolve(modelNames);
          }
        } catch (e) {
          console.log('Resposta bruta:', data.substring(0, 500));
          resolve(null);
        }
      });
    }).on('error', (e) => {
      console.error('Erro de conexão:', e.message);
      reject(e);
    });
  });
};

// 2. Testar geração com um modelo
const testGenerate = (modelName) => {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      contents: [{
        parts: [{ text: 'Responda apenas: OK, funcionando.' }]
      }]
    });

    const url = new URL(`https://generativelanguage.googleapis.com/v1beta/${modelName}:generateContent?key=${API_KEY}`);
    
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) {
            console.log(`\n❌ Modelo ${modelName} FALHOU:`, json.error.message);
          } else {
            const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
            console.log(`\n✅ Modelo ${modelName} FUNCIONOU!`);
            console.log('   Resposta:', text);
          }
          resolve(json);
        } catch (e) {
          console.log('Resposta bruta:', data.substring(0, 300));
          resolve(null);
        }
      });
    });

    req.on('error', (e) => {
      console.error('Erro de conexão:', e.message);
      reject(e);
    });

    req.write(payload);
    req.end();
  });
};

const run = async () => {
  console.log('=== DIAGNÓSTICO DA CHAVE API GEMINI ===\n');
  
  // Listar modelos
  const models = await listModels();
  
  if (models && models.length > 0) {
    // Testar os modelos mais comuns
    const candidates = [
      'models/gemini-2.0-flash',
      'models/gemini-1.5-flash',
      'models/gemini-1.5-pro',
      'models/gemini-pro',
    ];
    
    const available = candidates.filter(c => models.includes(c));
    
    if (available.length > 0) {
      console.log('\n--- Testando geração com modelos disponíveis ---');
      for (const m of available.slice(0, 3)) {
        await testGenerate(m);
      }
    } else {
      console.log('\nNenhum modelo conhecido encontrado. Testando o primeiro da lista...');
      await testGenerate(models[0]);
    }
  } else {
    // Tentar direto mesmo sem listar
    console.log('\nTentando modelos direto...');
    await testGenerate('models/gemini-2.0-flash');
    await testGenerate('models/gemini-1.5-flash');
    await testGenerate('models/gemini-pro');
  }
};

run().catch(console.error);
