import { GoogleGenerativeAI } from '@google/generative-ai';
import * as path from 'path';
import * as fs from 'fs';
import * as XLSX from 'xlsx';
import { parsePackages } from '../utils/cargoUtils';

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.warn("WARNING: GEMINI_API_KEY environment variable is not defined.");
}
const genAI = new GoogleGenerativeAI(apiKey || '');


function getExcelPath() {
  const paths = [
    path.join(__dirname, '..', '..', 'Taxas locais Armadores 2026.xlsx'),
    path.join(process.cwd(), '..', 'Taxas locais Armadores 2026.xlsx'),
    path.join(process.cwd(), 'Taxas locais Armadores 2026.xlsx'),
  ];
  for (const p of paths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export function readLocalFeesTable(): string {
  try {
    const excelPath = getExcelPath();
    if (!excelPath) return 'Planilha de Taxas Locais de Armadores não encontrada.';

    const workbook = XLSX.readFile(excelPath);
    let text = 'TABELA DE TAXAS LOCAIS DE DESTINO POR ARMADOR (2026):\n\n';

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) continue;
      
      const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1 });
      text += `Armador: ${sheetName.trim()}\n`;
      
      for (let i = 2; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length === 0) continue;
        
        const taxName = String(row[0] || '').trim();
        if (!taxName) continue;
        
        const nameUpper = taxName.toUpperCase();
        if (
          nameUpper.includes('ADICIONAL') || 
          nameUpper.includes('ADICIONAIS') || 
          nameUpper.includes('ADICONAIS') ||
          nameUpper.includes('ADICIONA')
        ) {
          break;
        }
        
        const val20 = row[1];
        const val40 = row[3];
        const unit = String(row[2] || '').trim();
        
        text += `- ${taxName}: 20' = R$ ${val20 || 0}, 40' = R$ ${val40 || 0} (${unit})\n`;
      }
      text += '\n';
    }
    return text;
  } catch (error) {
    console.error('Erro ao ler a tabela de taxas locais do Excel:', error);
    return 'Não foi possível ler as taxas locais do Excel.';
  }
}

function calculateCbmFromDimensions(dimensionsStr: string | string[], packagesCount: number = 1): number {
  if (!dimensionsStr) return 0;
  
  const dims = Array.isArray(dimensionsStr) ? dimensionsStr : [dimensionsStr];
  let totalCbm = 0;
  
  for (const dim of dims) {
    if (!dim) continue;
    const parsedPkgs = parsePackages(dim, dims.length === 1 ? packagesCount : 1);
    for (const pkg of parsedPkgs) {
      const vol = (pkg.length / 100) * (pkg.width / 100) * (pkg.height / 100) * pkg.qty;
      totalCbm += vol;
    }
  }
  
  return parseFloat(totalCbm.toFixed(3));
}

// Retry com backoff exponencial para lidar com 429 temporários da API Gemini
async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  const delays = [5000, 10000, 20000];
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      const is429 = error?.message?.includes('429') || error?.message?.includes('Too Many Requests');
      const isBilling = error?.message?.includes('prepayment') || error?.message?.includes('depleted');
      
      // Se for 429 temporário (rate limit), tenta novamente
      if (is429 && !isBilling && attempt < maxAttempts - 1) {
        const wait = delays[attempt] || 20000;
        console.warn(`[Gemini] 429 recebido. Tentativa ${attempt + 1}/${maxAttempts}. Aguardando ${wait/1000}s...`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      // Se for billing (créditos esgotados) ou última tentativa, lança imediatamente
      throw error;
    }
  }
  throw new Error('Máximo de tentativas atingido');
}

