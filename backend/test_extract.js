const fs = require('fs');
const FormData = require('form-data');
const path = require('path');

const runTest = async () => {
  try {
    console.log('Iniciando teste da extração de cotação via IA...');

    // Caminho do arquivo .eml fornecido pelo usuário
    const emlPath = path.join(__dirname, '..', 'ADZ _ Imp Sea - FOB _ Shanghai x SSZ _ GESTAMP _  W08 (20_02) - JOUDER - MARÍTIMO.eml');
    
    if (!fs.existsSync(emlPath)) {
      console.error('Arquivo EML não encontrado:', emlPath);
      return;
    }

    const fileStream = fs.createReadStream(emlPath);
    const form = new FormData();
    form.append('files', fileStream);

    console.log('Enviando e-mail para a IA interpretar...');
    
    const axios = require('axios');
    
    const response = await axios.post('http://127.0.0.1:3001/api/extract', form, {
      headers: {
        ...form.getHeaders()
      }
    });

    const result = response.data;

    console.log('\\n✅ SUCESSO! Veja o JSON estruturado gerado pela IA:\\n');
    console.log(JSON.stringify(result.data, null, 2));
    
    // Salvar num arquivo pra o usuário ver
    fs.writeFileSync(path.join(__dirname, 'resultado_ia.json'), JSON.stringify(result.data, null, 2));
    console.log('\\nO resultado foi salvo no arquivo: backend/resultado_ia.json');

  } catch (err) {
    if (err.response) {
      console.error('Erro na API:', err.response.data);
    } else {
      console.error('Erro geral no teste:', err.message);
    }
  }
};

runTest();
