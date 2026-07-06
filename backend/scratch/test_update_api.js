const axios = require('axios');

const API = 'http://localhost:3001/api';

async function runTest() {
  console.log('=== TESTANDO API DE ATUALIZAÇÃO (PUT) DE CONTATO E TELEFONE ===');
  
  // 1. Criar cotação inicial
  const uniqueId = Date.now();
  const payload = {
    reference: `TEST-UPDATE-${uniqueId}`,
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
    clientName: `Cliente Atualizacao ${uniqueId}`,
    clientCnpj: `99.999.999/0001-${Math.floor(10 + Math.random() * 90)}`,
    clientContactName: 'Contato Inicial',
    clientContactPhone: '+55 11 1111-1111'
  };

  try {
    console.log('1. Criando cotação...');
    const resCreate = await axios.post(`${API}/quotations`, payload);
    const quotation = resCreate.data;
    console.log(`Cotação criada! ID: ${quotation.id}, Cliente ID: ${quotation.clientId}`);

    // 2. Fazer PUT com dados alterados
    console.log('\n2. Enviando PUT para atualizar contato e telefone...');
    const updatePayload = {
      ...payload,
      clientContactName: 'Contato Atualizado',
      clientContactPhone: '+55 11 2222-2222'
    };
    
    const resUpdate = await axios.put(`${API}/quotations/${quotation.id}`, updatePayload);
    console.log('Retorno do PUT status:', resUpdate.status);

    // 3. Fazer GET e verificar se o cliente foi atualizado
    console.log('\n3. Buscando cotação atualizada...');
    const resGet = await axios.get(`${API}/quotations/${quotation.id}`);
    const quotationGet = resGet.data;
    console.log('Dados do cliente após atualização:');
    console.log(`  Nome: ${quotationGet.client?.name}`);
    console.log(`  Contato: ${quotationGet.client?.contactName}`);
    console.log(`  Telefone: ${quotationGet.client?.contactPhone}`);

    if (quotationGet.client?.contactName === 'Contato Atualizado' && quotationGet.client?.contactPhone === '+55 11 2222-2222') {
      console.log('\n✅ SUCESSO: Os campos de contato foram atualizados com sucesso via PUT!');
    } else {
      console.error('\n❌ ERRO: Os campos de contato não foram atualizados.');
    }
  } catch (err) {
    console.error('Erro no teste de atualização:', err.message);
    if (err.response) {
      console.error('Resposta de erro:', err.response.data);
    }
  }
}

runTest();