export const extractClientData = async (text: string, contextRules: string = '', mediaParts: any[] = []) => {

  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'object',
          properties: {
            reference: { type: 'string' },
            client: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                cnpj: { type: 'string' },
                contact_name: { type: 'string', description: 'Nome do contato do cliente' },
                contact_phone: { type: 'string', description: 'Telefone do contato do cliente' },
                confidence: { type: 'number' }
              },
              required: ['name']
            },
            route: {
              type: 'object',
              properties: {
                incoterm: { type: 'string', description: 'O incoterm solicitado (ex: EXW, FCA, FOB, DAP) extraído da solicitação, tabela de resumo de informações básicas ou do corpo do e-mail.' },
                origin_city: { type: 'string', description: 'Local Inicial de coleta da carga (Cidade/Estado/País)' },
                origin_country: { type: 'string', description: 'País do porto ou aeroporto de origem' },
                origin_airport: { type: 'string', description: 'Porto ou Aeroporto de Origem (formato IATA para aeroporto, ex: WNZ - Wenzhou)' },
                destination_city: { type: 'string', description: 'Destino Final de entrega da carga (Cidade/Estado/País)' },
                destination_country: { type: 'string', description: 'País do porto ou aeroporto de destino' },
                destination_airport: { type: 'string', description: 'Porto ou Aeroporto de Destino (formato IATA para aeroporto, ex: GRU - Guarulhos)' },
                connections: { type: 'string', description: 'Conexões do voo (ex: via MIA) ou escalas de porto (ex: transbordo em Algeciras). Retorne string vazia se for direto.' },
                confidence: { type: 'number' }
              },
              required: [
                'incoterm',
                'origin_city',
                'origin_country',
                'origin_airport',
                'destination_city',
                'destination_country',
                'destination_airport',
                'connections'
              ]
            },
            cargo: {
              type: 'object',
              properties: {
                type: { 
                  type: 'string', 
                  description: 'Modal/tipo de carga. Retorne OBRIGATORIAMENTE um destes valores: "AIR_GENERAL" (se o embarque for Aéreo/Air), "LCL" (se marítimo consolidado), "FCL_20" (se marítimo container de 20 pés), "FCL_40" (se marítimo container de 40 pés). Nunca retorne o nome do produto ou mercadoria neste campo.' 
                },
                gross_weight_kg: { type: 'number' },
                packages_count: { type: 'number' },
                dimensions: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Lista de dimensões de cada lote de caixas/volumes. Cada item do array DEVE obrigatoriamente iniciar com a quantidade correspondente de caixas daquela dimensão no formato "QTDx CxLxA cm" (ex: "1x 50*50*28 cm", "2x 50*50*13 cm", "3x 37.5*31*37 cm" e "9x 63x41.5x38 cm").'
                },
                commercial_value_usd: { type: 'number', description: 'Valor comercial numérico da carga. Se a moeda original for EUR, BRL ou GBP, ignore a sigla e retorne apenas o número puro (ex: 2610.00). Não faça conversão cambial.' },
                is_imo: { type: 'boolean' },
                requires_insurance: { 
                  type: 'boolean', 
                  description: 'Se o cliente solicitou ou mencionou seguro no e-mail (ex: "com seguro", "frete com seguro"). Se disser "sem seguro" ou não houver menção, retorne false.' 
                },
                confidence: { type: 'number' }
              },
              required: ['type', 'gross_weight_kg', 'packages_count', 'dimensions']
            }
          },
          required: ['client', 'route', 'cargo']
        } as any
      }
    });

    const prompt = `Você é um especialista em comércio exterior brasileiro.
    Analise a SOLICITAÇÃO DO CLIENTE e os documentos anexos para extrair os dados principais.
    NÃO se preocupe com custos ou valores de frete, pois isso será cotado depois com os agentes.

    CONTEXTO DE REGRAS DE NEGÓCIO:
    ${contextRules}

    DOCUMENTO(S) / SOLICITAÇÃO:
    ${text}

    Instruções Importantes para Rota, Incoterm, Portos/Aeroportos, Cidades e Conexões:
    - **Incoterm — PRIORIDADE CRÍTICA**: Identifique e extraia OBRIGATORIAMENTE o Incoterm (ex: EXW, FCA, FOB, CIF, DAP, etc) de qualquer lugar dos documentos, seja do texto corrido do e-mail, de imagens coladas, de tabelas de informações básicas, Invoices ou formulários anexados (ex: "FCA Planta do Fornecedor"). Se as palavras FCA, EXW, FOB ou similar aparecerem, capture-as imediatamente.
    - **Incoterm — Regra geral**: Analise se há um endereço de coleta detalhado (fábrica/fornecedor) no exterior. Em caso afirmativo (especialmente se o modal for Aéreo), defina o Incoterm como **EXW** ou **FCA** — nunca use "FOB" genérico de planilha de valor comercial.
    - **Origem (Porto ou Aeroporto)**: Identifique o porto ou aeroporto de origem do frete principal. Se modal for Aéreo, infira o aeroporto internacional no formato "IATA - Nome do Aeroporto" (ex: "SZX - Shenzhen Bao'an International", "PRG - Prague Ruzyne International"). Se modal for Marítimo, identifique o porto de embarque internacional. Salve em "origin_airport".
    - **Destino (Porto ou Aeroporto)**: Identifique o porto ou aeroporto de destino. Se modal for Aéreo, infira no formato "IATA - Nome do Aeroporto" (ex: "GRU - Aeroporto Internacional Guarulhos"). Se modal for Marítimo, identifique o porto de descarga (ex: "Santos"). Salve em "destination_airport".
    - **Local Inicial (Cidade/Estado/País)**: Identifique a cidade, estado e país onde a carga está localizada e será coletada inicialmente no fornecedor (ex: "Pribyslav, República Tcheca" ou "Shenzhen, China"). Salve em "origin_city".
    - **Destino Final (Cidade/Estado/País)**: Identifique a cidade, estado e país final de entrega da mercadoria para o importador (ex: "Jacareí, SP, Brasil"). Salve em "destination_city".
    - **País**: Extraia o nome do país de origem e de destino correspondente à origem e destino principais no exterior/Brasil por extenso (ex: "CHINA" e "BRASIL"). Salve em "origin_country" e "destination_country".
    - **Conexões do Voo ou do Porto**: Identifique se há menção a escalas, aeroportos de conexão intermediários (ex: via MIA, via FRA) ou portos de escala/transbordo (ex: transbordo em Algeciras). Salve essa informação em "connections". Caso o embarque seja direto e sem conexões, retorne string vazia "".

    Instruções Importantes para Carga/Equipamento Especial:
    - Analise se a solicitação do cliente ou os documentos mencionam siglas ou equipamentos especiais de contêineres, como Open Top (OT), High Cube (HC), Flat Rack, etc.
    - Se encontrar tais siglas ou especificações (e.g. "40' OT HC", "Open Top", "High Cube", "OP e HC"), aplique as regras explicadas no CONTEXTO (como "Sigla E-mail (4 x 40' OT HC)" etc.).
    - Como o tipo do cargo ("type") é limitado no schema do JSON, certifique-se de registrar a especificação especial do contêiner (como "Container de 40' Open Top High Cube" ou similar) como um item de texto dentro da lista de "dimensions" para que essa informação essencial não se perca na extração.
    - **Modal/Tipo de Carga**: O campo "cargo.type" DEVE ser classificado estritamente como um dos seguintes: "AIR_GENERAL" (se o modal for Aéreo/Air), "LCL" (se marítimo consolidado/LCL), "FCL_20" (se marítimo container de 20') ou "FCL_40" (se marítimo container de 40'). NUNCA preencha este campo com o nome da mercadoria (como "parts" ou "wooden box").

    - **Instruções Importantes para Peso Bruto (gross_weight_kg), Volumes (packages_count), Valor Comercial (commercial_value_usd) e Dimensões (dimensions):**
    - **Prioridade do peso**: Se o corpo do e-mail do cliente mencionar explicitamente o peso TOTAL consolidado de todas as cargas do embarque, utilize esse valor.
    - **Cuidado com PDFs de packing list**: Tabelas de packing list em PDF frequentemente têm colunas grudadas na extração de texto (por exemplo, "2371" pode ser na verdade "237 kg" do gross weight + "1" da coluna de quantidade seguinte, ou "2501" = "250 kg" + "1"). NÃO some os números internos de cada item da tabela diretamente se houver um total explícito nela ou se houver um arquivo de packing list de imagem anexo legível.
    - **packages_count**: O número de volumes/caixas físicas do embarque (ex: 3 wooden boxes), NÃO a quantidade de peças individuais dentro das caixas (que podem ser 100 pcs, 20000 pcs etc.).
    - **Dimensões com Quantidade (CRÍTICO)**: Cada item no array "dimensions" DEVE obrigatoriamente iniciar com a quantidade de volumes correspondente àquela dimensão usando o formato "[Quantidade]x [Comprimento]x[Widht]x[Altura] cm" (ex: "1x 50x50x28 cm", "2x 50x50x13 cm", "3x 37.5*31*37 cm" e "9x 63x41.5x38 cm"). Se a quantidade não for colocada na frente de cada dimensão, a cubagem acumulada falhará.
    - **Somente Extrair Itens com Dimensões Explícitas (CRÍTICO)**: Ao extrair o array de "dimensions", inclua APENAS as caixas/paletes que tenham medidas/dimensões explicitamente detalhadas no texto do e-mail ou documentos. Se um item (como Europacks, NPS400, etc.) for apenas mencionado por nome sem nenhuma dimensão explícita, NÃO tente deduzir nem criar dimensões artificiais para ele, pois supõe-se que ele já esteja consolidado e empilhado dentro dos paletes principais que possuem medidas informadas.
    - **Seguro (requires_insurance)**: Identifique se o e-mail original do cliente pede "com seguro", "frete com seguro", ou similar. Se sim, defina "requires_insurance" como true. Se pedir "sem seguro" ou não mencionar nada sobre seguro, defina como false.
    - **Múltiplos Shippers / Consolidação (CRÍTICO)**: Se a solicitação ou os anexos contiverem dados de múltiplos fornecedores (shippers), invoices ou packing lists distintos (ex: Shipper Yongsheng e Shipper Todenko no mesmo embarque/e-mail), você DEVE consolidar todas as cargas:
      1. Some os pesos brutos (gross_weight_kg) de todos os fornecedores (ex: 41.05 kg da Yongsheng + 113.40 kg da Todenko = 154.45 kg).
      2. Some a quantidade total de caixas/volumes (packages_count) de todos eles (ex: 3 caixas da Yongsheng + 9 caixas da Todenko = 12 volumes).
      3. Some o valor comercial total de todas as invoices. ATENÇÃO: O campo chama-se commercial_value_usd, mas se o documento estiver em EUR, BRL, GBP, ou qualquer outra moeda, extraia APENAS o valor numérico (ex: se for EUR 2610.00, retorne 2610). Não tente converter moedas.
      4. Junte todas as dimensões/medidas das caixas de todos os fornecedores (cada uma com seu respectivo multiplicador de quantidade na frente!) em uma lista consolidada única de dimensions.

    Retorne o JSON estruturado conforme o schema fornecido nas configurações de geração.`;

    const contentPayload = mediaParts.length > 0
      ? [prompt, ...mediaParts.map(p => ({ inlineData: p.inlineData }))]
      : [prompt];

    const result = await model.generateContent(contentPayload);
    const parsed = JSON.parse(result.response.text().trim());
    if (parsed.cargo) {
      const packagesCount = parseInt(parsed.cargo.packages_count, 10) || 1;
      const dims = parsed.cargo.dimensions || [];
      const computedCbm = calculateCbmFromDimensions(dims, packagesCount);
      parsed.cargo.total_cbm = computedCbm || null;
    }
    return parsed;
  } catch (error: any) {
    console.error('[extractClientData] ERRO REAL:', error?.message || error);
    if (error?.response) console.error('[extractClientData] API response:', JSON.stringify(error.response));
    throw new Error('Falha ao processar dados do cliente com IA: ' + (error?.message || String(error)));
  }
};

