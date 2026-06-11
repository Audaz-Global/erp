const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const axios = require('axios');

async function testExtract() {
  console.log('=== TESTANDO EXTRAÇÃO DO E-MAIL VW-MQB 37 (PACK 3) ===');
  
  const emlPath = path.join(__dirname, '../VW-MQB 37/ADZ _ Imp Air - FCA _ China x GRU _ GESTAMP _ PACK 3 - 5500279920.eml');
  if (!fs.existsSync(emlPath)) {
    console.error('Arquivo não encontrado:', emlPath);
    return;
  }

  const form = new FormData();
  form.append('mode', 'CLIENT');
  form.append('files', fs.createReadStream(emlPath));

  const res = await axios.post('http://localhost:3001/api/extract', form, {
    headers: form.getHeaders()
  });

  const data = res.data.data;
  console.log('\n--- RESULTADO DA EXTRAÇÃO ---');
  console.log('Cliente:', data.client);
  console.log('Rota:', data.route);
  console.log('Carga:', data.cargo);
  console.log('\n✅ Peso Bruto extraído:', data.cargo?.gross_weight_kg, 'kg (esperado: 487)');
  console.log('✅ Volumes extraídos:', data.cargo?.packages_count, '(esperado: 2)');
  console.log('✅ Dimensões:', data.cargo?.dimensions);
}

testExtract().catch(e => {
  console.error('Erro:', e.message);
  if (e.response) console.error('Resposta:', JSON.stringify(e.response.data));
});
