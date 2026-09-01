import { GoogleGenerativeAI } from '@google/generative-ai';
import { parsePackages, extractContainerInfo } from '../utils/cargoUtils';
import type { DraftPayload } from '../utils/draftPayload';
import { applyRateValidityPolicy } from './rateValidityService';
import { DG_STATUS, normalizeDangerousGoodsStatus, normalizeMsdsStatus } from './dangerousGoodsService';
import { normalizeCurrency, normalizeFeeList } from './feeCalculationService';
import { normalizeIncotermText } from './incotermAliasService';

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.warn("WARNING: GEMINI_API_KEY environment variable is not defined.");
}
const genAI = new GoogleGenerativeAI(apiKey || '');

const MAX_AI_INPUT_TOKENS = 800_000;
const MAX_SOURCE_TEXT_CHARS = 600_000;
const MAX_CONTEXT_TEXT_CHARS = 120_000;
const MAX_MEDIA_PARTS = 8;

export function compactAiText(value: string, maxChars: number = MAX_SOURCE_TEXT_CHARS): string {
  const text = String(value || '').replace(/\0/g, '').trim();
  if (text.length <= maxChars) return text;

  const beginningSize = Math.floor(maxChars * 0.7);
  const endSize = maxChars - beginningSize;
  const removedChars = text.length - maxChars;
  return `${text.slice(0, beginningSize)}\n\n[... ${removedChars} caracteres intermediários removidos para respeitar o limite da IA ...]\n\n${text.slice(-endSize)}`;
}

export async function buildTokenSafeContent(
  model: any,
  prompt: string,
  mediaParts: any[] = []
): Promise<Array<string | { inlineData: { data: string; mimeType: string } }>> {
  const safePrompt = compactAiText(prompt, MAX_SOURCE_TEXT_CHARS + MAX_CONTEXT_TEXT_CHARS);
  const promptTokens = Number((await model.countTokens(safePrompt)).totalTokens) || 0;

  if (promptTokens >= MAX_AI_INPUT_TOKENS) {
    throw new Error('O texto do e-mail ainda excede o limite seguro da IA mesmo após a compactação.');
  }

  const selectedContent: Array<string | { inlineData: { data: string; mimeType: string } }> = [safePrompt];
  let usedTokens = promptTokens;
  let skippedMedia = 0;

  for (const part of mediaParts.slice(0, MAX_MEDIA_PARTS)) {
    if (!part?.inlineData?.data || !part?.inlineData?.mimeType) continue;
    try {
      const mediaContent = { inlineData: part.inlineData };
      const mediaTokens = Number((await model.countTokens([mediaContent])).totalTokens) || 0;
      if (usedTokens + mediaTokens <= MAX_AI_INPUT_TOKENS) {
        selectedContent.push(mediaContent);
        usedTokens += mediaTokens;
      } else {
        skippedMedia++;
      }
    } catch (error) {
      skippedMedia++;
      console.warn(`Não foi possível contabilizar o anexo ${part.filename || 'sem nome'}; ele foi ignorado.`);
    }
  }

  skippedMedia += Math.max(0, mediaParts.length - MAX_MEDIA_PARTS);
  if (skippedMedia > 0) {
    console.warn(`[IA] ${skippedMedia} anexo(s) ignorado(s) para respeitar o limite de tokens. Tokens estimados enviados: ${usedTokens}.`);
  }

  return selectedContent;
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

export function extractPackagingFacts(sourceText: string): {
  grossWeightKg: number;
  packagesCount: number;
  dimensions: string[];
} | null {
  const numberPattern = '(\\d+(?:[.,]\\d+)?)';
  const boxPattern = new RegExp(
    `box\\s*\\d+\\s*:\\s*${numberPattern}\\s*[x*×]\\s*${numberPattern}\\s*[x*×]\\s*${numberPattern}\\s*cm\\b[^\\n]*?${numberPattern}\\s*(?:kg\\s*)?\\/\\s*${numberPattern}\\s*kg`,
    'gi'
  );
  const boxes: Array<{ length: number; width: number; height: number; gross: number }> = [];
  const toNumber = (value: string) => Number(value.replace(',', '.'));
  let match: RegExpExecArray | null;

  while ((match = boxPattern.exec(String(sourceText || ''))) !== null) {
    const length = toNumber(match[1] || '0');
    const width = toNumber(match[2] || '0');
    const height = toNumber(match[3] || '0');
    const gross = toNumber(match[4] || '0');
    if (length > 0 && width > 0 && height > 0 && gross > 0) {
      boxes.push({ length, width, height, gross });
    }
  }
  if (boxes.length === 0) return null;

  const totalPattern = new RegExp(
    `total\\s+gross\\s*\\/\\s*net\\s+weight\\s*:\\s*${numberPattern}\\s*kg\\s*\\/\\s*${numberPattern}\\s*kg`,
    'i'
  );
  const totalMatch = totalPattern.exec(String(sourceText || ''));
  const explicitGross = totalMatch?.[1] ? toNumber(totalMatch[1]) : 0;
  const grossWeightKg = explicitGross > 0
    ? explicitGross
    : boxes.reduce((sum, box) => sum + box.gross, 0);

  return {
    grossWeightKg: parseFloat(grossWeightKg.toFixed(3)),
    packagesCount: boxes.length,
    dimensions: boxes.map(box => `1x ${box.length}x${box.width}x${box.height} cm`)
  };
}

export async function extractSignatureOcr(mediaParts: any[] = []) {
  if (!mediaParts.length) return [];
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'object', properties: {
          readings: {
            type: 'array', items: { type: 'object', properties: {
              filename: { type: 'string' }, isSignature: { type: 'boolean' }, rawText: { type: 'string' },
              name: { type: 'string' }, phone: { type: 'string' }, email: { type: 'string' },
              company: { type: 'string' }, confidence: { type: 'number' }
            }, required: ['isSignature', 'rawText', 'confidence'] }
          }
        }, required: ['readings']
      } as any
    }
  });
  const prompt = `Analise somente as imagens fornecidas, na mesma ordem em que foram enviadas. Elas podem ser assinaturas gráficas de e-mail, logos ou ícones.
Para cada imagem, transcreva apenas texto legível e extraia nome, telefone, e-mail e empresa quando existirem.
Marque isSignature=false quando for apenas logo/ícone. Não invente dados e não use texto de outras imagens para completar uma leitura. Retorne confiança entre 0 e 1.`;
  const selectedMedia = mediaParts.slice(0, 6);
  const content = await buildTokenSafeContent(model, prompt, selectedMedia);
  const result = await withRetry(() => model.generateContent(content));
  const parsed = JSON.parse(result.response.text().trim());
  return Array.isArray(parsed?.readings) ? parsed.readings.map((item: any, index: number) => ({
    ...item, filename: item.filename || selectedMedia[index]?.filename || `signature_${index + 1}`,
    sourceEmailIndex: selectedMedia[index]?.sourceEmailIndex,
    sourceEmailFile: selectedMedia[index]?.sourceEmailFile,
    source: 'SIGNATURE_IMAGE_OCR'
  })).filter((item: any) => item.isSignature && Number(item.confidence || 0) >= 0.45) : [];
}

// Retry com backoff exponencial para lidar com falhas temporárias da API Gemini
// (429 rate limit e 503 sobrecarga/high demand — ambos a própria Google
// recomenda tentar de novo).
async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  const delays = [5000, 10000, 20000];
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      const message = String(error?.message || '');
      const is429 = message.includes('429') || message.includes('Too Many Requests');
      const is503 = message.includes('503') || /service unavailable|overloaded|high demand/i.test(message);
      const isBilling = message.includes('prepayment') || message.includes('depleted');
      const isRetryable = (is429 || is503) && !isBilling;

      if (isRetryable && attempt < maxAttempts - 1) {
        const wait = delays[attempt] || 20000;
        console.warn(`[Gemini] Falha temporária (${is503 ? '503' : '429'}). Tentativa ${attempt + 1}/${maxAttempts}. Aguardando ${wait/1000}s...`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      // Esgotou as tentativas de um erro retryable, ou é um erro definitivo
      // (billing, etc.) — sinaliza pro chamador dar uma mensagem amigável.
      if (isRetryable) error.isRetryExhausted = true;
      throw error;
    }
  }
  throw new Error('Máximo de tentativas atingido');
}

