import { Request, Response } from 'express';
import { prisma } from '../prisma';
import { generatePdf } from '../services/pdfService';
import axios from 'axios';
import { calculateAirCubado, hasOversizedCargo } from '../utils/cargoUtils';

function calculateCbmFromDimensions(dimensionsStr: string, packagesCount: number = 1): number {
  if (!dimensionsStr) return 0;
  
  // se o próprio texto for apenas um número decimal, ex: "1.248" ou "1,248" ou "1.248 CBM"
  const cleanNumber = dimensionsStr.trim().replace(',', '.');
  const numericOnly = parseFloat(cleanNumber);
  if (!isNaN(numericOnly) && !cleanNumber.includes('x') && !cleanNumber.includes('*')) {
    return numericOnly;
  }

  const dims = dimensionsStr.split(/[,;\n]/);
  let totalCbm = 0;
  
  for (const dim of dims) {
    if (!dim) continue;
    const cleaned = dim.toLowerCase().replace(/\s+/g, '');
    const match = cleaned.match(/(\d+(?:\.\d+)?)[x*](\d+(?:\.\d+)?)[x*](\d+(?:\.\d+)?)/);
    if (match) {
      const l = parseFloat(match[1] || '0');
      const w = parseFloat(match[2] || '0');
      const h = parseFloat(match[3] || '0');
      
      let unitFactor = 100; // cm por padrão
      if (cleaned.includes('mm')) {
        unitFactor = 1000;
      } else if (cleaned.includes('cm')) {
        unitFactor = 100;
      } else if (cleaned.includes('m') && !cleaned.includes('cm') && !cleaned.includes('mm')) {
        unitFactor = 1;
      }
      
      const itemVol = (l / unitFactor) * (w / unitFactor) * (h / unitFactor);
      
      const qtyMatch = cleaned.match(/^(\d+)[x*-]/);
      let qty = 1;
      if (qtyMatch) {
        const separatorsCount = (cleaned.match(/[x*-]/g) || []).length;
        if (separatorsCount >= 3) {
          qty = parseInt(qtyMatch[1] || '1', 10);
        } else if (dims.length === 1 && packagesCount > 0) {
          qty = packagesCount;
        }
      } else if (dims.length === 1 && packagesCount > 0) {
        qty = packagesCount;
      }
      
      totalCbm += itemVol * qty;
    }
  }
  
  return parseFloat(totalCbm.toFixed(3));
}

// 1. Create a new Quotation
export const createQuotation = async (req: Request, res: Response) => {
  try {
    let userId = req.user?.userId;

    if (!userId || userId === 'teste-local-id') {
      // Modo de teste local (sem autenticação real)
      let testUser = await prisma.user.findUnique({ where: { email: 'teste@audazglobal.com' } });
      if (!testUser) {
        testUser = await prisma.user.create({
          data: {
            name: 'Usuário de Teste Local',
            email: 'teste@audazglobal.com',
            password: 'senha-fake-nao-usada',
            role: 'ADMIN'
          }
        });
      }
      userId = testUser.id;
    }

    // Extract non-quotation fields
    const { clientName, clientCnpj, clientContactName, clientContactEmail, clientContactPhone, iofUsd, ...quotationData } = req.body;

    // Generate ADZ-QIS Reference if not provided
    let reference = quotationData.reference;
    if (reference) {
      const existing = await prisma.quotation.findUnique({ where: { reference } });
      if (existing) {
        reference = `${reference}-${Math.floor(Math.random() * 1000)}`;
      }
    } else {
      reference = await generateReference();
    }

    // Handle Client
    let clientId = null;
    if (clientName) {
      // Find or Create Client
      let client = null;
      if (clientCnpj) {
        client = await prisma.client.findFirst({ where: { cnpj: clientCnpj } });
      }
      if (!client) {
        // Tentar encontrar pelo nome se não encontrou pelo CNPJ
        client = await prisma.client.findFirst({ where: { name: clientName } });
      }
      if (!client) {
        client = await prisma.client.create({
          data: {
            name: clientName,
            cnpj: clientCnpj || null,
            contactName: clientContactName || null,
            contactEmail: clientContactEmail || null,
            contactPhone: clientContactPhone || null
          }
        });
      } else if (clientContactName || clientContactPhone || clientContactEmail) {
        // Atualizar dados de contato do cliente existente se estavam vazios
        const updateClientData: any = {};
        if (clientContactName && !client.contactName) updateClientData.contactName = clientContactName;
        if (clientContactPhone && !client.contactPhone) updateClientData.contactPhone = clientContactPhone;
        if (clientContactEmail && !client.contactEmail) updateClientData.contactEmail = clientContactEmail;
        if (Object.keys(updateClientData).length > 0) {
          client = await prisma.client.update({ where: { id: client.id }, data: updateClientData });
        }
      }
      clientId = client.id;
    }

    // Calcular CBM automaticamente a partir de dimensões se não vier preenchido
    let totalCbm = quotationData.totalCbm;
    if (!totalCbm && quotationData.packages) {
      totalCbm = calculateCbmFromDimensions(quotationData.packages, quotationData.totalPackages || 1);
    }

    const data = {
      ...quotationData,
      totalCbm,
      iofUsd,
      reference,
      createdById: userId,
      ...(clientId ? { clientId } : {})
    };

    const quotation = await prisma.quotation.create({ data });
    res.status(201).json(quotation);
  } catch (error: any) {
    console.error('Erro ao criar cotação:', error);
    res.status(500).json({ error: 'Erro ao criar a cotação no banco de dados' });
  }
};