export const generateAgentDraft = async (data: any, contextRules: string = '', contactName?: string, draftLanguage?: string) => {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const greeting = contactName ? `Inicie o email saudando o contato exatamente assim: Prezado(a) ${contactName},` : `Inicie o email com: Prezado(a) Agente,`;
    
    let languageInstruction = 'Escreva o e-mail em Português (Brasil).';
    if (draftLanguage === 'ENGLISH') {
      languageInstruction = 'Escreva o e-mail INTEIRAMENTE EM INGLÊS. Formate a mensagem de acordo com os padrões comerciais da língua inglesa.';
    } else if (draftLanguage === 'PORTUGUESE') {
      languageInstruction = 'Escreva o e-mail inteiramente em Português (Brasil).';
    } else if (draftLanguage === 'ORIGIN') {
      languageInstruction = `Identifique o idioma oficial e primário do país de origem (${data.originCountry || 'não especificado'}). Escreva o e-mail inteiro nesse idioma (Ex: Se for França, escreva em Francês. Se for Espanha, em Espanhol). Exceção: Se o país de origem for de língua não latina (ex: China, Japão, Coreia, etc) ou se for indeterminado, escreva em INGLÊS.`;
    }

    const prompt = `Você é um agente de pricing escrevendo um e-mail para solicitar cotação de frete internacional a um coloader/agente.
    ${greeting}
    
    INSTRUÇÃO CRÍTICA DE IDIOMA:
    ${languageInstruction}

    Use os dados abaixo e o e-mail original (se disponível) para redigir o corpo do e-mail.

    REGRAS E DIRETRIZES DE NEGÓCIO IMPORTANTES:
    ${contextRules}
    
    DADOS EXTRAÍDOS DA CARGA:
    - Origem (Porto/Aeroporto): ${data.originPort || 'TBD'}
    - Destino (Porto/Aeroporto): ${data.destinationPort || 'TBD'}
    - Local Inicial (Coleta): ${data.originCity || 'TBD'}
    - Destino Final (Entrega): ${data.destinationCity || 'TBD'}
    - Conexões (Voo/Porto): ${data.connections || 'Sem conexões (direto)'}
    - Incoterm: ${data.incoterm || 'TBD'}
    - Modal: ${data.modal === 'AIR' ? 'Aéreo (AIR)' : data.modal === 'SEA' ? 'Marítimo (SEA)' : data.modal || 'TBD'}
    - Modal/Tipo: ${data.loadType || 'TBD'}
    - Peso Bruto: ${data.totalGrossWeightKg || 'TBD'} kg
    - Volumes: ${data.totalPackages || 'TBD'}
    - Dimensões/CBM: ${data.packages || 'Não informado'}
    - Valor da Carga: ${data.commercialValue ? '$' + data.commercialValue : 'Não informado'}
    - IMO: ${data.isImo ? 'SIM' : 'NÃO'}
    ${data.reference ? `- Referência: ${data.reference}` : ''}

    ${data.originalEmailText ? `CONTEÚDO DO E-MAIL ORIGINAL DO CLIENTE:\n${data.originalEmailText}` : ''}
    
    Instruções adicionais importantes:
    1. **Atenção estrita ao Modal:** Identifique se o Modal é **Aéreo (AIR)** ou **Marítimo (SEA)**. Se o modal for **Aéreo (AIR)**, formate uma solicitação de cotação de frete aéreo internacional por kg (peso taxável e bruto). **NUNCA** mencione contêineres, armadores, taxas de devolução/demasia de contêineres ou qualquer termo marítimo no e-mail, mesmo que apareçam em regras genéricas. Se o modal for **Marítimo (SEA)**, formule a solicitação para frete marítimo (FCL ou LCL).
    2. Analise o CONTEÚDO DO E-MAIL ORIGINAL DO CLIENTE (se disponível) juntamente com as REGRAS E DIRETRIZES DE NEGÓCIO IMPORTANTES (que contêm explicações de siglas de e-mails, tipos de container, etc.).
    3. Caso haja siglas no e-mail original explicadas nas regras (por exemplo, siglas indicando container Open Top (OT) e/ou High Cube (HC), como "4 x 40' OT HC" ou "OP e HC"), e o modal for Marítimo, certifique-se de aplicar essa regra e solicitar os tipos corretos de equipamentos (containers) no e-mail (por exemplo, especificando container Open Top High Cube ou OP e HC) no lugar de um contêiner Dry comum.
    4. Analise as Dimensões/CBM nos DADOS EXTRAÍDOS DA CARGA. Se o modal for Marítimo e contiver qualquer menção a tipos especiais de containers (como "OT", "HC", "Open Top", "High Cube", "OP", etc.), incorpore essa exigência no e-mail de cotação.
    5. **Rota com UN/LOCODE**: Ao citar a rota do embarque (Origem e Destino) no e-mail, identifique e coloque o respectivo código de porto ou aeroporto (UN/LOCODE) correspondente ao lado do nome da cidade (por exemplo: "Shanghai (CNSHA)" e "Santos (BRSSZ)"), caso o local de origem ou destino seja conhecido.
    6. **Prazo de Resposta com Antecedência (12h)**: Se o cliente ou o e-mail original estipular uma data, hora ou prazo limite (deadline) para a entrega da proposta de cotação, calcule um limite de tempo para o retorno do agente que seja exatamente **12 horas antes** desse prazo original e mencione de forma clara no e-mail (por exemplo: se o cliente pediu retorno até dia 28 às 18h, peça ao agente até o dia 28 às 06h).
    7. **Omitir Taxas de Destino Silenciosamente**: Se houver regras sobre taxas de destino (como não pedi-las para agentes da origem), simplesmente **não as peça** no e-mail (solicite apenas o frete e taxas locais de origem, ex: THC, documentação, etc.). **NUNCA escreva frases negativas no e-mail dizendo que não precisa de taxas de destino** (ex: NÃO escreva "não precisamos das taxas de destino" ou "não enviar taxas de destino"). Apenas ignore as taxas de destino silenciosamente no e-mail.
    8. Redija o e-mail de forma direta e profissional. Sem saudações excessivas, apenas o necessário. Em português (Brasil) ou inglês simples.
    9. **Conexões**: Se houver conexões do voo ou do porto especificadas nos DADOS EXTRAÍDOS DA CARGA (diferente de "Sem conexões"), mencione-as de forma clara no e-mail (ex: "via MIA" ou "com transbordo em Algeciras") para que o coloader/agente faça a cotação exatamente na rota solicitada.
    10. **Remoção de Telefones e Contatos da Assinatura**: Ao assinar o e-mail (ou finalizar o corpo do e-mail), **NUNCA** inclua informações de contato pessoal extraídas do e-mail do cliente (como nomes de pessoas de contato, ex: "Magda", "Talitha", etc., endereços de e-mail específicos, números de telefone comercial, ramal ou telefones celulares). A assinatura do e-mail deve ser estritamente genérica e neutra (ex: apenas "Atenciosamente," ou "Best regards,"), sem listar quaisquer nomes, telefones ou e-mails adicionais.
    
    Retorne APENAS o corpo do e-mail.`;

    const result = await model.generateContent(prompt);
    return result.response.text().trim();
  } catch (error) { throw new Error('Falha ao gerar rascunho com IA'); }
};