const AI_OVERLOAD_MESSAGE = 'O serviço de IA está temporariamente sobrecarregado. Tentamos algumas vezes automaticamente e não conseguimos — tente novamente em alguns minutos.';

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
                reference: { type: 'string', description: 'Referência/número de PO/pedido que o PRÓPRIO CLIENTE usa para identificar este embarque (ex: "Ref: PO-12345", "Your ref", "Purchase Order"). Se não houver PO explícito, procure pelo número da Invoice (Fatura Comercial) e utilize-o como fallback. Não confundir com a referência interna da Audaz.' },
                confidence: { type: 'number' }
              },
              required: ['name']
            },
            route: {
              type: 'object',
              properties: {
                incoterm: { type: 'string', description: 'O incoterm solicitado (ex: EXW, FCA, FOB, DAP) extraído da solicitação, tabela de resumo de informações básicas ou do corpo do e-mail.' },
                direction: {
                  type: 'string', enum: ['IMPORT', 'EXPORT'],
                  description: 'Direção do embarque do ponto de vista do cliente brasileiro. EXPORT quando a origem/coleta for no Brasil e o destino final for no exterior. IMPORT quando a origem/coleta for no exterior e o destino final for no Brasil. Na dúvida, use IMPORT.'
                },
                origin_city: { type: 'string', description: 'Local Inicial de coleta da carga (Cidade/Estado/País)' },
                origin_country: { type: 'string', description: 'País do porto ou aeroporto de origem' },
                origin_airport: { type: 'string', description: 'Porto ou Aeroporto de Origem (formato IATA para aeroporto, ex: WNZ - Wenzhou)' },
                origin_address_source: { type: 'string', enum: ['TEXT', 'IMAGE_OCR', 'NOT_FOUND'], description: 'IMAGE_OCR quando o endereço/local de coleta veio da leitura de uma imagem, print ou foto anexada/embutida; TEXT quando veio do texto corrido do e-mail ou de um documento com texto pesquisável; NOT_FOUND quando não há informação.' },
                origin_address_evidence: { type: 'string', description: 'Trecho de texto ou nome do arquivo de imagem que comprova o endereço/local de coleta. Vazio se origin_address_source for NOT_FOUND.' },
                destination_city: { type: 'string', description: 'Destino final explicitamente informado. Não deduza usando assinatura, telefone ou endereço conhecido da empresa; sem destino final expresso, use o porto/aeroporto de destino.' },
                destination_country: { type: 'string', description: 'País do porto ou aeroporto de destino' },
                destination_airport: { type: 'string', description: 'Porto ou Aeroporto de Destino (formato IATA para aeroporto, ex: GRU - Guarulhos)' },
                destination_address_source: { type: 'string', enum: ['TEXT', 'IMAGE_OCR', 'NOT_FOUND'], description: 'IMAGE_OCR quando o endereço/local de entrega veio da leitura de uma imagem, print ou foto anexada/embutida; TEXT quando veio do texto corrido do e-mail ou de um documento com texto pesquisável; NOT_FOUND quando não há informação.' },
                destination_address_evidence: { type: 'string', description: 'Trecho de texto ou nome do arquivo de imagem que comprova o endereço/local de entrega. Vazio se destination_address_source for NOT_FOUND.' },
                connections: { type: 'string', description: 'Conexões do voo (ex: via MIA) ou escalas de porto (ex: transbordo em Algeciras). Retorne string vazia se for direto.' },
                needs_origin_inland: { type: 'boolean', description: 'Verdadeiro quando é necessário cotar a coleta terrestre na origem, normalmente em EXW ou FCA quando o local inicial é diferente do porto/aeroporto de embarque.' },
                origin_inland_route: { type: 'string', description: 'Rota da coleta na origem no formato "Local de coleta → Porto/Aeroporto". Retorne string vazia quando needs_origin_inland for false.' },
                needs_transport: { type: 'boolean', description: 'True quando o cliente pedir explicitamente transporte rodoviário nacional, entrega local/final ou coleta nacional no texto da solicitação, OU quando um endereço completo (rua e número, ou local nomeado com bairro/cidade/UF) de coleta ou entrega no Brasil estiver presente no corpo da mensagem. Incoterm isolado, cidade sozinha, ou endereço apenas na assinatura/rodapé do e-mail não autorizam marcar.' },
                transport_route: { type: 'string', description: 'O trecho rodoviário nacional do Brasil necessário (ex: "Santos x Itatiba/SP", "Guarulhos x Jacareí/SP"). Retorne string vazia se needs_transport for false.' },
                transport_source: { type: 'string', enum: ['EXPLICIT_TEXT', 'ADDRESS_DETECTED', 'NOT_REQUESTED'], description: 'EXPLICIT_TEXT quando o cliente pediu o transporte em palavras; ADDRESS_DETECTED quando needs_transport veio de um endereço completo encontrado no corpo, sem pedido verbal; NOT_REQUESTED quando needs_transport for false.' },
                transport_evidence: { type: 'string', description: 'A frase do pedido ou o endereço completo exato que fundamenta needs_transport. Vazio se needs_transport for false.' },
                confidence: { type: 'number' }
              },
              required: [
                'incoterm',
                'direction',
                'origin_city',
                'origin_country',
                'origin_airport',
                'destination_city',
                'destination_country',
                'destination_airport',
                'connections',
                'needs_origin_inland',
                'origin_inland_route',
                'needs_transport',
                'transport_route'
              ]
            },
            cargo: {
              type: 'object',
              properties: {
                type: { 
                  type: 'string',
                  enum: ['AIR_GENERAL','LCL','FCL_20','FCL_40','FCL_40HC','FCL_20RH','FCL_40RH','FCL_20OT','FCL_40OT', 'UNKNOWN'],
                  description: 'Modal/tipo de carga. Retorne OBRIGATORIAMENTE um destes valores: "AIR_GENERAL" (se o embarque for Aéreo/Air), "LCL" (se marítimo consolidado), "FCL_20" (se marítimo container de 20 pés), "FCL_40" (se marítimo container de 40 pés) ou "UNKNOWN" (se não for explícito). Nunca retorne o nome do produto ou mercadoria neste campo.' 
                },
                gross_weight_kg: { type: 'number' },
                packages_count: { type: 'number' },
                description: { type: 'string', description: 'Descrição detalhada da mercadoria/produto exatamente como o cliente escreveu (ex: "Peças sobressalentes de perfuratriz", "Resina plástica em pellets"). Copie o texto, não resuma nem traduza. String vazia se não houver descrição do produto.' },
                dimensions: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Lista de dimensões de cada lote de caixas/volumes. Cada item do array DEVE obrigatoriamente iniciar com a quantidade correspondente de caixas daquela dimensão no formato "QTDx CxLxA cm" (ex: "1x 50*50*28 cm", "2x 50*50*13 cm", "3x 37.5*31*37 cm" e "9x 63x41.5x38 cm").'
                },
                commercial_value_usd: { type: 'number', description: 'Valor comercial numérico da carga. Se a moeda original for EUR, BRL ou GBP, ignore a sigla e retorne apenas o número puro (ex: 2610.00). Não faça conversão cambial.' },
                is_imo: { type: 'boolean', description: 'Compatibilidade: true somente quando a carga perigosa estiver explicitamente confirmada.' },
                dangerous_goods_status: {
                  type: 'string', enum: ['CONFIRMED', 'NOT_DANGEROUS', 'TO_CONFIRM'],
                  description: 'CONFIRMED se DG/Dangerous Goods/IMO/Hazmat estiver explicito; NOT_DANGEROUS somente com declaracao explicita de carga nao perigosa; TO_CONFIRM quando nao houver informacao. NUNCA infira a partir do nome do produto/mercadoria (ex: "resina", "resin", "tinta", "adesivo" NAO sao evidencia de DG por si so).'
                },
                dangerous_goods_source: { type: 'string', description: 'Trecho ou documento que fundamenta a classificacao DG.' },
                dangerous_goods_confidence: { type: 'number' },
                stackable_status: {
                  type: 'string', enum: ['STACKABLE', 'NOT_STACKABLE', 'TO_CONFIRM'],
                  description: 'STACKABLE somente se o cliente/agente confirmar explicitamente que a carga pode ser empilhada ("stackable", "empilhável"); NOT_STACKABLE somente com restrição explícita ("não empilhável", "do not stack", "non-stackable", "fragile - no stacking"); TO_CONFIRM quando não houver menção explícita. NUNCA infira pelo tipo de produto ou embalagem.'
                },
                stackable_source: { type: 'string', description: 'Trecho que fundamenta a classificação de empilhamento.' },
                stackable_confidence: { type: 'number' },
                msds_status: {
                  type: 'string', enum: ['NOT_REQUESTED', 'REQUESTED', 'PENDING', 'RECEIVED', 'VALIDATED', 'WAIVED'],
                  description: 'RECEIVED quando houver MSDS/SDS anexada; PENDING para carga DG sem documento; NOT_REQUESTED para carga nao DG ou a confirmar.'
                },
                msds_notes: { type: 'string' },
                un_number: { type: 'string' },
                dangerous_goods_class: { type: 'string' },
                packing_group: { type: 'string' },
                proper_shipping_name: { type: 'string' },
                flash_point: { type: 'string' },
                dangerous_goods_product_count: { type: 'number', description: 'Quantidade de produtos perigosos distintos explicitamente informada.' },
                dangerous_packages_count: { type: 'number', description: 'Quantidade de volumes contendo carga perigosa explicitamente informada.' },
                un_number_count: { type: 'number', description: 'Quantidade de UN Numbers distintos identificados.' },
                requires_insurance: { 
                  type: 'boolean', 
                  description: 'Se o cliente solicitou ou mencionou seguro no e-mail (ex: "com seguro", "frete com seguro"). Se disser "sem seguro" ou não houver menção, retorne false.' 
                },
                requires_storage_estimate: {
                  type: 'boolean',
                  description: 'True quando o cliente pedir explicitamente estimativa, valor, custo ou cotação de armazenagem.'
                },
                storage_request_evidence: { type: 'string', description: 'Trecho exato que solicita armazenagem; vazio quando não solicitado.' },
                hybrid_shipment_detected: {
                  type: 'boolean',
                  description: 'True SOMENTE quando a solicitação descrever claramente DOIS embarques distintos com modais diferentes (um aéreo e outro marítimo/LCL/FCL) que não devem ser consolidados em uma única cotação. False para menções incidentais a transporte (ex: "seguir de caminhão até o aeroporto/porto" não é modal duplo) ou quando há apenas um embarque.'
                },
                hybrid_shipment_note: { type: 'string', description: 'Se hybrid_shipment_detected for true, explique brevemente quais trechos indicam os dois modais distintos. String vazia caso contrário.' },
                confidence: { type: 'number' }
              },
              required: ['type', 'gross_weight_kg', 'packages_count', 'dimensions', 'requires_storage_estimate', 'storage_request_evidence']
            }
          },
          required: ['client', 'route', 'cargo']
        } as any
      }
    });

    const safeSourceText = compactAiText(text, MAX_SOURCE_TEXT_CHARS);
    const safeContextRules = compactAiText(contextRules, MAX_CONTEXT_TEXT_CHARS);

    const prompt = `Você é um especialista em comércio exterior brasileiro.
    Analise a SOLICITAÇÃO DO CLIENTE e os documentos anexos para extrair os dados principais.
    NÃO se preocupe com custos ou valores de frete, pois isso será cotado depois com os agentes.

    CONTEXTO DE REGRAS DE NEGÓCIO:
    ${safeContextRules}

    DOCUMENTO(S) / SOLICITAÇÃO:
    ${safeSourceText}

    - **Referência do Cliente (client.reference)**: Identifique se o cliente menciona uma referência/PO/número de pedido PRÓPRIO dele para este embarque (ex: "Ref: PO-12345", "Your ref", "Purchase Order", "PO#"). Caso não haja um PO explícito, procure pelo número da Invoice (Fatura Comercial) e utilize-o como referência. Essa é diferente de qualquer referência interna da Audaz. Se não houver PO nem Invoice, retorne string vazia.
    - **Telefone do Cliente (client.contact_phone)**: Extraia APENAS telefones válidos (celular ou fixo) associados à assinatura do CLIENTE que pediu a cotação (normalmente do Brasil). NÃO capture números de Fax, ramais soltos, CNPJ ou Inscrição Estadual. É estritamente PROIBIDO capturar telefones internacionais que pertençam aos fornecedores (shippers) no exterior. Mantenha a formatação original e legível encontrada (ex: (11) 99999-9999).
    - **Estimativa de armazenagem**: Se o cliente pedir estimativa, valor, custo ou cotação de armazenagem, defina cargo.requires_storage_estimate=true e copie a frase de suporte em cargo.storage_request_evidence. Não confunda menção genérica a terminal com uma solicitação de armazenagem.

    Instruções Importantes para Rota, Incoterm, Portos/Aeroportos, Cidades e Conexões:
    - **Incoterm — PRIORIDADE CRÍTICA**: Identifique e extraia OBRIGATORIAMENTE o Incoterm (ex: EXW, FCA, FOB, CIF, DAP, etc) de qualquer lugar dos documentos, seja do texto corrido do e-mail, de imagens coladas, de tabelas de informações básicas, Invoices ou formulários anexados (ex: "FCA Planta do Fornecedor"). Se as palavras FCA, EXW, FOB ou similar aparecerem, capture-as imediatamente.
    - **Incoterm — Regra geral**: Analise se há um endereço de coleta detalhado (fábrica/fornecedor) no exterior. Em caso afirmativo (especialmente se o modal for Aéreo), defina o Incoterm como **EXW** ou **FCA** — nunca use "FOB" genérico de planilha de valor comercial.
    - **Direção (direction)**: Determine se a operação é uma Importação ou Exportação do ponto de vista do cliente brasileiro. Se a coleta/origem da carga for no Brasil e o destino final for em outro país, defina "EXPORT". Se a coleta/origem for no exterior e o destino final for no Brasil, defina "IMPORT". Use os países/cidades de origin_city e destination_city para decidir. Se não houver informação suficiente, defina "IMPORT" como padrão.
    - **Origem (Porto ou Aeroporto)**: Identifique o porto ou aeroporto de origem do frete principal. Se modal for Aéreo, infira o aeroporto internacional no formato "IATA - Nome do Aeroporto" (ex: "SZX - Shenzhen Bao'an International", "PRG - Prague Ruzyne International"). Se modal for Marítimo, identifique o porto de embarque internacional. Salve em "origin_airport".
    - **Destino (Porto ou Aeroporto)**: Identifique o porto ou aeroporto de destino. Se modal for Aéreo, infira no formato "IATA - Nome do Aeroporto" (ex: "GRU - Aeroporto Internacional Guarulhos"). Se modal for Marítimo, identifique o porto de descarga (ex: "Santos"). Salve em "destination_airport".
    - **Local Inicial (Cidade/Estado/País)**: Identifique a cidade, estado e país onde a carga está localizada e será coletada inicialmente no fornecedor (ex: "Pribyslav, República Tcheca" ou "Shenzhen, China"). Salve em "origin_city".
    - **Destino Final (Cidade/Estado/País)**: Use uma cidade final apenas quando ela estiver explicitamente informada no pedido (ex: "entrega em Jacareí"). NUNCA deduza o destino final por assinatura, telefone, cadastro ou endereço conhecido da empresa. Sem destino final expresso, repita o porto/aeroporto de destino em "destination_city".
    - **Endereços em imagens/prints (CRÍTICO)**: O endereço de coleta e o endereço de entrega frequentemente aparecem apenas em imagens/prints/fotos anexados ou colados no corpo do e-mail (capturas de tela de sistemas, formulários fotografados, etiquetas). Examine COM A MESMA PRIORIDADE do texto TODAS as imagens fornecidas em busca dessas informações antes de concluir que um endereço não foi informado. Ao usar uma imagem como fonte, defina "origin_address_source"/"destination_address_source" como IMAGE_OCR e registre em "origin_address_evidence"/"destination_address_evidence" o nome do arquivo da imagem (ex: "inline_image_1.png") ou o trecho transcrito. Se a informação vier do texto, use TEXT. Se não encontrar em lugar nenhum, use NOT_FOUND e não invente endereço.
    - **País**: Extraia o nome do país de origem e de destino correspondente à origem e destino principais no exterior/Brasil por extenso (ex: "CHINA" e "BRASIL"). Salve em "origin_country" e "destination_country".
    - **Conexões do Voo ou do Porto**: Identifique se há menção a escalas, aeroportos de conexão intermediários (ex: via MIA, via FRA) ou portos de escala/transbordo (ex: transbordo em Algeciras). Salve essa informação em "connections". Caso o embarque seja direto e sem conexões, retorne string vazia "".
    - **Inland de Origem / Coleta (needs_origin_inland e origin_inland_route)**:
      1. Sugira needs_origin_inland=true em EXW quando existir endereço de fábrica/coleta diferente do porto ou aeroporto de embarque.
      2. Em FCA, use true somente quando o local nomeado/endereço de coleta for diferente do terminal, porto ou aeroporto em que o vendedor entrega a carga. FCA, sozinho, não torna a coleta obrigatória.
      3. Preencha origin_inland_route como "[Local inicial] → [Porto/Aeroporto de origem]". Não invente valor de coleta.
      4. Esta coleta internacional de origem é diferente do transporte rodoviário nacional no Brasil.
    - **Necessidade de Transporte Rodoviário (needs_transport e transport_route)**:
      1. Defina "needs_transport" como true quando o texto do cliente pedir explicitamente "entrega local", "transporte/frete rodoviário", "entrega em [cidade]", "coleta nacional", "door-to-door" ou equivalente (transport_source=EXPLICIT_TEXT).
      2. Defina "needs_transport" como true TAMBÉM quando o corpo da mensagem contiver um endereço COMPLETO (rua e número, ou local nomeado com bairro/cidade/UF — não apenas o nome de uma cidade) apresentado como ponto de coleta ou de entrega do trecho nacional no Brasil (transport_source=ADDRESS_DETECTED). Isso vale tanto para coleta no Brasil (EXPORT) quanto para entrega no Brasil (IMPORT).
      3. NÃO marque needs_transport a partir de: Incoterm isolado, cidade sozinha sem endereço completo, endereço que aparece somente na assinatura/rodapé do e-mail (dado cadastral, não instrução de entrega), o endereço do fornecedor/fábrica no exterior (isso é needs_origin_inland, campo diferente), ou um endereço que coincide com a própria cidade do porto/aeroporto de entrada (não há trecho rodoviário a fazer).
      4. No campo "transport_route", preencha a rota terrestre nacional necessária no formato "[Origem] x [Destino]" (ex: "Santos x Itatiba/SP" se vier via Porto de Santos, ou "Guarulhos x Jacareí/SP" se vier via Aeroporto de Guarulhos). Se needs_transport for false, retorne string vazia "".
      5. Preencha "transport_source" com EXPLICIT_TEXT, ADDRESS_DETECTED ou NOT_REQUESTED conforme a regra que ativou o campo, e "transport_evidence" com a frase do pedido ou o endereço completo exato encontrado (copie o texto tal como aparece na fonte, sem reescrever). Ambos vazios/NOT_REQUESTED quando needs_transport for false.

    Instruções Importantes para Carga/Equipamento Especial:
    - **Carga perigosa / DG**: DG, Dangerous Goods, Dangerous Cargo, IMO e Hazmat indicam carga perigosa confirmada. Uma declaração explícita "non-DG", "not dangerous" ou "não perigosa" indica NOT_DANGEROUS. Se a fonte não disser nada, retorne TO_CONFIRM; nunca transforme ausência de informação em NOT_DANGEROUS.
    - **Não infira DG pelo nome do produto (CRÍTICO)**: NUNCA classifique a carga como CONFIRMED apenas porque o nome da mercadoria soa a produto químico ou lembra uma substância regulada (ex: "resina"/"resin", "tinta", "adesivo", "solvente" no nome comercial). Essas palavras isoladas NÃO são evidência de carga perigosa. Classifique CONFIRMED somente com menção explícita a DG/Dangerous Goods/IMO/Hazmat, UN Number, classe de risco ou MSDS/SDS anexada. Na dúvida, retorne TO_CONFIRM.
    - **MSDS/SDS**: Detecte se a ficha de segurança foi anexada ou mencionada. Para carga DG sem documento, retorne PENDING. A ausência do MSDS não invalida a extração. Extraia UN Number, classe, packing group, proper shipping name e flash point somente quando constarem na fonte.
    - Diferencie quantidade de produtos perigosos, quantidade de UN Numbers e quantidade de volumes perigosos. Não use uma como equivalente da outra sem evidência explícita.
    - Analise se a solicitação do cliente ou os documentos mencionam siglas ou equipamentos especiais de contêineres, como Open Top (OT), High Cube (HC), Flat Rack, etc.
    - Se encontrar tais siglas ou especificações (e.g. "40' OT HC", "Open Top", "High Cube", "OP e HC"), aplique as regras explicadas no CONTEXTO (como "Sigla E-mail (4 x 40' OT HC)" etc.).
    - Como o tipo do cargo ("type") é limitado no schema do JSON, certifique-se de registrar a especificação especial do contêiner (como "Container de 40' Open Top High Cube" ou similar) como um item de texto dentro da lista de "dimensions" para que essa informação essencial não se perca na extração.
    - **Modal/Tipo de Carga**: O campo "cargo.type" DEVE ser classificado estritamente como um dos seguintes: "AIR_GENERAL" (se aéreo), "LCL" (se marítimo consolidado), "FCL_20" (se container 20') ou "FCL_40" (se container 40'). Se a documentação não mencionar CLARAMENTE o modal (como "Air", "Ocean", "Sea", "LCL"), NÃO tente deduzir sozinho baseando-se apenas no Incoterm (ex: FCA não significa automaticamente Aéreo). Nesse caso, retorne OBRIGATORIAMENTE "UNKNOWN" para exigir a seleção manual. NUNCA preencha este campo com o nome da mercadoria.
    - **Descrição da Mercadoria (cargo.description)**: Copie a descrição do produto/mercadoria exatamente como o cliente escreveu (ex: "Peças sobressalentes de perfuratriz", "Autopeças", "Resina plástica em pellets"). Esse texto será colado literalmente no e-mail de cotação para o agente, então não resuma, não traduza e não invente — se não houver descrição do produto na solicitação, retorne string vazia.

    - **Instruções Importantes para Peso Bruto (gross_weight_kg), Volumes (packages_count), Valor Comercial (commercial_value_usd) e Dimensões (dimensions):**
    - **Prioridade do peso**: Se o corpo do e-mail do cliente mencionar explicitamente o peso TOTAL consolidado de todas as cargas do embarque, utilize esse valor.
    - **Notas de embalagem gross/net**: Em linhas como "Box 1: 53x53x20 cm, 12 / 7 kg (gross/net weight)", os valores 12 e 7 são respectivamente peso bruto e líquido daquela caixa, NÃO quantidades. Conte "Box 1", "Box 2", etc. como volumes individuais, some somente os primeiros pesos para gross_weight_kg e extraia as dimensões de cada caixa com quantidade 1. Se houver "TOTAL gross/net weight", esse total explícito tem prioridade.
    - **Cuidado com PDFs de packing list**: Tabelas de packing list em PDF frequentemente têm colunas grudadas na extração de texto (por exemplo, "2371" pode ser na verdade "237 kg" do gross weight + "1" da coluna de quantidade seguinte, ou "2501" = "250 kg" + "1"). NÃO some os números internos de cada item da tabela diretamente se houver um total explícito nela ou se houver um arquivo de packing list de imagem anexo legível.
    - **packages_count**: O número de volumes/caixas físicas do embarque (ex: 3 wooden boxes), NÃO a quantidade de peças individuais dentro das caixas (que podem ser 100 pcs, 20000 pcs etc.). Identifique também termos como "ctns", "ctn", "carton" ou "cartons" no packing list ou e-mail, pois eles significam caixas de papelão e devem ser contados como volumes físicos no packages_count.
    - **Dimensões com Quantidade (CRÍTICO)**: Cada item no array "dimensions" DEVE obrigatoriamente iniciar com a quantidade de volumes correspondente àquela dimensão usando o formato "[Quantidade]x [Comprimento]x[Widht]x[Altura] cm" (ex: "1x 50x50x28 cm", "2x 50x50x13 cm", "3x 37.5*31*37 cm" e "9x 63x41.5x38 cm"). Se a quantidade não for colocada na frente de cada dimensão, a cubagem acumulada falhará.
    - **Somente Extrair Itens com Dimensões Explícitas (CRÍTICO)**: Ao extrair o array de "dimensions", inclua APENAS as caixas/paletes que tenham medidas/dimensões explicitamente detalhadas no texto do e-mail ou documentos. Se um item (como Europacks, NPS400, etc.) for apenas mencionado por nome sem nenhuma dimensão explícita, NÃO tente deduzir nem criar dimensões artificiais para ele, pois supõe-se que ele já esteja consolidado e empilhado dentro dos paletes principais que possuem medidas informadas.
    - **Seguro (requires_insurance)**: Identifique se o e-mail original do cliente pede "com seguro", "frete com seguro", ou similar. Se sim, defina "requires_insurance" como true. Se pedir "sem seguro" ou não mencionar nada sobre seguro, defina como false.
    - **Múltiplos Shippers / Consolidação (CRÍTICO)**: Se a solicitação ou os anexos contiverem dados de múltiplos fornecedores (shippers), invoices ou packing lists distintos (ex: Shipper Yongsheng e Shipper Todenko no mesmo embarque/e-mail), você DEVE consolidar todas as cargas:
      1. Some os pesos brutos (gross_weight_kg) de todos os fornecedores (ex: 41.05 kg da Yongsheng + 113.40 kg da Todenko = 154.45 kg).
      2. Some a quantidade total de caixas/volumes (packages_count) de todos eles (ex: 3 caixas da Yongsheng + 9 caixas da Todenko = 12 volumes).
      3. Some o valor comercial total de todas as invoices. ATENÇÃO: O campo chama-se commercial_value_usd, mas se o documento estiver em EUR, BRL, GBP, ou qualquer outra moeda, extraia APENAS o valor numérico (ex: se for EUR 2610.00, retorne 2610). Não tente converter moedas.
      4. Junte todas as dimensões/medidas das caixas de todos os fornecedores (cada uma com seu respectivo multiplicador de quantidade na frente!) em uma lista consolidada única de dimensions.
    - **Embarque Híbrido / Dois Modais (CRÍTICO, diferente de "Múltiplos Shippers")**: A regra de consolidação acima é para vários fornecedores DO MESMO embarque/modal. Se, em vez disso, a solicitação descrever CLARAMENTE dois embarques distintos com modais diferentes (ex: "uma parte segue por avião e outra por navio", ou dois pedidos de cotação separados, um aéreo e outro marítimo/LCL/FCL, no mesmo e-mail), NÃO os consolide em um único cargo: escolha o modal predominante ou o primeiro mencionado para o campo "type" (você ainda deve escolher um valor válido), mas defina "hybrid_shipment_detected" como true e explique em "hybrid_shipment_note" quais trechos indicam os dois modais. NÃO marque true por menções incidentais de transporte (ex: "levar de caminhão até o aeroporto/porto" é apenas logística de um único embarque, não dois modais).

    Retorne o JSON estruturado conforme o schema fornecido nas configurações de geração.`;

    const contentPayload = await buildTokenSafeContent(model, prompt, mediaParts);

    const result = await withRetry(() => model.generateContent(contentPayload));
    const parsed = JSON.parse(result.response.text().trim());
    if (parsed.route?.incoterm) {
      parsed.route.incoterm = normalizeIncotermText(parsed.route.incoterm);
    }
    if (parsed.route) {
      parsed.route.origin_address_source = parsed.route.origin_city ? (parsed.route.origin_address_source || 'TEXT') : 'NOT_FOUND';
      parsed.route.destination_address_source = parsed.route.destination_city ? (parsed.route.destination_address_source || 'TEXT') : 'NOT_FOUND';
      parsed.route.transport_source = parsed.route.needs_transport ? (parsed.route.transport_source || 'EXPLICIT_TEXT') : 'NOT_REQUESTED';
      if (!parsed.route.needs_transport) parsed.route.transport_evidence = '';
    }
    if (parsed.cargo) {
      parsed.cargo.dangerous_goods_status = normalizeDangerousGoodsStatus(parsed.cargo.dangerous_goods_status, parsed.cargo.is_imo);
      parsed.cargo.is_imo = parsed.cargo.dangerous_goods_status === DG_STATUS.CONFIRMED;
      parsed.cargo.msds_status = normalizeMsdsStatus(parsed.cargo.msds_status, parsed.cargo.dangerous_goods_status);
      const packagingFacts = extractPackagingFacts(text);
      if (packagingFacts) {
        parsed.cargo.gross_weight_kg = packagingFacts.grossWeightKg;
        parsed.cargo.packages_count = packagingFacts.packagesCount;
        parsed.cargo.dimensions = packagingFacts.dimensions;
      }
      const packagesCount = parseInt(parsed.cargo.packages_count, 10) || 1;
      const dims = parsed.cargo.dimensions || [];
      const computedCbm = calculateCbmFromDimensions(dims, packagesCount);
      parsed.cargo.total_cbm = computedCbm || null;
    }
    return parsed;
  } catch (error: any) {
    console.error('[extractClientData] ERRO REAL:', error?.message || error);
    if (error?.response) console.error('[extractClientData] API response:', JSON.stringify(error.response));
    if (error?.isRetryExhausted) throw new Error(AI_OVERLOAD_MESSAGE);
    throw new Error('Falha ao processar dados do cliente com IA: ' + (error?.message || String(error)));
  }
};
export function buildAgentDraftDataContext(data: DraftPayload): string {
  const isSeaFcl = data.modal === 'SEA' && String(data.loadType).startsWith('FCL');
  const containerInfo = isSeaFcl ? extractContainerInfo(data.packages, data.totalPackages, data.loadType) : null;

  return `- Origem (Porto/Aeroporto): ${data.originPort || data.originCity || 'TBD'}
    - Destino (Porto/Aeroporto): ${data.destinationPort || data.destinationCity || 'TBD'}
    - Local Inicial (Coleta): ${data.originCity || 'TBD'}
    - País de Origem: ${data.originCountry || 'TBD'}
    - Destino Final (Entrega): ${data.destinationCity || 'TBD'}
    - País de Destino: ${data.destinationCountry || 'TBD'}
    - Conexões (Voo/Porto): ${data.connections || 'Sem conexões (direto)'}
    - Incoterm: ${data.incoterm || 'TBD'}
    - Inland de Origem necessário: ${data.needsOriginInland ? 'SIM' : 'NÃO'}
    - Rota do Inland de Origem: ${data.needsOriginInland ? (data.originInlandRoute || 'A confirmar') : 'Não aplicável'}
    - Modal: ${data.modal === 'AIR' ? 'Aéreo (AIR)' : data.modal === 'SEA' ? 'Marítimo (SEA)' : data.modal || 'TBD'}
    - Modal/Tipo: ${data.loadType || 'TBD'}
    ${containerInfo ? `- Quantidade/Tipo de Container: ${containerInfo.qty}x ${containerInfo.type}` : ''}
    - Peso Bruto: ${data.totalGrossWeightKg || 'TBD'} kg
    - Peso Líquido: ${data.totalNetWeightKg || 'Não informado'} kg
    - Volumes: ${data.totalPackages || 'TBD'}
    - Dimensões: ${data.packages || 'Não informado'}
    - CBM Total: ${data.totalCbm || 'Não informado'}
    - Descrição da Carga: ${data.cargoDescription || 'Não informada'}
    - NCM: ${data.ncmCodes || 'Não informado'}
    - Nome do Cliente: ${data.clientName || 'Não informado'}
    - CNPJ do Cliente: ${data.clientCnpj || 'Não informado'}
    - Valor da Carga: ${data.commercialValue ? `${data.commercialCurrency || 'USD'} ${data.commercialValue}` : 'Não informado'}
    - Carga perigosa (DG/IMO): ${data.dangerousGoodsStatus === 'CONFIRMED' ? 'SIM' : data.dangerousGoodsStatus === 'TO_CONFIRM' ? 'A CONFIRMAR' : 'NÃO'}
    - MSDS: ${data.msdsStatus || 'NÃO INFORMADO'}
    - UN / Classe de risco: ${data.unNumber || 'Não informado'} / ${data.dangerousGoodsClass || 'Não informada'}
    - Produtos perigosos distintos: ${data.dangerousGoodsProductCount ?? 'Não informado'}
    - Carga empilhável: ${data.stackableStatus === 'STACKABLE' ? 'SIM' : data.stackableStatus === 'NOT_STACKABLE' ? 'NÃO' : 'A CONFIRMAR'}
    - Seguro solicitado: ${data.requiresInsurance ? 'SIM' : 'NÃO'}
    - Estimativa de armazenagem solicitada: ${data.requiresStorageEstimate ? 'SIM' : 'NÃO'}
    - Evidência da solicitação de armazenagem: ${data.storageRequestEvidence || 'Não aplicável'}
    ${data.reference ? `- Referência: ${data.reference}` : ''}`;
}