// 2. Get all Quotations
export const getQuotations = async (req: Request, res: Response) => {
  try {
    const quotations = await prisma.quotation.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        client: { select: { name: true } },
        createdBy: { select: { name: true } }
      }
    });
    res.json(quotations);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar cotações' });
  }
};

// 3. Get single Quotation
export const getQuotationById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const quotation = await prisma.quotation.findUnique({
      where: { id },
      include: { client: true }
    });
    if (!quotation) return res.status(404).json({ error: 'Cotação não encontrada' });
    res.json(quotation);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar a cotação' });
  }
};

// 4. Update Quotation
export const updateQuotation = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    // Desestruturar campos que não pertencem ao model Quotation
    const { 
      clientName, 
      clientCnpj, 
      clientContactName, 
      clientContactEmail, 
      clientContactPhone,
      sourceEmails,
      ...quotationData 
    } = req.body;

    const updateData: any = { ...quotationData };
    if (updateData.packages && !updateData.totalCbm) {
      updateData.totalCbm = calculateCbmFromDimensions(updateData.packages, updateData.totalPackages || 1);
    }

    // Se as informações de cliente foram passadas, atualizamos/associamos
    if (clientName) {
      let client = null;
      if (clientCnpj) {
        client = await prisma.client.findFirst({ where: { cnpj: clientCnpj } });
      }
      if (!client) {
        client = await prisma.client.findFirst({ where: { name: clientName } });
      }
      if (!client) {
        client = await prisma.client.create({
          data: {
            name: clientName,
            cnpj: clientCnpj || null,
            contactName: clientContactName || null,
            contactEmail: clientContactEmail || null,
            contactPhone: clientContactPhone || null
          }
        });
      } else {
        // Atualizar campos de contato se foram fornecidos e estavam vazios ou diferentes
        const updateClientData: any = {};
        if (clientContactName && clientContactName !== client.contactName) updateClientData.contactName = clientContactName;
        if (clientContactPhone && clientContactPhone !== client.contactPhone) updateClientData.contactPhone = clientContactPhone;
        if (clientContactEmail && clientContactEmail !== client.contactEmail) updateClientData.contactEmail = clientContactEmail;
        if (Object.keys(updateClientData).length > 0) {
          client = await prisma.client.update({ where: { id: client.id }, data: updateClientData });
        }
      }
      updateData.clientId = client.id;
    }

    const quotation = await prisma.quotation.update({
      where: { id },
      data: updateData,
      include: { client: true }
    });
    res.json(quotation);
  } catch (error) {
    console.error('Erro no updateQuotation:', error);
    res.status(500).json({ error: 'Erro ao atualizar cotação' });
  }
};

// 5. Delete Quotation
export const deleteQuotation = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.quotation.delete({ where: { id } });
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: 'Erro ao excluir cotação' });
  }
};