export const extractAgentCosts = async (
  text: string, 
  contextRules: string = '', 
  localFeesTable: string = '', 
  quotationContext: string = '',
  mediaParts: any[] = []
) => {
  try {
    const model = genAI.getGenerativeModel({ 
      model: 'gemini-2.5-flash',
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'object',
          properties: {
            costs: {
              type: 'object',
              properties: {
                freight_value: { type: 'number', description: 'Valor do frete internacional bruto calculado' },
                freight_currency: { type: 'string', description: 'Moeda original do frete (ex: USD, EUR, BRL)' },
                freight_usd: { type: 'number', description: 'Valor do frete convertido em USD' },
                iof_usd: { type: 'number', description: 'Valor de IOF em USD se aplicável (normalmente 3.5% do frete)' },
                storage_brl: { type: 'number', description: 'Valor estimado de armazenagem em BRL se houver' },
                services_brl: { type: 'number', description: 'Valor total de taxas locais e taxas de destino em BRL' },
                taxes_brl: { type: 'number', description: 'Valor total de impostos locais em BRL' },
                total_brl: { type: 'number', description: 'Valor total em BRL se houver' },
                invoice_value: { type: 'number', description: 'Valor da mercadoria ou Invoice (em USD) citado no e-mail, se houver' },
                insurance_requested: { type: 'boolean', description: 'Verdadeiro (true) se o e-mail solicitar cotação ou inclusão de Seguro Internacional (insurance)' },
                carrier: { type: 'string', description: 'Nome completo da Cia Aérea ou Armador por extenso' },
                origin_airport: { type: 'string', description: 'Porto ou Aeroporto de Origem informado pelo agente (sigla IATA ou nome, ex: PEK ou Beijing)' },
                connections: { type: 'string', description: 'Conexões ou escalas informadas pelo agente. Ex: PEK-NRT-USA-GRU. Retorne string vazia se for direto.' },
                origin_fees: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string', description: 'Nome da taxa de origem (ex: AWB Fee, CGC, Terminal Charges, Pick up, Handling)' },
                      value: { type: 'number', description: 'Valor total calculado da taxa' },
                      currency: { type: 'string', description: 'Moeda da taxa (ex: USD, EUR, BRL)' }
                    },
                    required: ['name', 'value']
                  },
                  description: 'Lista de taxas locais na origem (EXW local charges) especificadas no e-mail do agente'
                },
                destination_fees: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string', description: 'Nome da taxa de destino (ex: Delivery Fee, CCT Fee, Desconsolidação, Frete Rodoviário Nacional)' },
                      value: { type: 'number', description: 'Valor total calculado da taxa' },
                      currency: { type: 'string', description: 'Moeda da taxa (ex: USD, EUR, BRL)' }
                    },
                    required: ['name', 'value']
                  },
                  description: 'Lista de taxas locais no destino (taxas locais de destino / frete rodoviário) especificadas no e-mail'
                },
                transit_time: { type: 'string', description: 'Tempo de trânsito literal informado pelo agente (ex: "3 days", "9-12 days", "35 dias"). Se não informado, retorne "n/a".' },
                frequency: { type: 'string', description: 'Frequência de saídas ou voos informada pelo agente. Se o agente indicar termos como "D26", "D2,6", "D2/6", etc., converta para "2x por semana (D26)" ou similar. Se não informado, retorne "Semanal".' },
                weight_break: { type: 'string', description: 'Faixa tarifária de peso aplicada no frete aéreo pelo agente se houver no texto. Exemplos de retorno: "normal", "+45", "+100", "+300", "+500", "+1000". Se o e-mail do agente contiver termos como "+100kg", "above 100kg", "+100", extraia "+100". Se não aplicável ou não mencionado, retorne "normal".' },
                confidence: { type: 'number', description: 'Grau de confiança na extração' }
              },
              required: ['freight_value', 'freight_currency', 'freight_usd', 'transit_time', 'frequency', 'weight_break']
            }
          },
          required: ['costs']
        } as any
      }
    });

    const prompt = `Você é um especialista em comércio exterior brasileiro.
    Analise o RETORNO DO AGENTE e extraia os custos informados.

    REGRAS E DIRETRIZES DE NEGÓCIO IMPORTANTES:
    ${contextRules}

    ${quotationContext ? `CONTEXTO DA COTAÇÃO ORIGINAL:\n${quotationContext}` : ''}
    
    ${localFeesTable ? `${localFeesTable}` : ''}

    Instruções Gerais de Extração:
    1. **Tempo de Trânsito (Transit Time):** Identifique o tempo de trânsito (T/T ou Transit Time) mencionado no RETORNO DO AGENTE (ex: "3 days", "9-12 days", "35 dias"). Salve esse texto literal no campo "transit_time". Se não encontrar nenhuma menção ao tempo de trânsito, retorne "n/a".
    2. **Frequência (frequency):** Identifique a frequência de saída de voos ou navios no RETORNO DO AGENTE. Se o agente indicar termos como "D26", "D2,6", "D2/6", etc. (sinalizando saídas às terças e sábados no padrão IATA, ou segundas e sextas no informal), formate o resultado final como "2x por semana (D26)" ou similar que represente de forma clara a frequência. Se o agente apenas indicar "diário", "semanal", etc., extraia esse texto. Se não for informada nenhuma frequência, retorne "Semanal".
    3. **Origem (origin_airport):** Identifique o Porto ou Aeroporto de Origem que o agente cotou no RETORNO DO AGENTE (ex: PEK, WNZ, SZX, MXP). Salve o código IATA ou o nome do aeroporto correspondente.
    4. **Conexões (connections):** Identifique as conexões ou escalas informadas pelo agente (ex: "PEK-NRT-USA-GRU" ou "via MIA" ou "via NRT"). Salve a string no campo "connections". Retorne string vazia se for direto ou não houver menção a conexões.
    5. **Taxas Locais de Origem (origin_fees):** Identifique todas as taxas locais na origem (EXW local charges / Origin charges) informadas no e-mail do agente.
       - Calcule o valor total de cada taxa:
         - Para taxas cotadas por remessa ("per shpt", "per shipment", "fixed", "Fixo", "per HAWB"), use o valor fixo.
         - Para taxas cotadas por peso ("per kg", "/kg"), multiplique o valor unitário pelo peso da carga (bruto ou taxável correspondente) e respeite o valor mínimo informado (ex: "Min US20.00/shpt" significa que o valor total daquela taxa deve ser no mínimo USD 20.00).
         - Para taxas cotadas por conjunto de documentos ("for each set of docs"), use o valor informado.
       - Retorne a lista de taxas em "origin_fees" com o respectivo "name" (por extenso, ex: "AWB Fee & CGC", "Terminal Charges", "Customs Clearance", "Handling Fee", "Pick Up"), "value" (número) e "currency" (moeda, ex: "USD", "BRL").
    6. **Taxas Locais de Destino e Rodoviário (destination_fees):** Identifique todas as taxas locais no destino (Destination charges) informadas no e-mail do agente ou cliente.
       - Se houver menção ou solicitação de orçamento de frete rodoviário nacional (ex: transporte terrestre doméstico / rodoviário / entrega local de GRU para Itatiba, Jacareí, São Paulo, etc.), inclua essa taxa sob o nome "Frete Rodoviário Nacional [Trecho]" (ex: "Frete Rodoviário Nacional (GRU x Itatiba)"). IMPORTANTE: Se o documento ou e-mail de orçamento do frete rodoviário apresentar o valor "Sem impostos" e também um "Total previsto com impostos" (ex: com ICMS/ISS), você DEVE extrair obrigatoriamente o "Total previsto com impostos" (valor final) para esta taxa.
       - Calcule o valor total de cada taxa local de destino encontrada da mesma forma que na origem (valores fixos ou baseados em peso/Hawb).
       - Retorne a lista de taxas em "destination_fees" com o respectivo "name", "value" (número) e "currency" (moeda, ex: "USD", "BRL").
    7. **Seguro (Insurance):** Verifique se no texto do e-mail há pedido de "Seguro" (ex: "orçamento de frete aéreo com seguro", "incluir seguro"). Em caso positivo, marque "insurance_requested" como true e extraia o valor da mercadoria (Invoice) informado no texto (ex: "Valor da Invoice USD 186.855,66") e salve em "invoice_value". Se o valor não estiver explícito, salve 0.


    Instruções Importantes para Modal Aéreo:
    1. Para a Cia Aérea (carrier), identifique o nome completo da companhia aérea. Se encontrar códigos/siglas IATA de duas letras (como KL, LH, AA, UA, AF, TP, EK, QR), converta para o nome por extenso correspondente (ex: KL -> KLM, LH -> Lufthansa, AA -> American Airlines, AF -> Air France, TP -> TAP Air Portugal, EK -> Emirates, QR -> Qatar Airways).
    2. Identifique os aeroportos citados por siglas de 3 letras (como PRG, GRU, SZX, MXP) e converta-os para o respectivo nome de cidade/aeroporto por extenso.
    3. Identifique a faixa tarifária de peso aplicada (weight break) no texto (ex: se mencionar "+100kg", "above 100", "+100", salve "+100" no campo "weight_break"; se disser "+300kg", salve "+300", etc.). Se não houver menção, use "normal".
    4. Extraia o frete internacional em sua moeda original (ex: EUR 5.30/kg). Se a tarifa for cotada por kg, multiplique-a pelo peso de cobrança correspondente. Lembre-se da regra da faixa tarifária mínima: se a tarifa for para a faixa "+100kg", e o peso taxável calculado (maior entre bruto e cubado) for inferior a 100kg, multiplique a tarifa por 100 (peso de cobrança de 100kg). Se a faixa for "+300kg" e o peso calculado for inferior a 300kg, multiplique por 300, e assim por diante.
    5. Mantenha os campos de frete originais "freight_value" e "freight_currency". Calcule também a equivalência do frete em USD no campo "freight_usd" para fins de compatibilidade com a tela (se em EUR, converta para USD multiplicando por 1.08; se em USD, mantenha o mesmo valor).

    Instruções Importantes para Taxas Locais de Armador (Destino BRL):
    1. Se os dados de CONTEXTO DA COTAÇÃO ORIGINAL indicarem que o embarque é uma IMPORTAÇÃO marítima de contêiner cheio (FCL_20, FCL_40, etc.):
       - Identifique qual é o ARMADOR (Carrier) mencionado no RETORNO DO AGENTE ou nos documentos (por exemplo: Maersk / MSK, Hapag-Lloyd / HPG, ONE, MSC, CMA, COSCO, PIL, HMM).
       - Se encontrar o armador, consulte a tabela correspondente a ele em "TABELA DE TAXAS LOCAIS DE DESTINO POR ARMADOR (2026)" fornecida acima.
       - A partir da tabela do armador, extraia todas as taxas de destino padrão (ex: BL Fee, THC, Emissão, Devolução de container, etc.) aplicáveis para o tipo de container do embarque (20' ou 40'). NÃO inclua taxas marcadas como "ADICIONAIS" ou "ADICIONAL" (que devem ser desconsideradas conforme a regra "TAXAS LOCAIS ARMADORES 2026").
       - Calcule a soma total dessas taxas locais padrão em BRL:
         - Para taxas do tipo "(per container)" ou "(per contianer)" ou similar: multiplique o valor unitário da taxa pela quantidade de contêineres indicada no CONTEXTO DA COTAÇÃO ORIGINAL (deduza a quantidade a partir da descrição ou de referências, ex: "4 x Container de 40'" significa 4 contêineres).
         - Para taxas do tipo "(per shipment)" ou "(per documento)" ou similar: aplique o valor da taxa uma única vez no embarque.
       - Some todas as taxas obtenidas e insira o valor final calculated (em reais BRL) no campo "services_brl" do JSON de resposta, a menos que o retorno do agente já contenha expressamente outras taxas locais de destino in BRL informadas no texto (se houver taxas locais de destino especificadas no texto do agente, prefira as informadas pelo agente).
    
    RETORNO DO AGENTE:
    ${text}

    Retorne o JSON estruturado conforme o schema fornecido nas configurações de geração.
    - Se encontrar o frete oculto em expressões como "Total USD 1.04 com IOF", deduza o frete puro de 1.00.`;

    const contentPayload = mediaParts.length > 0
      ? [prompt, ...mediaParts.map(p => ({ inlineData: p.inlineData }))]
      : [prompt];

    const result = await model.generateContent(contentPayload);
    const parsed = JSON.parse(result.response.text().trim());
    if (parsed.costs) {
      const ttStr = parsed.costs.transit_time;
      let ttDays = null;
      if (ttStr && ttStr !== 'n/a') {
        const matches = ttStr.match(/\d+/g);
        if (matches && matches.length > 0) {
          const numbers = matches.map((n: string) => parseInt(n, 10));
          ttDays = Math.max(...numbers);
        }
      }
      parsed.costs.transit_time_days = ttDays;
    }
    return parsed;
  } catch (error: any) {
    console.error('[extractAgentCosts] ERRO REAL:', error);
    throw new Error('Falha ao processar custos com IA: ' + (error?.message || String(error)));
  }
};