export function buildTruckerDraftDataContext(data: DraftPayload): string {
  return `- Trecho/Rota Rodoviária: ${data.transportRoute || 'TBD'}
    - Modal de Chegada/Embarque: ${data.modal === 'AIR' ? 'Aéreo (AIR)' : data.modal === 'SEA' ? 'Marítimo (SEA)' : data.modal || 'TBD'}
    - Tipo de Carga/Modal: ${data.loadType || 'TBD'}
    - Peso Bruto Total: ${data.totalGrossWeightKg || 'TBD'} kg
    - Peso Líquido Total: ${data.totalNetWeightKg || 'Não informado'} kg
    - Volumes: ${data.totalPackages || 'TBD'}
    - Dimensões das Embalagens: ${data.packages || 'Não informado'}
    - CBM Total: ${data.totalCbm || 'Não informado'}
    - Descrição da Carga: ${data.cargoDescription || 'Não informada'}
    - Valor da Carga (para Seguro/GR): ${data.commercialValue ? `${data.commercialCurrency || 'USD'} ${data.commercialValue}` : 'Não informado'}
    - Carga Perigosa (DG/IMO): ${data.dangerousGoodsStatus === 'CONFIRMED' ? 'SIM (verificar MOPP e veículo adequado)' : data.dangerousGoodsStatus === 'TO_CONFIRM' ? 'A CONFIRMAR' : 'NÃO'}
    - MSDS: ${data.msdsStatus || 'NÃO INFORMADO'}
    ${data.reference ? `- Referência do Processo: ${data.reference}` : ''}`;
}