// Helper: Auto-generate Reference "ADZ-QIS26050094" format
const generateReference = async () => {
  const date = new Date();
  const year = date.getFullYear().toString().substring(2);
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  
  // Find latest quotation to increment number
  const latest = await prisma.quotation.findFirst({
    where: { reference: { startsWith: `ADZ-QIS${year}${month}` } },
    orderBy: { createdAt: 'desc' }
  });

  let nextSequence = 1;
  if (latest && latest.reference) {
    const seqStr = latest.reference.substring(latest.reference.length - 4);
    const seq = parseInt(seqStr, 10);
    if (!isNaN(seq)) nextSequence = seq + 1;
  }

  return `ADZ-QIS${year}${month}${nextSequence.toString().padStart(4, '0')}`;
};

// 6. Generate PDF for Quotation
export const generateQuotationPdf = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const quotation = await prisma.quotation.findUnique({
      where: { id },
      include: { client: true, createdBy: true }
    });

    if (!quotation) return res.status(404).json({ error: 'Cotação não encontrada' });

    const host = req.get('host');
    const protocol = req.protocol;
    const publicWebViewUrl = `${protocol}://${host}/api/quotations/${quotation.id}/view`;

    const pdfBuffer = await generatePdf({
      ...quotation,
      publicWebViewUrl
    });

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${quotation.reference}.pdf"`,
      'Content-Length': pdfBuffer.length.toString()
    });

    res.send(pdfBuffer);
  } catch (error) {
    console.error('Erro ao gerar PDF:', error);
    res.status(500).json({ error: 'Erro ao gerar o PDF da cotação' });
  }
};

// 7. Update Quotation Status / Phase
export const updatePhase = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status, costs, agentEmail, customsClearanceIncluded, transitTimeDays, frequency, weightBreak } = req.body;

    const updateData: any = { status };
    if (agentEmail) updateData.agentEmail = agentEmail;
    if (customsClearanceIncluded !== undefined) {
      updateData.customsClearanceIncluded = customsClearanceIncluded;
    }
    if (transitTimeDays !== undefined) {
      updateData.transitTimeDays = transitTimeDays;
    }
    if (frequency !== undefined) {
      updateData.frequency = frequency;
    }
    if (weightBreak !== undefined) {
      updateData.weightBreak = weightBreak;
    }

    if (costs) {
      updateData.freightValue = costs.freight_usd;
      updateData.iofUsd = costs.iof_usd;
      updateData.destinationStorage = costs.storage_brl;
      updateData.destinationServicesTotal = costs.services_brl;
      updateData.destinationTaxes = costs.taxes_brl;
      updateData.totalBrl = costs.total_brl;
      if (costs.frequency !== undefined) {
        updateData.frequency = costs.frequency;
      }
      if (costs.weight_break !== undefined) {
        updateData.weightBreak = costs.weight_break;
      }
    }

    const updated = await prisma.quotation.update({
      where: { id },
      data: updateData
    });

    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// 8. Rota pública de visualização web da cotação convertida para R$ (BRL)
