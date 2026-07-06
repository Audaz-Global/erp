const axios = require('axios');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const API = 'http://localhost:3001/api';

async function runTest() {
  console.log('=== TESTANDO GRAVAÇÃO DE ROTA DO AGENTE E CIA AÉREA VIA PUT ===');

  // 1. Criar cotação inicial simulando o cliente
  const reference = `TEST-AGENT-ROUTE-${Date.now()}`;
  const payloadCreate = {
    reference,
    direction: 'IMPORT',
    modal: 'AIR',
    loadType: 'AIR_GENERAL',
    incoterm: 'EXW',
    originCity: 'Wenzhou City, China',
    originCountry: 'China',
    originPort: 'WNZ - Wenzhou Airport',
    destinationCity: 'Sao Paulo',
    destinationCountry: 'Brazil',
    destinationPort: 'GRU',
    totalGrossWeightKg: 150,
    totalPackages: 1,
    isImo: false,
    clientName: 'Cliente Importador S.A.',
    clientCnpj: '11.222.333/0001-44'
  };

  try {
    console.log('1. Criando cotação original (com origem WNZ)...');
    const resCreate = await axios.post(`${API}/quotations`, payloadCreate);
    const quotation = resCreate.data;
    console.log(`Cotação criada! ID: ${quotation.id}, Origem original: ${quotation.originPort}`);

    // 2. Simular extração do agente e edições no modal final de revisão antes de gerar o PDF
    console.log('\n2. Enviando PUT simulando revisão final com dados extraídos do agente (Origem PEK, Conexões PEK-NRT-USA-GRU, Carrier KLM)...');
    const payloadUpdate = {
      reference,
      incoterm: 'FCA',
      loadType: 'AIR_GENERAL',
      modal: 'AIR',
      originCity: 'Beijing',
      originCountry: 'China',
      originPort: 'PEK - Beijing Airport',
      destinationCity: 'Sao Paulo',
      destinationCountry: 'Brazil',
      destinationPort: 'GRU',
      connections: 'PEK-NRT-USA-GRU',
      totalGrossWeightKg: 150,
      totalPackages: 1,
      carrier: 'KLM Cargo',
      clientName: 'Cliente Importador S.A.',
      clientCnpj: '11.222.333/0001-44',
      clientContactName: 'Guilherme Rota',
      clientContactPhone: '+55 11 98888-8888'
    };

    const resUpdate = await axios.put(`${API}/quotations/${quotation.id}`, payloadUpdate);
    console.log('Retorno do PUT status:', resUpdate.status);

    // 3. Buscar direto no banco usando o Prisma para validar de forma independente do cache ou da API
    console.log('\n3. Consultando diretamente no banco de dados via Prisma...');
    const qDb = await prisma.quotation.findUnique({
      where: { id: quotation.id },
      include: { client: true }
    });

    console.log('Dados salvos no banco:');
    console.log(`  Origem no Banco: ${qDb.originPort}`);
    console.log(`  Cidade de Origem no Banco: ${qDb.originCity}`);
    console.log(`  Conexões no Banco: ${qDb.connections}`);
    console.log(`  Cia Aérea (Carrier) no Banco: ${qDb.carrier}`);
    console.log(`  Contato no Banco: ${qDb.client?.contactName}`);
    console.log(`  Telefone no Banco: ${qDb.client?.contactPhone}`);

    const success = 
      qDb.originPort === 'PEK - Beijing Airport' &&
      qDb.connections === 'PEK-NRT-USA-GRU' &&
      qDb.carrier === 'KLM Cargo' &&
      qDb.client?.contactName === 'Guilherme Rota' &&
      qDb.client?.contactPhone === '+55 11 98888-8888';

    if (success) {
      console.log('\n✅ SUCESSO: Todos os dados da rota do agente, conexões, cia aérea e contatos foram salvos com perfeição!');
    } else {
      console.error('\n❌ ERRO: Alguns dados salvos no banco não condizem com a atualização enviada.');
    }
  } catch (err) {
    console.error('Erro durante o teste de rota do agente:', err.message);
    if (err.response) {
      console.error('Dados de erro do servidor:', err.response.data);
    }
  } finally {
    await prisma.$disconnect();
  }
}

runTest();