export const generateAgentDraft = async (data: DraftPayload, contextRules: string = '', contactName?: string, requiredFieldLabels: string[] = []) => {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const greeting = contactName ? `Inicie o email saudando o contato exatamente assim: Prezado(a) ${contactName},` : `Inicie o email com: Prezado(a) Agente,`;
    
    const prompt = `Você é um agente de pricing escrevendo um e-mail para solicitar cotação de frete internacional a um coloader/agente.
    ${greeting}
    
    INSTRUÇÃO CRÍTICA DE IDIOMA:
    Escreva o e-mail SEMPRE inteiramente em Português (Brasil) para revisão prévia do operador logístico.

    Use os dados abaixo para redigir o corpo do e-mail. Se o e-mail original for fornecido, use-o APENAS para contexto complementar.
    ATENÇÃO: Os "DADOS EXTRAÍDOS DA CARGA" fornecidos abaixo têm precedência absoluta. Se houver divergência entre os dados abaixo e o e-mail original (ex: pesos ou dimensões diferentes), VOCÊ DEVE USAR OS DADOS EXTRAÍDOS ABAIXO, pois eles já foram validados e corrigidos manualmente pelo agente.

    REGRAS E DIRETRIZES DE NEGÓCIO IMPORTANTES:
    ${contextRules}
    
    DADOS EXTRAÍDOS DA CARGA:
    ${buildAgentDraftDataContext(data)}

    ${data.originalEmailText ? `CONTEÚDO DO E-MAIL ORIGINAL DO CLIENTE:\n${data.originalEmailText}` : ''}
    
    Instruções adicionais importantes:
    1. **Atenção estrita ao Modal:** Identifique se o Modal é **Aéreo (AIR)** ou **Marítimo (SEA)**. Se o modal for **Aéreo (AIR)**, formate uma solicitação de cotação de frete aéreo internacional por kg (peso taxável e bruto). **NUNCA** mencione contêineres, armadores, taxas de devolução/demasia de contêineres ou qualquer termo marítimo no e-mail, mesmo que apareçam em regras genéricas. Se o modal for **Marítimo (SEA)**, formule a solicitação para frete marítimo (FCL ou LCL).
    2. Analise o CONTEÚDO DO E-MAIL ORIGINAL DO CLIENTE (se disponível) juntamente com as REGRAS E DIRETRIZES DE NEGÓCIO IMPORTANTES (que contêm explicações de siglas de e-mails, tipos de container, etc.).
    3. Caso haja siglas no e-mail original explicadas nas regras (por exemplo, siglas indicando container Open Top (OT) e/ou High Cube (HC), como "4 x 40' OT HC" ou "OP e HC"), e o modal for Marítimo, certifique-se de aplicar essa regra e solicitar os tipos corretos de equipamentos (containers) no e-mail (por exemplo, especificando container Open Top High Cube ou OP e HC) no lugar de um contêiner Dry comum.
    4. Analise as Dimensões/CBM nos DADOS EXTRAÍDOS DA CARGA. Se o modal for Marítimo e contiver qualquer menção a tipos especiais de containers (como "OT", "HC", "Open Top", "High Cube", "OP", etc.), incorpore essa exigência no e-mail de cotação.
    5. Se "Inland de Origem necessário" for SIM, solicite separadamente o valor e o prazo da coleta terrestre na origem para a rota informada. Não misture esse custo com AWB, handling, THC ou outras taxas locais.
    5.1. Se "Estimativa de armazenagem solicitada" for SIM, solicite obrigatoriamente a estimativa de armazenagem no destino, com base de cálculo, período considerado e free time. Não omita esse item.
    5. **Rota com UN/LOCODE**: Ao citar a rota do embarque (Origem e Destino) no e-mail, identifique e coloque o respectivo código de porto ou aeroporto (UN/LOCODE) correspondente ao lado do nome da cidade (por exemplo: "Shanghai (CNSHA)" e "Santos (BRSSZ)"), caso o local de origem ou destino seja conhecido.
    6. **Prazo de Resposta com Antecedência (12h)**: Se o cliente ou o e-mail original estipular uma data, hora ou prazo limite (deadline) para a entrega da proposta de cotação, calcule um limite de tempo para o retorno do agente que seja exatamente **12 horas antes** desse prazo original e mencione de forma clara no e-mail (por exemplo: se o cliente pediu retorno até dia 28 às 18h, peça ao agente até o dia 28 às 06h).
    7. **Omitir Taxas de Destino Silenciosamente**: Se houver regras sobre taxas de destino (como não pedi-las para agentes da origem), simplesmente **não as peça** no e-mail (solicite apenas o frete e taxas locais de origem, ex: THC, documentação, etc.). **NUNCA escreva frases negativas no e-mail dizendo que não precisa de taxas de destino** (ex: NÃO escreva "não precisamos das taxas de destino" ou "não enviar taxas de destino"). Apenas ignore as taxas de destino silenciosamente no e-mail.
    8. Redija o e-mail de forma direta e profissional. Sem saudações excessivas, apenas o necessário. Em português (Brasil) ou inglês simples.
    8.1. **Descrição da Mercadoria (OBRIGATÓRIO)**: Se "Descrição da Carga" nos DADOS EXTRAÍDOS DA CARGA não for "Não informada", inclua-a literalmente no corpo do e-mail (ex: "Mercadoria: [descrição]"), sem resumir, reescrever ou traduzir o texto original.
    9. **Conexões**: Se houver conexões do voo ou do porto especificadas nos DADOS EXTRAÍDOS DA CARGA (diferente de "Sem conexões"), mencione-as de forma clara no e-mail (ex: "via MIA" ou "com transbordo em Algeciras") para que o coloader/agente faça a cotação exatamente na rota solicitada.
    10. **Remoção de Telefones e Contatos da Assinatura**: Ao assinar o e-mail (ou finalizar o corpo do e-mail), **NUNCA** inclua informações de contato pessoal extraídas do e-mail do cliente (como nomes de pessoas de contato, ex: "Magda", "Talitha", etc., endereços de e-mail específicos, números de telefone comercial, ramal ou telefones celulares). A assinatura do e-mail deve ser estritamente genérica e neutra (ex: apenas "Atenciosamente," ou "Best regards,"), sem listar quaisquer nomes, telefones ou e-mails adicionais.
    11. **Cotações Consolidadas LCL / Co-Loader com Múltiplos Shippers/Fornecedores**:
        - Se o CONTEÚDO DO E-MAIL ORIGINAL DO CLIENTE contiver múltiplos fornecedores/shippers (com Incoterms mistos EXW e FOB, ou diferentes endereços de origem):
          - **Estruturação por Fornecedor**: Destaque primeiro o Nome e o **CNPJ do Cliente** para que o Co-Loader calcule a estimativa de armazenagem no destino no Brasil.
          - Monte uma lista numerada separada para CADA SHIPPER / FORNECEDOR identificado no e-mail do cliente, contendo:
            * Nome do Shipper / Fornecedor;
            * Incoterm específico daquele fornecedor (EXW ou FOB);
            * Se o Incoterm do fornecedor for **EXW / EX WORKS**: inclua o Endereço Exato de Coleta na Origem acompanhado obrigatoriamente do destaque **"(REQUER COLETA NA ORIGEM)"** (NUNCA escreva sem coleta para EXW);
            * Se o Incoterm do fornecedor for **FOB**: inclua o destaque **"(SEM COLETA NA ORIGEM - Entrega direta no armazém/CFS pelo fornecedor)"**;
            * Dimensões/medidas, peso bruto e valor comercial (USD) correspondentes àquele fornecedor específico.
          - Inclua um RESUMO CONSOLIDADO no final com o total de fornecedores, peso bruto total, CBM total e valor comercial total.
    12. **Itens obrigatórios no e-mail**: Garanta que o e-mail mencione claramente, ou solicite explicitamente ao agente, cada um dos itens a seguir (informe se já for um dado conhecido, ou peça ao agente se for algo a cotar):
    ${requiredFieldLabels.length ? requiredFieldLabels.map(l => `- ${l}`).join('\n    ') : 'Nenhum item adicional configurado.'}
    13. **Filtro Estrito de DTA e Rodoviário de Destino**: O agente internacional é responsável APENAS pelo frete internacional (e origem, quando aplicável). Portanto, mesmo que o E-MAIL ORIGINAL DO CLIENTE solicite cotação de **DTA (Trânsito Aduaneiro)** ou **Frete Rodoviário Nacional/Inland no destino** (entrega final no Brasil), VOCÊ DEVE OMITIR COMPLETAMENTE essas solicitações no rascunho. **NUNCA** mencione, pergunte, explique ou solicite DTA, trânsito aduaneiro ou entrega rodoviária no país de destino neste e-mail.

    Retorne APENAS o corpo do e-mail.`;

    const result = await withRetry(() => model.generateContent(prompt));
    return result.response.text().trim();
  } catch (error: any) {
    if (error?.isRetryExhausted) throw new Error(AI_OVERLOAD_MESSAGE);
    throw new Error('Falha ao gerar rascunho com IA');
  }
};

