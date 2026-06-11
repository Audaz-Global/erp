const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');

const API = 'http://localhost:3001/api';

async function runE2E() {
  console.log('=== INICIANDO TESTE E2E PARA COTAÇÃO ACO032 ===');

  try {
    // 1. Extrair dados do cliente a partir do eml
    console.log('\n[1/5] Extraindo dados do cliente do e-mail...');
    const clientEmlPath = path.join(__dirname, '../ACO/ACO032 - MCASSAB - MAGDA.eml');
    if (!fs.existsSync(clientEmlPath)) {
      throw new Error(`Arquivo de e-mail do cliente não encontrado: ${clientEmlPath}`);
    }

    const clientForm = new FormData();
    clientForm.append('mode', 'CLIENT');
    clientForm.append('files', fs.createReadStream(clientEmlPath));

    const clientRes = await axios.post(`${API}/extract`, clientForm, {
      headers: clientForm.getHeaders()
    });

    console.log('Dados extraídos com sucesso!');
    const clientData = clientRes.data.data;
    console.log('Cliente extraído:', clientData.client);
    console.log('Rota extraída:', clientData.route);
    console.log('Carga extraída:', clientData.cargo);
    console.log('CBM calculado:', clientData.cargo?.total_cbm);

    // Validações estritas da extração por IA
    console.log('\n--- Asserções da Extração por IA ---');
    
    const extractedIncoterm = clientData.route?.incoterm;
    console.log(`Incoterm extraído: ${extractedIncoterm} (Esperado: EXW)`);
    if (extractedIncoterm !== 'EXW') {
      throw new Error(`Erro de Asserção: Incoterm extraído foi ${extractedIncoterm}, mas deveria ser EXW`);
    }

    const extractedOriginCountry = clientData.route?.origin_country;
    console.log(`País de Origem extraído: ${extractedOriginCountry} (Esperado: Czech Republic)`);
    if (!extractedOriginCountry || !extractedOriginCountry.toLowerCase().includes('czech')) {
      throw new Error(`Erro de Asserção: País de Origem extraído foi ${extractedOriginCountry}, mas deveria ser Czech Republic (República Tcheca)`);
    }

    const extractedOriginAirport = clientData.route?.origin_airport;
    console.log(`Aeroporto de Origem extraído: ${extractedOriginAirport} (Esperado conter: PRG)`);
    if (!extractedOriginAirport || !extractedOriginAirport.includes('PRG')) {
      throw new Error(`Erro de Asserção: Aeroporto de Origem extraído foi ${extractedOriginAirport}, mas deveria conter PRG`);
    }

    const extractedDestAirport = clientData.route?.destination_airport;
    console.log(`Aeroporto de Destino extraído: ${extractedDestAirport} (Esperado conter: GRU)`);
    if (!extractedDestAirport || !extractedDestAirport.includes('GRU')) {
      throw new Error(`Erro de Asserção: Aeroporto de Destino extraído foi ${extractedDestAirport}, mas deveria conter GRU`);
    }
    console.log('Asserções da extração concluídas com SUCESSO!\n');

    // 2. Salvar cotação no banco
    console.log('\n[2/5] Criando cotação no banco...');
    
    // Detecção robusta do modal aéreo
    const typeUpper = (clientData.cargo?.type || '').toUpperCase();
    const hasAirAirport = (clientData.route?.origin_airport || '').includes('PRG') || (clientData.route?.destination_airport || '').includes('GRU');
    const isAirModal = typeUpper.includes('AIR') || typeUpper.includes('AER') || typeUpper.includes('AÉR') || hasAirAirport;
    console.log(`Detecção de modal: isAirModal = ${isAirModal} (baseado em type='${clientData.cargo?.type}' e aeroportos)`);

    const quotationPayload = {
      reference: `ACO032-TESTE-${Date.now()}`,
      direction: 'IMPORT',
      modal: isAirModal ? 'AIR' : 'SEA',
      loadType: isAirModal ? 'AIR_GENERAL' : (clientData.cargo?.type || 'FCL_40'),
      incoterm: clientData.route?.incoterm || 'EXW',
      originCity: clientData.route?.origin_city || 'Pribyslav',
      originCountry: clientData.route?.origin_country || 'Czech Republic',
      originPort: clientData.route?.origin_airport || 'PRG - Prague Ruzyne International',
      destinationCity: clientData.route?.destination_city || 'Jacareí',
      destinationCountry: clientData.route?.destination_country || 'Brazil',
      destinationPort: clientData.route?.destination_airport || 'GRU - Aeroporto Internacional Guarulhos',
      totalGrossWeightKg: clientData.cargo?.gross_weight_kg || 190.0,
      totalPackages: clientData.cargo?.packages_count || 1,
      isImo: clientData.cargo?.is_imo || false,
      commercialValue: clientData.cargo?.commercial_value_usd || null,
      packages: clientData.cargo?.dimensions ? clientData.cargo.dimensions.join(', ') : null,
      status: 'SOLICITADO',
      clientName: clientData.client?.name || 'MCASSAB',
      clientCnpj: clientData.client?.cnpj || null,
      sourceEmails: JSON.stringify([clientRes.data.rawText])
    };

    const quotationRes = await axios.post(`${API}/quotations`, quotationPayload);
    const quotation = quotationRes.data;
    const quotationId = quotation.id;
    console.log(`Cotação criada com ID: ${quotationId}`);

    // 3. Atualizar para "Aguardando Agente"
    console.log('\n[3/5] Gerando rascunho de e-mail e atualizando fase...');
    const draftRes = await axios.post(`${API}/extract/draft/${quotationId}`);
    console.log('Rascunho de E-mail Gerado:\n', draftRes.data.draft);

    await axios.put(`${API}/quotations/${quotationId}/phase`, {
      status: 'AGUARDANDO_AGENTE',
      agentEmail: 'pricing@agente.com'
    });
    console.log('Cotação alterada para AGUARDANDO_AGENTE.');

    // 4. Extrair custos do agente
    console.log('\n[4/5] Extraindo custos do retorno do agente...');
    const agentEmlPath = path.join(__dirname, '../ACO/RE_ ADZ _ Imp Air - EXW _ Czech Republic x GRU _ ACO _ ACO032 .eml');
    if (!fs.existsSync(agentEmlPath)) {
      throw new Error(`Arquivo de e-mail do agente não encontrado: ${agentEmlPath}`);
    }

    const agentForm = new FormData();
    agentForm.append('mode', 'AGENT');
    agentForm.append('quotationId', quotationId);
    agentForm.append('files', fs.createReadStream(agentEmlPath));

    const agentRes = await axios.post(`${API}/extract`, agentForm, {
      headers: agentForm.getHeaders()
    });

    console.log('Custos extraídos com sucesso!');
    const agentCosts = agentRes.data.data;
    console.log('Custos extraídos do agente:', agentCosts.costs);

    // 5. Validar e gerar o PDF e a visualização web
    console.log('\n[5/5] Aprovando cotação e gerando PDF com Desembaraço INCLUSO...');
    const approvePayload = {
      status: 'APPROVED',
      customsClearanceIncluded: true,
      transitTimeDays: agentCosts.costs.transit_time_days || null,
      costs: {
        freight_usd: agentCosts.costs.freight_usd || 0,
        iof_usd: agentCosts.costs.iof_usd || 0,
        storage_brl: agentCosts.costs.storage_brl || 0,
        services_brl: agentCosts.costs.services_brl || 0,
        taxes_brl: agentCosts.costs.taxes_brl || 0,
        total_brl: agentCosts.costs.total_brl || 0
      }
    };

    await axios.put(`${API}/quotations/${quotationId}/phase`, approvePayload);
    console.log('Cotação Aprovada!');

    console.log('\nTestando rota de visualização web pública em BRL...');
    const viewRes = await axios.get(`${API}/quotations/${quotationId}/view`);
    console.log('Versão Web Pública obtida. Tamanho da resposta:', viewRes.data.length, 'bytes');

    // Validações estritas na visualização pública web
    console.log('\n--- Asserções da Página Pública Web ---');
    
    const hasDesembaraco = viewRes.data.includes('Desembaraço Aduaneiro');
    console.log('O desembaraço aduaneiro está na página web?', hasDesembaraco ? 'SIM (Correto!)' : 'NÃO (Erro!)');
    if (!hasDesembaraco) throw new Error('Erro de Asserção: Desembaraço Aduaneiro ausente no HTML');

    const hasCambioAlert = viewRes.data.includes('Aviso de Variação Cambial');
    console.log('O aviso de variação cambial está na página web?', hasCambioAlert ? 'SIM (Correto!)' : 'NÃO (Erro!)');
    if (!hasCambioAlert) throw new Error('Erro de Asserção: Aviso de Variação Cambial ausente no HTML');

    const hasEXW = viewRes.data.includes('EXW');
    console.log('O Incoterm EXW está na rota da página web?', hasEXW ? 'SIM (Correto!)' : 'NÃO (Erro!)');
    if (!hasEXW) throw new Error('Erro de Asserção: Incoterm EXW ausente no HTML');

    const hasPRG = viewRes.data.includes('PRG');
    console.log('O Aeroporto PRG de origem está no HTML?', hasPRG ? 'SIM (Correto!)' : 'NÃO (Erro!)');
    if (!hasPRG) throw new Error('Erro de Asserção: Aeroporto PRG ausente no HTML');

    const hasCzech = viewRes.data.toUpperCase().includes('CZECH REPUBLIC');
    console.log('O país de origem Czech Republic está no HTML?', hasCzech ? 'SIM (Correto!)' : 'NÃO (Erro!)');
    if (!hasCzech) throw new Error('Erro de Asserção: País de Origem Czech Republic ausente no HTML');

    const hasGRU = viewRes.data.includes('GRU');
    console.log('O Aeroporto GRU de destino está no HTML?', hasGRU ? 'SIM (Correto!)' : 'NÃO (Erro!)');
    if (!hasGRU) throw new Error('Erro de Asserção: Aeroporto GRU ausente no HTML');
    
    console.log('Asserções da página pública web concluídas com SUCESSO!\n');

    // Gerar e salvar o PDF localmente
    console.log('\nBaixando o PDF gerado pela API...');
    const pdfRes = await axios.get(`${API}/quotations/${quotationId}/pdf`, { responseType: 'arraybuffer' });
    const localPdfPath = path.join(__dirname, '../ACO/ACO032_gerado_teste.pdf');
    
    try {
      fs.writeFileSync(localPdfPath, pdfRes.data);
      console.log(`PDF salvo com sucesso em: ${localPdfPath}`);
    } catch (writeErr) {
      console.warn(`Aviso: Não foi possível sobrescrever o PDF em ${localPdfPath} (pode estar aberto e bloqueado por outro programa):`, writeErr.message);
      // Fallback para arquivo com timestamp
      const altPdfPath = path.join(__dirname, `../ACO/ACO032_gerado_teste_${Date.now()}.pdf`);
      fs.writeFileSync(altPdfPath, pdfRes.data);
      console.log(`Cópia do PDF de teste salva com timestamp em: ${altPdfPath}`);
    }

    console.log('\n=== TESTE COMPLETADO COM SUCESSO! ===');
  } catch (error) {
    console.error('Erro durante o teste E2E:', error.message);
    if (error.response) {
      console.error('Dados de resposta de erro:', error.response.data);
    }
    process.exit(1);
  }
}

runE2E();