export const getPublicWebView = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const quotation = await prisma.quotation.findUnique({
      where: { id },
      include: { client: true }
    });

    if (!quotation) {
      return res.status(404).send('<h1>Cotação não encontrada</h1>');
    }

    // Buscar taxas de câmbio
    let usdRate = 5.05;
    let eurRate = 5.50;
    try {
      const response = await axios.get('https://economia.awesomeapi.com.br/last/USD-BRL,EUR-BRL', { timeout: 3000 });
      if (response.data) {
        if (response.data.USDBRL) usdRate = parseFloat(response.data.USDBRL.bid) || usdRate;
        if (response.data.EURBRL) eurRate = parseFloat(response.data.EURBRL.bid) || eurRate;
      }
    } catch (err: any) {
      console.error('Erro ao buscar câmbio, usando fallbacks:', err.message);
    }

    // Lógica de conversão
    const getBrlValue = (val: number, currency: string): number => {
      const cur = (currency || 'USD').toUpperCase();
      if (cur === 'BRL') return val;
      if (cur === 'EUR') return val * eurRate;
      return val * usdRate;
    };

    // Calcular valores
    const isAir = String(quotation.modal).toUpperCase() === 'AIR';
    const isExw = String(quotation.incoterm).toUpperCase() === 'EXW';
    
    // Peso taxável
    const bruto = quotation.totalGrossWeightKg || 0;
    const cbm = quotation.totalCbm || 0;
    const cubado = isAir ? calculateAirCubado(quotation.packages || '', quotation.totalPackages || 1) : parseFloat((cbm * 1000).toFixed(2));
    let taxavel = Math.max(bruto, cubado) || 1; // evitar divisão por zero
    if (isAir && quotation.weightBreak) {
      const minWeight = parseFloat(quotation.weightBreak.replace(/[^0-9]/g, ''));
      if (!isNaN(minWeight) && taxavel < minWeight) {
        taxavel = minWeight;
      }
    }

    // Frete
    const fVal = quotation.freightValue || 0;
    const fCurr = quotation.freightCurrency || (isAir && String(quotation.reference).includes('ACO') ? 'EUR' : 'USD');
    const fTotalBrl = getBrlValue(fVal, fCurr);

    // Detalhar taxas de origem
    let detailedFeesOrigem: any[] = [];
    if (isAir) {
      if (isExw) {
        // EXW tem Origin Charges consolidada
        const originVal = String(quotation.reference).includes('ACO') ? 340.00 : 91.00;
        const originCurr = String(quotation.reference).includes('ACO') ? 'EUR' : 'USD';
        detailedFeesOrigem.push({
          name: 'Origin Charges (Coleta, Doc, Handling, Despacho)',
          val: originVal,
          currency: originCurr,
          brl: getBrlValue(originVal, originCurr)
        });
      } else {
        // FCA padrão
        const airportFee = Math.max(0.15 * taxavel, 45.00);
        detailedFeesOrigem.push({ name: 'Airport Fee', val: airportFee, currency: 'USD', brl: getBrlValue(airportFee, 'USD') });
        detailedFeesOrigem.push({ name: 'AWB Fee', val: 16.00, currency: 'USD', brl: getBrlValue(16.00, 'USD') });
        detailedFeesOrigem.push({ name: 'Handling', val: 30.00, currency: 'USD', brl: getBrlValue(30.00, 'USD') });
      }
    }

    const subtotalOrigemBrl = detailedFeesOrigem.reduce((s, f) => s + f.brl, 0);

    // Detalhar taxas de destino
    let detailedFeesDestino: any[] = [];
    if (isAir) {
      // CCT fee
      detailedFeesDestino.push({ name: 'CCT fee', val: 10.00, currency: 'USD', brl: getBrlValue(10.00, 'USD') });
      
      // Collect Fee (3% of Frete + Origem BRL)
      const baseCollectBrl = fTotalBrl + subtotalOrigemBrl;
      // collectFee min EUR 50 se for em EUR, ou USD 50
      const collectFeeVal = Math.max(baseCollectBrl * 0.03, getBrlValue(50.00, fCurr));
      detailedFeesDestino.push({ name: 'Collect Fee', val: collectFeeVal / getBrlValue(1.0, fCurr), currency: fCurr, brl: collectFeeVal });
      
      // Delivery Fee
      detailedFeesDestino.push({ name: 'Delivery Fee', val: 55.00, currency: 'USD', brl: getBrlValue(55.00, 'USD') });
      
      // Desconsolidação
      detailedFeesDestino.push({ name: 'Desconsolidação / Deconsolidation', val: 55.00, currency: 'USD', brl: getBrlValue(55.00, 'USD') });

      // Desembaraço (Condicional ao flag)
      if (quotation.customsClearanceIncluded) {
        detailedFeesDestino.push({ name: 'Desembaraço Aduaneiro', val: 900.00, currency: 'BRL', brl: 900.00 });
      }

      // IOF - 3.5% de Frete + Origem
      const iofBrl = baseCollectBrl * 0.035;
      detailedFeesDestino.push({ name: 'IOF - FRETE + TX ORIGEM', val: iofBrl / getBrlValue(1.0, fCurr), currency: fCurr, brl: iofBrl });
    }

    const subtotalDestinoBrl = detailedFeesDestino.reduce((s, f) => s + f.brl, 0);
    const totalGeralBrl = fTotalBrl + subtotalOrigemBrl + subtotalDestinoBrl;

    const hasOversized = isAir && hasOversizedCargo(quotation.packages || '');
    const oversizedAlertHtml = hasOversized
      ? `
    <div class="alert-box" style="border-left-color: #ef4444; background: rgba(239, 68, 68, 0.1); color: #fca5a5; margin-bottom: 20px;">
      <strong>⚠️ Atenção - Carga Sobredimensionada:</strong> Esta carga possui caixas que ultrapassam os limites padrão de aviação comercial (comprimento > 300 cm, largura > 200 cm ou altura > 160 cm). Será necessária a confirmação prévia de preço e espaço com a companhia aérea para viabilizar o embarque.
    </div>
      `
      : '';

    // Renderizar página HTML
    res.send(`
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cotação de Frete - ${quotation.reference || 'Audaz'}</title>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">
  <style>
    :root {
      --navy: #1B2B6B;
      --navy-light: #243572;
      --gold: #F5A623;
      --bg: #0f1629;
      --bg-card: #1a2340;
      --border: #2a3558;
      --text: #e4e8f1;
      --text-muted: #8892a8;
      --success: #34d399;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Outfit', sans-serif;
      background: var(--bg);
      color: var(--text);
      padding: 40px 20px;
      min-height: 100vh;
      display: flex;
      justify-content: center;
      align-items: center;
    }
    .container {
      max-width: 900px;
      width: 100%;
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 20px;
      padding: 40px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.5);
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 2px solid var(--border);
      padding-bottom: 20px;
      margin-bottom: 30px;
    }
    .header h1 {
      font-size: 24px;
      font-weight: 800;
      color: #fff;
    }
    .header h1 span { color: var(--gold); }
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
      background: rgba(0,0,0,0.2);
      padding: 20px;
      border-radius: 12px;
      border: 1px solid var(--border);
    }
    .meta-item {
      display: flex;
      flex-direction: column;
    }
    .meta-label {
      font-size: 12px;
      color: var(--text-muted);
      text-transform: uppercase;
      margin-bottom: 4px;
    }
    .meta-value {
      font-size: 16px;
      font-weight: 600;
      color: #fff;
    }
    .alert-box {
      background: rgba(245, 166, 35, 0.1);
      border-left: 4px solid var(--gold);
      padding: 15px 20px;
      border-radius: 8px;
      font-size: 13px;
      line-height: 1.5;
      margin-bottom: 30px;
      color: #ffd88a;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 30px;
    }
    th, td {
      padding: 12px 16px;
      text-align: left;
      border-bottom: 1px solid var(--border);
    }
    th {
      font-size: 12px;
      color: var(--text-muted);
      text-transform: uppercase;
    }
    .section-title {
      font-size: 15px;
      font-weight: 700;
      color: var(--gold);
      padding-top: 15px;
      border-bottom: none;
    }
    .t-right { text-align: right; }
    .total-row {
      background: rgba(255,255,255,0.03);
      font-weight: 700;
    }
    .grand-total {
      font-size: 20px;
      color: var(--success);
    }
    .btn {
      display: inline-block;
      background: linear-gradient(135deg, var(--gold), #e8951a);
      color: #1b2b6b;
      padding: 12px 30px;
      border-radius: 30px;
      text-decoration: none;
      font-weight: 700;
      font-size: 14px;
      text-align: center;
      transition: all 0.3s;
      cursor: pointer;
      border: none;
      box-shadow: 0 4px 15px rgba(245,166,35,0.3);
    }
    .btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(245,166,35,0.5);
    }
    .footer {
      text-align: center;
      font-size: 11px;
      color: var(--text-muted);
      margin-top: 40px;
      line-height: 1.6;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Audaz <span>Global</span></h1>
      <div><a class="btn" href="/api/quotations/${quotation.id}/pdf" download>📥 Baixar PDF</a></div>
    </div>

    <div class="alert-box">
      <strong>⚠️ Aviso de Variação Cambial:</strong> Os valores abaixo foram convertidos para BRL com base na taxa de câmbio de hoje (USD: R$ ${usdRate.toFixed(4)} | EUR: R$ ${eurRate.toFixed(4)}). A cotação final em BRL varia conforme o câmbio oficial na data do embarque.
    </div>
    \${oversizedAlertHtml}

    <div class="meta-grid" style="grid-template-columns: repeat(3, 1fr);">
      <div class="meta-item">
        <span class="meta-label">Referência</span>
        <span class="meta-value">${quotation.reference || '—'}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">Cliente</span>
        <span class="meta-value">${quotation.client?.name || '—'}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">Modal / Incoterm</span>
        <span class="meta-value">${quotation.modal} / ${quotation.incoterm || '—'}</span>
      </div>
      
      <div class="meta-item">
        <span class="meta-label">Origem</span>
        <span class="meta-value">${quotation.originPort || '—'}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">País</span>
        <span class="meta-value">📍 ${quotation.originCountry || '—'}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">Local Inicial</span>
        <span class="meta-value">${quotation.originCity || '—'}</span>
      </div>

      <div class="meta-item">
        <span class="meta-label">Destino</span>
        <span class="meta-value">${quotation.destinationPort || '—'}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">País</span>
        <span class="meta-value">📍 ${quotation.destinationCountry || '—'}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">Destino Final</span>
        <span class="meta-value">${quotation.destinationCity || '—'}</span>
      </div>

      <div class="meta-item">
        <span class="meta-label">Cia Aérea / Armador</span>
        <span class="meta-value">${quotation.carrier || '—'}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">Frequência</span>
        <span class="meta-value">${quotation.frequency || 'Semanal'}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">Conexões</span>
        <span class="meta-value" style="color: var(--gold);">${quotation.connections || 'Sem conexões'}</span>
      </div>

      <div class="meta-item">
        <span class="meta-label">Peso Bruto / Cubado</span>
        <span class="meta-value">${bruto.toFixed(2)} kg / ${cubado.toFixed(2)} kg</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">Peso Taxável</span>
        <span class="meta-value">${taxavel.toFixed(2)} kg</span>
      </div>
      <div class="meta-item">
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Taxa</th>
          <th>Cálculo</th>
          <th class="t-right">Valor Original</th>
          <th class="t-right">Convertido (BRL)</th>
        </tr>
      </thead>
      <tbody>
        <!-- Frete -->
        <tr>
          <td colspan="4" class="section-title">Frete Internacional</td>
        </tr>
        <tr>
          <td>International Freight</td>
          <td>Por Kg/cm3 (6000)</td>
          <td class="t-right">${fCurr} ${(fVal / taxavel).toFixed(2)} / kg</td>
          <td class="t-right">R$ ${(fTotalBrl / taxavel).toFixed(2)} / kg</td>
        </tr>
        <tr class="total-row">
          <td>Subtotal Frete</td>
          <td></td>
          <td class="t-right">${fCurr} ${fVal.toFixed(2)}</td>
          <td class="t-right">R$ ${fTotalBrl.toFixed(2)}</td>
        </tr>

        <!-- Origem -->
        <tr>
          <td colspan="4" class="section-title">Origem</td>
        </tr>
        ${detailedFeesOrigem.map(fee => `
        <tr>
          <td>${fee.name}</td>
          <td>Fixo / Unitário</td>
          <td class="t-right">${fee.currency} ${fee.val.toFixed(2)}</td>
          <td class="t-right">R$ ${fee.brl.toFixed(2)}</td>
        </tr>
        `).join('')}
        <tr class="total-row">
          <td>Subtotal Origem</td>
          <td></td>
          <td class="t-right">—</td>
          <td class="t-right">R$ ${subtotalOrigemBrl.toFixed(2)}</td>
        </tr>

        <!-- Destino -->
        <tr>
          <td colspan="4" class="section-title">Destino (Local)</td>
        </tr>
        ${detailedFeesDestino.map(fee => `
        <tr>
          <td>${fee.name}</td>
          <td>Fixo / Variável</td>
          <td class="t-right">${fee.currency} ${fee.val.toFixed(2)}</td>
          <td class="t-right">R$ ${fee.brl.toFixed(2)}</td>
        </tr>
        `).join('')}
        <tr class="total-row">
          <td>Subtotal Destino</td>
          <td></td>
          <td class="t-right">—</td>
          <td class="t-right">R$ ${subtotalDestinoBrl.toFixed(2)}</td>
        </tr>

        <!-- Total Geral -->
        <tr class="total-row grand-total">
          <td>TOTAL GERAL ESTIMADO (BRL)</td>
          <td></td>
          <td></td>
          <td class="t-right">R$ ${totalGeralBrl.toFixed(2)}</td>
        </tr>
      </tbody>
    </table>

    <div class="footer">
      AUDAZ GLOBAL LOGISTICA LTDA | https://audazglobal.com<br>
      Gerado automaticamente pelo Audaz System
    </div>
  </div>
</body>
</html>
    `);
  } catch (error: any) {
    res.status(500).send('Erro ao renderizar visualização web: ' + error.message);
  }
};