export const generateTruckerDraft = async (data: DraftPayload, contextRules: string = '', contactName?: string) => {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const greeting = contactName ? `Inicie o email saudando o contato exatamente assim: Prezado(a) ${contactName},` : `Inicie o email com: Prezada Transportadora,`;
    
    const prompt = `Você é um analista de logística de comércio exterior escrevendo um e-mail para solicitar cotação de frete rodoviário nacional (transporte terrestre doméstico no Brasil).
    ${greeting}
    
    INSTRUÇÃO CRÍTICA DE IDIOMA:
    Escreva o e-mail SEMPRE inteiramente em Português (Brasil).

    Use os dados abaixo para redigir o corpo do e-mail de forma profissional e objetiva.

    DADOS DA SOLICITAÇÃO RODOVIÁRIA:
    ${buildTruckerDraftDataContext(data)}

    Regras e Instruções Específicas para o E-mail de Transportadora:
    1. **Foco Rodoviário Doméstico:** Solicite a cotação do frete rodoviário para o trecho rodoviário indicado.
    2. **Apresentação Obrigatória dos Dados Físicos (CRÍTICO):** Você deve incluir obrigatoriamente no corpo do e-mail, de forma clara e estruturada (em tópicos/lista), as informações físicas da carga (Peso Bruto total, quantidade de volumes e dimensões/embalagens). Nunca omita estes dados.
    3. **Tipo de Equipamento e Exclusão Mútua Rígida (CRÍTICO):**
       - **Se o tipo de carga/modal for LCL ou AIR_GENERAL:** Solicite estritamente veículo rodoviário para carga solta/fracionada (ex: Fiorino, HR, VUC, caminhão 3/4, Toco, Truck ou Carreta Baú) que seja adequado para o peso e dimensões fornecidos. **NÃO mencione** de forma alguma contêineres de 20 ou 40 pés, devolução de vazio, demurrage de container ou chassi porta-contêiner no e-mail.
       - **Se o tipo de carga/modal for FCL (FCL_20 ou FCL_40):** Solicite transporte para contêiner cheio de 20' ou 40' (conforme o tipo de carga), necessitando de chassi porta-contêiner e cavalo mecânico, e solicite a inclusão dos custos de devolução do contêiner vazio no porto. **NÃO mencione** de forma alguma Fiorino, HR, VUC, caminhão 3/4, Toco ou Truck.
    4. **Detalhamento de Custos:** Solicite que venha especificado na proposta:
       - Frete Peso / Frete Valor
       - Taxa de pedágio (se cobrado à parte)
       - Ad Valorem e GRIS (Gerenciamento de Risco)
       - Franquia de tempo (horas livres) para carregamento e descarregamento (e valor da hora excedente/pernoite).
    5. **Assinatura Neutra:** Finalize com uma assinatura genérica ("Atenciosamente,"), sem listar contatos de pessoas físicas adicionais.

    Retorne APENAS o corpo do e-mail.`;

    const result = await withRetry(() => model.generateContent(prompt));
    return result.response.text().trim();
  } catch (error: any) {
    if (error?.isRetryExhausted) throw new Error(AI_OVERLOAD_MESSAGE);
    throw new Error('Falha ao gerar rascunho de transportadora com IA');
  }
};

