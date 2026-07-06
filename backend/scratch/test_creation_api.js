const axios = require('axios');

const API = 'http://localhost:3001/api';

async function runTest() {
  console.log('=== TESTANDO API DE CRIAÇÃO COM CONTATO E TELEFONE ===');
  
  const payload = {
    reference: `TEST-CONTACT-${Date.now()}`,
    direction: 'IMPORT',
    modal: 'AIR',
    loadType: 'AIR_GENERAL',
    incoterm: 'FCA',
    originCity: 'Shenzhen',
    originCountry: 'China',
    originPort: 'SZX',
    destinationCity: 'Sao Paulo',
    destinationCountry: 'Brazil',
    destinationPort: 'GRU',
    totalGrossWeightKg: 100,
    totalPackages: 1,
    isImo: false,
    clientName: 'Cliente Teste Contato S.A.',
    clientCnpj: `12.345.678/0001-${Math.floor(10 + Math.random() * 90)}`,
    clientContactName: 'Felipe Santana',
    clientContactPhone: '+55 11 99999-9999'
  };

  try {
    console.log('Enviando payload de criação...');
    const res = await axios.post(`${API}/quotations`, payload);
    const quotation = res.data;
    console.log('Cotação criada com sucesso!');
    console.log(`ID: ${quotation.id}`);
    console.log(`Referência: ${quotation.reference}`);
    console.log(`Cliente ID: ${quotation.clientId}`);

    // Fazer GET na cotação para ver se retornou o cliente com contato
    console.log('\nBuscando cotação criada para verificar relação...');
    const resGet = await axios.get(`${API}/quotations/${quotation.id}`);
    const quotationGet = resGet.data;
    console.log('Dados do cliente associado retornado pela API:');
    console.log(`  Nome: ${quotationGet.client?.name}`);
    console.log(`  CNPJ: ${quotationGet.client?.cnpj}`);
    console.log(`  Contato: ${quotationGet.client?.contactName}`);
    console.log(`  Telefone: ${quotationGet.client?.contactPhone}`);

    if (quotationGet.client?.contactName === 'Felipe Santana' && quotationGet.client?.contactPhone === '+55 11 99999-9999') {
      console.log('\n✅ SUCESSO: Os campos de contato foram devidamente criados e vinculados!');
    } else {
      console.error('\n❌ ERRO: Os campos de contato não correspondem aos valores enviados.');
    }
  } catch (err) {
    console.error('Erro ao chamar API:', err.message);
    if (err.response) {
      console.error('Resposta de erro do servidor:', err.response.data);
    }
  }
}

runTest();