export const generateDtaDraft = async (data: DraftPayload, leg: any, contextRules: string = '', contactName?: string) => {
  try {
    const model = genAI.getGenerativeModel({ model:'gemini-2.5-flash' });
    const greeting = contactName ? `Inicie exatamente com: Prezado(a) ${contactName},` : 'Inicie com: Prezado(a),';
    const prompt = `Você é um analista de comércio exterior solicitando uma cotação de DTA (Declaração de Trânsito Aduaneiro) no Brasil.
${greeting}
Escreva em Português (Brasil), de forma objetiva. A carga AINDA NÃO FOI NACIONALIZADA e permanece sob controle aduaneiro. Não trate este serviço como entrega rodoviária nacional comum.

DADOS DO TRECHO DTA:
- Rota: ${leg.route || 'A confirmar'}
- Unidade aduaneira de origem: ${leg.customsUnit || leg.originLocation || 'A confirmar'}
- Recinto alfandegado de destino: ${leg.bondedTerminal || leg.destinationLocation || 'A confirmar'}
- Modal internacional vinculado: ${data.modal || 'A confirmar'}
- Peso bruto: ${data.totalGrossWeightKg ?? 'A confirmar'} kg
- Volumes: ${data.totalPackages ?? 'A confirmar'}
- Dimensões/embalagens: ${data.packages || 'A confirmar'}
- Valor da carga: ${data.commercialValue ? `${data.commercialCurrency || 'USD'} ${data.commercialValue}` : 'A confirmar'}
- Carga perigosa: ${data.dangerousGoodsStatus === 'CONFIRMED' ? 'SIM' : data.dangerousGoodsStatus === 'TO_CONFIRM' ? 'A CONFIRMAR' : 'NÃO'}
- Referência: ${data.reference || 'Não informada'}

Solicite separadamente: frete DTA, emissão/documentação, pedágio, GRIS, ad valorem, gerenciamento de risco, escolta quando aplicável, estadia/horas livres, tributos inclusos ou não, prazo de trânsito e validade. Peça confirmação de habilitação operacional para o recinto e o regime aduaneiro. Não inclua desembaraço de importação nem entrega final após nacionalização.

REGRAS CADASTRADAS:
${contextRules}

Finalize apenas com "Atenciosamente,". Retorne somente o corpo do e-mail.`;
    const result = await withRetry(() => model.generateContent(prompt));
    return result.response.text().trim();
  } catch (error: any) {
    if (error?.isRetryExhausted) throw new Error(AI_OVERLOAD_MESSAGE);
    throw new Error('Falha ao gerar rascunho de DTA com IA');
  }
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
                freight_value: { type: 'number', description: 'Valor do frete internacional bruto calculado. Quando houver múltiplas opções (rate_options preenchido), repita aqui o valor da PRIMEIRA opção listada, apenas por compatibilidade — a escolha final é feita pelo usuário a partir de rate_options.' },
                freight_currency: { type: 'string', description: 'Moeda original do frete (ex: USD, EUR, BRL)' },
                freight_usd: { type: 'number', description: 'Valor do frete convertido em USD' },
                rate_options: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      label: { type: 'string', description: 'Nome curto da opção como o agente descreveu ou como você a identificaria (ex: "Direto", "Via Miami", "1 escala", "Standard", "Express").' },
                      freight_value: { type: 'number' },
                      freight_currency: { type: 'string' },
                      transit_time: { type: 'string' },
                      carrier: { type: 'string' },
                      frequency: { type: 'string' }
                    },
                    required: ['label', 'freight_value']
                  },
                  description: 'Preencha SOMENTE quando o agente oferecer explicitamente DUAS OU MAIS alternativas de frete/prazo para o MESMO embarque na mesma resposta (ex: rota direta vs com escala, standard vs express, via porto/aeroporto A vs B). NÃO é uma alternativa: equipamentos diferentes (20 pés vs 40 pés), destinos diferentes, ou embarques distintos — isso não entra aqui. Deixe o array vazio quando houver apenas uma opção de frete na resposta.'
                },
                iof_usd: { type: 'number', description: 'Valor de IOF em USD se aplicável (normalmente 3.5% do frete)' },
                storage_brl: { type: 'number', description: 'Valor estimado de armazenagem em BRL se houver' },
                services_brl: { type: 'number', description: 'Valor total de taxas locais e taxas de destino em BRL' },
                taxes_brl: { type: 'number', description: 'Valor total de impostos locais em BRL' },
                total_brl: { type: 'number', description: 'Valor total em BRL se houver' },
                invoice_value: { type: 'number', description: 'Valor da mercadoria ou Invoice (em USD) citado no e-mail, se houver' },
                insurance_requested: { type: 'boolean', description: 'Verdadeiro (true) se o e-mail solicitar cotação ou inclusão de Seguro Internacional (insurance)' },
                carrier: { type: 'string', description: 'Nome completo da Cia Aérea ou Armador (operadora real do transporte) por extenso. NUNCA o nome da empresa remetente da resposta (coloader/agente/desconsolidador) — veja regra de desambiguação nas instruções.' },
                vessel_name: { type: 'string', description: 'Nome do navio informado no retorno marítimo.' },
                voyage_number: { type: 'string', description: 'Número da viagem/voyage do navio.' },
                free_time_days: { type: 'number', description: 'Quantidade de dias de free time informada.' },
                rate_valid_until: { type: 'string', description: 'Data limite de validade da tarifa, preferencialmente ISO YYYY-MM-DD.' },
                rate_validity_source: { type: 'string', description: 'AGENT_EMAIL quando a validade estiver no corpo da resposta atual; TARIFF quando estiver em anexo/tarifário da resposta atual.' },
                rate_validity_evidence: { type: 'string', description: 'Trecho curto e literal que comprova a validade identificada.' },
                rate_validity_confidence: { type: 'number', description: 'Confiança de 0 a 1 especificamente para a leitura da validade.' },
                transshipments: { type: 'array', items: { type:'object', properties: { port:{type:'string'}, locode:{type:'string'}, eta:{type:'string'}, etd:{type:'string'}, vessel:{type:'string'}, voyage:{type:'string'}, notes:{type:'string'} }, required:['port'] }, description:'Lista estruturada de transbordos da rota marítima.' },
                origin_airport: { type: 'string', description: 'Porto ou Aeroporto de Origem informado pelo agente (sigla IATA ou nome, ex: PEK ou Beijing)' },
                connections: { type: 'string', description: 'Conexões ou escalas informadas pelo agente. Ex: PEK-NRT-USA-GRU. Retorne string vazia se for direto.' },
                origin_fees: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string', description: 'Nome da taxa de origem (ex: AWB Fee, CGC, Terminal Charges, Pick up, Handling)' },
                      value: { type: 'number', description: 'Compatibilidade: valor total calculado da taxa' },
                      unitValue: { type: 'number', description: 'Valor unitário antes da multiplicação' },
                      currency: { type: 'string', description: 'Moeda da taxa (ex: USD, EUR, BRL)' },
                      billingUnit: { type: 'string', enum: ['TOTAL_SHIPMENT','PER_DG_PRODUCT','PER_ITEM','PER_PACKAGE','PER_DOCUMENT','PER_HAWB','PER_MAWB','PER_SHIPMENT','PER_CONTAINER','PER_BL','PER_KG','PER_CHARGEABLE_WEIGHT','PER_CBM','PER_TON','PER_WM','PERCENTAGE','UNKNOWN'] },
                      originalUnit: { type: 'string' }, quantity: { type: 'number' }, totalValue: { type: 'number' },
                      quantitySource: { type: 'string' }, evidence: { type: 'string' }, confidence: { type: 'number' }, needsReview: { type: 'boolean' },
                      explicitZero: { type: 'boolean', description: 'True quando a fonte informou explicitamente valor zero; false para valor ausente.' },
                      sourceOrigin: { type: 'string', enum: ['PARTNER_EMAIL','SYSTEM_CATALOG'], description: 'Origem real do valor: retorno do parceiro ou catálogo cadastrado.' },
                      ispsClassification: { type: 'string', enum: ['ISPS_CARRIER','ISPS_TERMINAL','ISPS_UNCLASSIFIED'] },
                      applicationScope: { type: 'string', enum: ['ORIGIN','DESTINATION','TRANSIT','UNKNOWN'] },
                      chargedBy: { type: 'string' },
                      includedInFreight: { type: 'string', enum: ['INCLUDED','NOT_INCLUDED','TO_CONFIRM'] },
                      financialGroup: { type: 'string', enum: ['INTERNATIONAL_FREIGHT','FREIGHT_COMPONENT','ORIGIN_CHARGE','DESTINATION_CHARGE','DG_CHARGE','CUSTOMS_CHARGE','INSURANCE','TAX_IOF','PROFIT','TO_CONFIRM'] },
                      chargeNature: { type: 'string', enum: ['BASE_FREIGHT','FUEL','SECURITY','DG','CUSTOMS','INSURANCE','TAX','PROFIT','LOCAL_SERVICE','OTHER'] },
                      classificationSource: { type: 'string', enum: ['AI'] }
                    },
                    required: ['name', 'value']
                  },
                  description: 'Lista de taxas locais na origem (EXW local charges) especificadas no e-mail do agente'
                },
                origin_inland: {
                  type: 'object',
                  properties: {
                    quoted: { type: 'boolean', description: 'Verdadeiro quando o agente informou custo de coleta/pick up terrestre na origem.' },
                    route: { type: 'string', description: 'Rota da coleta na origem, quando informada.' },
                    value: { type: 'number', description: 'Valor total do Pick Up/Inland de origem.' },
                    currency: { type: 'string', description: 'Moeda do Inland de origem.' },
                    transit_time: { type: 'string', description: 'Prazo da coleta na origem, quando informado.' }
                  },
                  required: ['quoted', 'value']
                },
                destination_fees: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string', description: 'Nome da taxa de destino (ex: Delivery Fee, CCT Fee, Desconsolidação, Frete Rodoviário Nacional)' },
                      value: { type: 'number', description: 'Compatibilidade: valor total calculado da taxa' },
                      unitValue: { type: 'number', description: 'Valor unitário antes da multiplicação' },
                      currency: { type: 'string', description: 'Moeda da taxa (ex: USD, EUR, BRL)' },
                      billingUnit: { type: 'string', enum: ['TOTAL_SHIPMENT','PER_DG_PRODUCT','PER_ITEM','PER_PACKAGE','PER_DOCUMENT','PER_HAWB','PER_MAWB','PER_SHIPMENT','PER_CONTAINER','PER_BL','PER_KG','PER_CHARGEABLE_WEIGHT','PER_CBM','PER_TON','PER_WM','PERCENTAGE','UNKNOWN'] },
                      originalUnit: { type: 'string' }, quantity: { type: 'number' }, totalValue: { type: 'number' },
                      quantitySource: { type: 'string' }, evidence: { type: 'string' }, confidence: { type: 'number' }, needsReview: { type: 'boolean' },
                      explicitZero: { type: 'boolean', description: 'True quando a fonte informou explicitamente valor zero; false para valor ausente.' },
                      sourceOrigin: { type: 'string', enum: ['PARTNER_EMAIL','SYSTEM_CATALOG'], description: 'Origem real do valor: retorno do parceiro ou catálogo cadastrado.' },
                      ispsClassification: { type: 'string', enum: ['ISPS_CARRIER','ISPS_TERMINAL','ISPS_UNCLASSIFIED'] },
                      applicationScope: { type: 'string', enum: ['ORIGIN','DESTINATION','TRANSIT','UNKNOWN'] },
                      chargedBy: { type: 'string' },
                      includedInFreight: { type: 'string', enum: ['INCLUDED','NOT_INCLUDED','TO_CONFIRM'] },
                      financialGroup: { type: 'string', enum: ['INTERNATIONAL_FREIGHT','FREIGHT_COMPONENT','ORIGIN_CHARGE','DESTINATION_CHARGE','DG_CHARGE','CUSTOMS_CHARGE','INSURANCE','TAX_IOF','PROFIT','TO_CONFIRM'] },
                      chargeNature: { type: 'string', enum: ['BASE_FREIGHT','FUEL','SECURITY','DG','CUSTOMS','INSURANCE','TAX','PROFIT','LOCAL_SERVICE','OTHER'] },
                      classificationSource: { type: 'string', enum: ['AI'] }
                    },
                    required: ['name', 'value']
                  },
                  description: 'Lista de taxas locais no destino (taxas locais de destino / frete rodoviário) especificadas no e-mail'
                },
                transit_time: { type: 'string', description: 'Tempo de trânsito literal informado pelo agente (ex: "3 days", "9-12 days", "35 dias"). Se não informado, retorne "n/a".' },
                frequency: { type: 'string', description: 'Frequência de saídas ou voos informada pelo agente. Se o agente indicar termos como "D26", "D2,6", "D2/6", etc., converta para "2x por semana (D26)" ou similar. Se não informado, retorne "Semanal".' },
                weight_break: { type: 'string', description: 'Faixa tarifária de peso aplicada no frete aéreo pelo agente se houver no texto. Exemplos de retorno: "normal", "+45", "+100", "+300", "+500", "+1000". Se o e-mail do agente contiver termos como "+100kg", "above 100kg", "+100", extraia "+100". Se não aplicável ou não mencionado, retorne "normal".' },
                confidence: { type: 'number', description: 'Grau de confiança na extração' },
                present_fields: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Nomes exatos dos campos explicitamente encontrados na resposta atual ou em seus anexos. Não inclua defaults nem dados presentes apenas no histórico.'
                },
                field_evidence: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      field: { type: 'string' },
                      evidence: { type: 'string', description: 'Trecho curto que comprova o valor.' },
                      source: { type: 'string', description: 'latest_reply ou nome do anexo.' }
                    },
                    required: ['field', 'evidence', 'source']
                  }
                }
              },
              required: ['freight_value', 'freight_currency', 'freight_usd', 'transit_time', 'frequency', 'weight_break', 'present_fields', 'field_evidence']
            }
          },
          required: ['costs']
        } as any
      }
    });

    const safeSourceText = compactAiText(text, MAX_SOURCE_TEXT_CHARS);
    const safeContextRules = compactAiText(contextRules, MAX_CONTEXT_TEXT_CHARS);
    const safeLocalFeesTable = compactAiText(localFeesTable, MAX_CONTEXT_TEXT_CHARS);
    const safeQuotationContext = compactAiText(quotationContext, 30_000);

    const prompt = `Você é um especialista em comércio exterior brasileiro.
    Analise o RETORNO DO AGENTE e extraia os custos informados.

    REGRAS E DIRETRIZES DE NEGÓCIO IMPORTANTES:
    ${safeContextRules}

    ${safeQuotationContext ? `CONTEXTO DA COTAÇÃO ORIGINAL:\n${safeQuotationContext}` : ''}
    
    ${safeLocalFeesTable ? `${safeLocalFeesTable}` : ''}

    Instruções Gerais de Extração:
    - **Números e moedas:** respeite a notação brasileira. Exemplos: "R$ 2.472,84" = 2472.84 BRL; "US$ 2,84" = 2.84 USD. Normalize R$ para BRL e US$ para USD. Nunca descarte o separador de milhar como se o valor fosse decimal.
    - **Conciliação:** quando houver composição final ou total geral, confira se a soma das parcelas bate com esse total. Se houver diferença, releia primeiro separadores de milhar, moeda e coluna da parcela antes de responder.
    - **Zero explícito:** uma taxa expressamente informada como zero deve permanecer na lista com value=0, totalValue=0 e explicitZero=true. Valor zero não é o mesmo que taxa ausente.
    - **Procedência por taxa:** use sourceOrigin=PARTNER_EMAIL somente para valores presentes na resposta/anexo atual. Use sourceOrigin=SYSTEM_CATALOG somente para valores obtidos do catálogo cadastrado fornecido no contexto. Não atribua uma taxa do catálogo ao e-mail.
    0. **Resposta atual x histórico:** O texto pode conter blocos identificados como RESPOSTA ATUAL, ANEXOS DA RESPOSTA ATUAL e HISTÓRICO DA CONVERSA. Extraia valores somente da RESPOSTA ATUAL e de seus anexos. Use o histórico apenas para entender o contexto e nunca copie dele um preço que não tenha sido confirmado na resposta atual.
       - Preencha present_fields somente com campos realmente encontrados na resposta atual ou anexos.
       - Para cada campo presente, registre uma evidência curta em field_evidence.
       - Valores padrão exigidos pelo schema, como "Semanal", "normal" ou zero, não devem entrar em present_fields quando não estiverem expressos na resposta.
    1. **Tempo de Trânsito (Transit Time):** Identifique o tempo de trânsito (T/T ou Transit Time) mencionado no RETORNO DO AGENTE (ex: "3 days", "9-12 days", "35 dias"). Salve esse texto literal no campo "transit_time". Se não encontrar nenhuma menção ao tempo de trânsito, retorne "n/a".
    2. **Frequência (frequency):** Identifique a frequência de saída de voos ou navios no RETORNO DO AGENTE. Se o agente indicar termos como "D26", "D2,6", "D2/6", etc. (sinalizando saídas às terças e sábados no padrão IATA, ou segundas e sextas no informal), formate o resultado final como "2x por semana (D26)" ou similar que represente de forma clara a frequência. Se o agente apenas indicar "diário", "semanal", etc., extraia esse texto. Se não for informada nenhuma frequência, retorne "Semanal".
    3. **Origem (origin_airport):** Identifique o Porto ou Aeroporto de Origem que o agente cotou no RETORNO DO AGENTE (ex: PEK, WNZ, SZX, MXP). Salve o código IATA ou o nome do aeroporto correspondente.
    4. **Conexões (connections):** Identifique as conexões ou escalas informadas pelo agente (ex: "PEK-NRT-USA-GRU" ou "via MIA" ou "via NRT"). Salve a string no campo "connections". Retorne string vazia se for direto ou não houver menção a conexões.
       - Para modal marítimo, extraia também cada transbordo em "transshipments", separando porto, UN/LOCODE, ETA, ETD, navio e viagem quando informados.
       - Extraia ainda vessel_name, voyage_number, free_time_days e rate_valid_until quando presentes. Não invente dados ausentes.
       - **Validade da tarifa:** procure explicitamente por "valid until", "validity", "valid thru", "effective until", "validade até", "vigência" e intervalos de vigência. Retorne rate_valid_until em YYYY-MM-DD, rate_validity_evidence com o trecho literal e rate_validity_confidence entre 0 e 1.
       - Use rate_validity_source=AGENT_EMAIL quando estiver no corpo da RESPOSTA ATUAL; use TARIFF somente quando a evidência estiver em anexo/tarifário da resposta atual. Não use o histórico como fonte e não invente datas.
    5. **Inland de Origem (origin_inland) e Taxas Locais de Origem (origin_fees):**
       - Para CADA taxa retorne name, unitValue, currency, billingUnit, originalUnit, quantity, totalValue, quantitySource, evidence, confidence e needsReview. Mantenha value igual a totalValue por compatibilidade.
       - Para CADA taxa retorne também financialGroup, chargeNature e classificationSource=AI. A seção do documento não define sozinha o grupo financeiro.
       - Use INTERNATIONAL_FREIGHT somente para o frete marítimo base; FREIGHT_COMPONENT para BAF, CAF, LSS, PSS, GRI e outros adicionais do armador que compõem o frete; ORIGIN_CHARGE e DESTINATION_CHARGE para despesas locais; CUSTOMS_CHARGE para despacho/desembaraço; INSURANCE para seguro; TAX_IOF para impostos/IOF; PROFIT para margem; DG_CHARGE apenas quando a taxa DG não puder ser alocada com segurança em frete/origem/destino. Sem evidência suficiente use TO_CONFIRM.
       - chargeNature é independente do grupo: DG para carga perigosa, SECURITY para ISPS/security, FUEL para combustível, CUSTOMS, INSURANCE, TAX, PROFIT, BASE_FREIGHT, LOCAL_SERVICE ou OTHER.
       - Uma taxa encontrada em origin_fees pode ser FREIGHT_COMPONENT. Nunca a mantenha como ORIGIN_CHARGE apenas por estar na seção de origem.
       - Nunca presuma que o valor informado é por contêiner. Se unidade ou quantidade não estiver clara, use UNKNOWN ou deixe quantity ausente e needsReview=true; preserve o total explícito sem inventar multiplicador.
       - Classifique Pick Up, Pickup, Collection, Pre-carriage ou coleta da fábrica até o aeroporto/porto como origin_inland. Extraia valor, moeda, rota e prazo separadamente.
       - NÃO repita o Pick Up dentro de origin_fees.
       - Em origin_fees, identifique apenas as demais taxas locais na origem (AWB, Handling, THC, XRAY, Customs Clearance etc.).
       - Calcule o valor total de cada taxa:
         - Para taxas cotadas por remessa ("per shpt", "per shipment", "fixed", "Fixo", "per HAWB"), use o valor fixo.
         - Para taxas cotadas por peso ("per kg", "/kg"), multiplique o valor unitário pelo peso da carga (bruto ou taxável correspondente) e respeite o valor mínimo informado (ex: "Min US20.00/shpt" significa que o valor total daquela taxa deve ser no mínimo USD 20.00).
         - Para taxas cotadas por conjunto de documentos ("for each set of docs"), use o valor informado.
       - Retorne a lista de taxas em "origin_fees" com o respectivo "name" (por extenso, ex: "AWB Fee & CGC", "Terminal Charges", "Customs Clearance", "Handling Fee", "Pick Up"), "value" (número) e "currency" (moeda, ex: "USD", "BRL").
    6. **Taxas Locais de Destino e Rodoviário (destination_fees):** Identifique todas as taxas locais no destino (Destination charges) informadas no e-mail do agente ou cliente.
       - Para CADA taxa retorne name, unitValue, currency, billingUnit, originalUnit, quantity, totalValue, quantitySource, evidence, confidence e needsReview. Mantenha value igual a totalValue por compatibilidade.
       - DG Fee, IMO Fee, DGR Fee, Dangerous Goods Surcharge e Hazmat Fee são nomenclaturas equivalentes de taxa de carga perigosa. Preserve o nome original na resposta e extraia todas as ocorrências; o sistema fará a validação de possível duplicidade.
       - Uma taxa DG pode ser por produto perigoso, UN, volume DG, contêiner ou embarque. Use PER_DG_PRODUCT somente quando a fonte disser per DG/IMO product/item. Exemplo: USD 50 per DG item para 4 produtos => unitValue=50, billingUnit=PER_DG_PRODUCT, quantity=4, totalValue=200, value=200.
       - **ISPS:** normalize ISPS, International Ship and Port Facility Security e Terminal/Port Security Fee na família ISPS. Use ispsClassification=ISPS_CARRIER somente com evidência de armador/navio/frete marítimo; ISPS_TERMINAL somente com evidência de terminal/porto; caso contrário use ISPS_UNCLASSIFIED. Informe applicationScope, chargedBy e includedInFreight. ISPS isolada nunca deve ser classificada por suposição.
       - Se o frete disser all-in ou including ISPS, marque includedInFreight=INCLUDED. Se a proposta disser que ISPS é adicional/separada, use NOT_INCLUDED. Sem evidência, use TO_CONFIRM. Preserve o trecho em evidence.
       - Se houver menção ou solicitação de orçamento de frete rodoviário nacional (ex: transporte terrestre doméstico / rodoviário / entrega local de GRU para Itatiba, Jacareí, São Paulo, etc.), inclua essa taxa sob o nome "Frete Rodoviário Nacional [Trecho]" (ex: "Frete Rodoviário Nacional (GRU x Itatiba)"). IMPORTANTE: Se o documento ou e-mail de orçamento do frete rodoviário apresentar o valor "Sem impostos" e também um "Total previsto com impostos" (ex: com ICMS/ISS), você DEVE extrair obrigatoriamente o "Total previsto com impostos" (valor final) para esta taxa.
       - Calcule o valor total de cada taxa local de destino encontrada da mesma forma que na origem (valores fixos ou baseados em peso/Hawb).
       - Retorne a lista de taxas em "destination_fees" com o respectivo "name", "value" (número) e "currency" (moeda, ex: "USD", "BRL").
    7. **Seguro (Insurance):** Verifique se no texto do e-mail há pedido de "Seguro" (ex: "orçamento de frete aéreo com seguro", "incluir seguro"). Em caso positivo, marque "insurance_requested" como true e extraia o valor da mercadoria (Invoice) informado no texto (ex: "Valor da Invoice USD 186.855,66") e salve em "invoice_value". Se o valor não estiver explícito, salve 0.
    8. **Desambiguação de Carrier (coloader x armador/cia aérea):** O campo "carrier" só pode ser preenchido com o nome de uma companhia aérea ou armador/linha marítima real, citada explicitamente no texto como a operadora que executa o transporte (ex: "Cathay Pacific", "Maersk", "COSCO", "KLM"). NUNCA use o nome da empresa remetente da resposta (o coloader, agente ou desconsolidador que está cotando) como carrier — mesmo que seja o único nome de empresa presente no e-mail, apareça em destaque na assinatura, rodapé ou cabeçalho. Consulte o campo "Tipo de parceiro respondendo (partner_type)" no CONTEXTO DA COTAÇÃO ORIGINAL: se for COLOADER, AGENTE ou DESCONSOLIDADOR, redobre a atenção — o nome dessa empresa NUNCA é o carrier. Se nenhuma operadora real for citada explicitamente no texto, retorne carrier como string vazia "" em vez de usar o nome do remetente.
    9. **Múltiplas opções de frete (rate_options):** Se a resposta do agente apresentar mais de uma alternativa de frete/prazo para o MESMO embarque (ex: "Opção 1: direto USD 1200, 12 dias" / "Opção 2: com escala USD 950, 18 dias"), preencha rate_options com uma entrada por alternativa. NÃO escolha sozinho a mais barata nem a mais rápida — liste todas, na ordem em que o agente apresentou, para o usuário decidir. Isso é diferente de cotações para equipamentos ou destinos diferentes, que não são "opções" e não entram em rate_options.


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
       - Some todas as taxas obtidas e insira o valor final calculated (em reais BRL) no campo "services_brl" do JSON de resposta, a menos que o retorno do agente já contenha expressamente outras taxas locais de destino in BRL informadas no texto (se houver taxas locais de destino especificadas no texto do agente, prefira as informadas pelo agente).
    
    Instruções Importantes para Taxas Locais de Companhia Aérea (Destino BRL):
    2. Se os dados de CONTEXTO DA COTAÇÃO ORIGINAL indicarem que o embarque é aéreo (AIR / AIR_GENERAL) ou se o modal for Aéreo:
       - Identifique qual é a COMPANHIA AÉREA (Carrier) mencionada no RETORNO DO AGENTE ou nos documentos (ex: LATAM, Lufthansa, Emirates, etc.).
       - Se encontrar a companhia aérea, consulte na tabela "TABELA DE TAXAS LOCAIS DE DESTINO POR COMPANHIA AÉREA (CADASTRADAS NO BANCO)" fornecida acima.
       - Extraia todas as taxas de destino ativas cadastradas para aquela companhia aérea específica (ou taxas gerais sem companhia definida).
       - Some o valor de todas as taxas encontradas aplicadas ao processo e insira o valor final calculado (em reais BRL, convertendo taxas em USD/EUR para BRL se necessário usando câmbio de 5.0) no campo "services_brl" do JSON de resposta, a menos que o retorno do agente já contenha expressamente outras taxas locais de destino em BRL informadas no texto.
    
    RETORNO DO AGENTE:
    ${safeSourceText}

    Retorne o JSON estruturado conforme o schema fornecido nas configurações de geração.
    - Se encontrar o frete oculto em expressões como "Total USD 1.04 com IOF", deduza o frete puro de 1.00.`;

    const contentPayload = await buildTokenSafeContent(model, prompt, mediaParts);

    const result = await withRetry(() => model.generateContent(contentPayload));
    const parsed = JSON.parse(result.response.text().trim());
    if (parsed.costs) {
      parsed.costs.freight_currency = normalizeCurrency(parsed.costs.freight_currency);
      parsed.costs.origin_fees = normalizeFeeList(parsed.costs.origin_fees, 'ORIGIN');
      parsed.costs.destination_fees = normalizeFeeList(parsed.costs.destination_fees, 'DESTINATION');
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
      applyRateValidityPolicy(parsed.costs);
    }
    return parsed;
  } catch (error: any) {
    console.error('[extractAgentCosts] ERRO REAL:', error);
    if (String(error?.message || '').toLowerCase().includes('token')) {
      throw new Error('O retorno do agente contém mais informações do que a IA consegue processar de uma vez. Remova anexos que não contenham valores da cotação e tente novamente.');
    }
    if (error?.isRetryExhausted) throw new Error(AI_OVERLOAD_MESSAGE);
    throw new Error('Falha ao processar custos com IA: ' + (error?.message || String(error)));
  }
};

export const translateDraftText = async (text: string, targetLanguage: string, originCountry: string = '') => {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    
    let instruction = '';
    if (targetLanguage === 'ENGLISH') {
      instruction = 'Traduza o e-mail abaixo inteiramente para o INGLÊS (padrão comercial internacional).';
    } else if (targetLanguage === 'ORIGIN') {
      instruction = `Identifique o idioma oficial e primário do país de origem do frete (${originCountry || 'não especificado'}). Traduza o e-mail para este idioma (Ex: Se for França, traduza para o Francês). Exceção: Se o país de origem for de língua não latina (ex: China, Japão, Coreia, etc) ou se for indeterminado, traduza para o INGLÊS.`;
    } else {
      instruction = 'Traduza o e-mail abaixo para o idioma alvo especificado.';
    }

    const prompt = `Você é um tradutor especialista em comércio exterior.
    
    INSTRUÇÃO:
    ${instruction}

    REGRAS DE TRADUÇÃO:
    1. Mantenha a mesma formatação e estrutura do e-mail original (linhas, asteriscos, quebras de linha).
    2. Traduza jargões técnicos de comércio exterior corretamente (ex: "Frete Marítimo FCL", "Valor Comercial", "Peso Bruto").
    3. NÃO adicione nenhum comentário, nota ou saudação extra de sua parte. Retorne apenas o texto do e-mail traduzido.

    E-MAIL ORIGINAL:
    ${text}`;

    const result = await withRetry(() => model.generateContent(prompt));
    return result.response.text().trim();
  } catch (error: any) {
    console.error('[translateDraftText] ERRO:', error);
    if (error?.isRetryExhausted) throw new Error(AI_OVERLOAD_MESSAGE);
    throw new Error('Falha ao traduzir rascunho com IA: ' + (error?.message || String(error)));
  }
};
