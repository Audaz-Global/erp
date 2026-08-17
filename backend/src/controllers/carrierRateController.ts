import { Request, Response } from 'express';
import crypto from 'crypto';
import * as xlsx from 'xlsx';
import { prisma } from '../prisma';

const CARRIER_CODES: Record<string, string> = {
  'MAERSK': 'MAEU', 'MSC': 'MSCU', 'CMA CGM': 'CMDU', 'HAPAG-LLOYD': 'HLCU',
  'ONE': 'ONEY', 'EVERGREEN': 'EGLV', 'COSCO SHIPPING': 'COSU', 'YANG MING': 'YMLU',
  'HMM': 'HDMU', 'PIL': 'PCIU'
};

const clean = (value: any) => String(value ?? '').trim();
const uploadFileName = (value: string) => {
  if (!/[\u00c3\u00c2]/.test(value)) return value;
  const decoded = Buffer.from(value, 'latin1').toString('utf8');
  return decoded.includes('\uFFFD') ? value : decoded;
};
const canonical = (value: any) => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
const jsonArray = (value: string | null | undefined) => {
  try { const parsed = JSON.parse(value || '[]'); return Array.isArray(parsed) ? parsed.map(clean).filter(Boolean) : []; }
  catch { return []; }
};
const parseAmount = (value: any) => {
  if (typeof value === 'number') return value;
  const raw = clean(value).replace(/[^\d,.-]/g, '');
  if (!raw) return NaN;
  if (raw.includes(',') && raw.includes('.')) return Number(raw.replace(/,/g, ''));
  return Number(raw.replace(',', '.'));
};
const normalizeApplicability = (value: any) => {
  const v = canonical(value);
  if (['YES', 'SIM'].includes(v)) return 'YES';
  if (['NO', 'NAO'].includes(v)) return 'NO';
  return v === 'CONDITIONAL' || v === 'CONDICIONAL' ? 'CONDITIONAL' : '';
};
const normalizeEquipment = (value: any) => {
  const v = canonical(value).replace(/[\s'\-]/g, '');
  if (!v || v === 'NOTSTATED') return 'NOT STATED';
  if (v === 'ALL') return 'ALL';
  if (v === 'DRY') return 'DRY';
  if (v.includes('40') && (v.includes('HC') || v.includes('HIGHCUBE'))) return '40HC';
  if (v.includes('40') && (v.includes('RH') || v.includes('REEFER') || v.includes('RIF') || v.includes('RF'))) return '40RH';
  if (v.includes('20') && (v.includes('RH') || v.includes('REEFER') || v.includes('RIF') || v.includes('RF'))) return '20RH';
  if (v.includes('40') && (v.includes('OPENTOP') || v.includes('TOR') || v.endsWith('OT'))) return '40OT';
  if (v.includes('20') && (v.includes('OPENTOP') || v.includes('TOR') || v.endsWith('OT'))) return '20OT';
  if (v.includes('40')) return '40GP';
  if (v.includes('20')) return '20GP';
  return clean(value).toUpperCase();
};
const rowsFromSheet = (sheet: xlsx.WorkSheet, requiredHeader: string) => {
  const rows = xlsx.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: '', raw: true, blankrows: false });
  const headerIndex = rows.findIndex(row => row.some(cell => canonical(cell) === canonical(requiredHeader)));
  if (headerIndex < 0) return [];
  const headers = rows[headerIndex]!.map(clean);
  return rows.slice(headerIndex + 1).filter(row => row.some(cell => clean(cell))).map((row, index) => ({
    rowNumber: headerIndex + index + 2,
    data: Object.fromEntries(headers.map((header, column) => [header, row[column] ?? '']))
  }));
};
const extractObservedDate = (notes: any) => {
  const match = clean(notes).match(/(20\d{2})[-/]([01]\d)[-/]([0-3]\d)/);
  if (!match) return null;
  const date = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
};

async function upsertCarrier(nameValue: any) {
  const name = clean(nameValue);
  const existing = (await prisma.carrierProfile.findMany()).find(profile => {
    const candidates = [profile.name, profile.code, ...jsonArray(profile.aliases)].map(canonical);
    return candidates.includes(canonical(name));
  });
  let profile = existing || await prisma.carrierProfile.create({ data: { name, code: CARRIER_CODES[canonical(name)] || null, aliases: '[]', modal: 'SEA', active: true } });
  if (!profile.partnerId) {
    let partner = await prisma.agent.findFirst({ where: { name: { equals: profile.name, mode: 'insensitive' } } });
    if (!partner) partner = await prisma.agent.create({ data: { name: profile.name, type: 'ARMADOR', types: JSON.stringify(['ARMADOR']), code: profile.code, aliases: profile.aliases, equipmentScopes: profile.equipmentScopes, modals: 'SEA_FCL, SEA_LCL', origins: 'Global', destinations: 'Brasil', active: true } });
    profile = await prisma.carrierProfile.update({ where: { id: profile.id }, data: { partnerId: partner.id } });
  }
  return profile;
}

async function upsertCatalog(nameValue: any, acronymValue?: any, descriptionValue?: any, aliasesToAdd: string[] = []) {
  const standardizedName = clean(nameValue);
  const existing = await prisma.chargeCatalog.findUnique({ where: { standardizedName } });
  const aliases = [...new Set([...(existing ? jsonArray(existing.aliases) : []), ...aliasesToAdd.map(clean).filter(Boolean)])];
  return prisma.chargeCatalog.upsert({
    where: { standardizedName },
    create: { standardizedName, acronym: clean(acronymValue) || null, description: clean(descriptionValue) || null, aliases: JSON.stringify(aliases) },
    update: { acronym: existing?.acronym || clean(acronymValue) || null, description: existing?.description || clean(descriptionValue) || null, aliases: JSON.stringify(aliases), active: true }
  });
}

export async function importDanielRates(req: Request, res: Response) {
  if (!req.file) return res.status(400).json({ error: 'Selecione a planilha do Daniel.' });
  const batch = await prisma.carrierRateImportBatch.create({ data: { fileName: uploadFileName(req.file.originalname) } });
  const warnings: string[] = [];
  let totalRows = 0, importedRows = 0, skippedRows = 0;
  try {
    const workbook = xlsx.read(req.file.buffer, { type: 'buffer', cellDates: true });

    for (const config of [{ sheet: 'EXW FCL Charges', incoterm: 'EXW' }, { sheet: 'FCA FCL Charges', incoterm: 'FCA' }, { sheet: 'FOB FCL Charges', incoterm: 'FOB' }]) {
      const sheet = workbook.Sheets[config.sheet];
      if (!sheet) { warnings.push(`Aba ${config.sheet} não encontrada.`); continue; }
      const rows = rowsFromSheet(sheet, 'Ordem');
      for (const entry of rows) {
        const row = entry.data;
        if (!/^\d+$/.test(clean(row['Ordem']))) continue;
        totalRows++;
        const name = clean(row['Standardized Charge']);
        const applicability = normalizeApplicability(row['Aplicável']);
        if (!name || !applicability) { warnings.push(`${config.sheet}, linha ${entry.rowNumber}: taxa incompleta ignorada.`); skippedRows++; continue; }
        const catalog = await upsertCatalog(name, row['Acronym'], row['Charge Description']);
        await prisma.chargeApplicability.upsert({
          where: { chargeCatalogId_incoterm_modal: { chargeCatalogId: catalog.id, incoterm: config.incoterm, modal: 'SEA_FCL' } },
          create: { chargeCatalogId: catalog.id, incoterm: config.incoterm, modal: 'SEA_FCL', operationalStage: clean(row['Etapa operacional']) || null, applicability, classification: clean(row['Classificação']) || null, usualApplication: clean(row['Aplicação / base usual']) || clean(row['Aplicação / base usual e armadores']) || null },
          update: { operationalStage: clean(row['Etapa operacional']) || null, applicability, classification: clean(row['Classificação']) || null, usualApplication: clean(row['Aplicação / base usual']) || clean(row['Aplicação / base usual e armadores']) || null }
        });
      }
    }

    const evidenceSheet = workbook.Sheets['Carrier Evidence'];
    if (!evidenceSheet) throw new Error('A aba Carrier Evidence não foi encontrada.');
    const evidenceRows = rowsFromSheet(evidenceSheet, 'Order');
    for (const entry of evidenceRows) {
      const row = entry.data;
      if (!/^\d+$/.test(clean(row['Order']))) continue;
      totalRows++;
      const amount = parseAmount(row['Observed Amount']);
      const required = ['Carrier', 'Standardized Charge', 'Currency', 'Unit / Basis', 'Source / Evidence'];
      if (required.some(field => !clean(row[field])) || !Number.isFinite(amount) || amount <= 0) {
        warnings.push(`Carrier Evidence, linha ${entry.rowNumber}: registro incompleto ignorado.`); skippedRows++; continue;
      }
      const carrier = await upsertCarrier(row['Carrier']);
      const catalog = await upsertCatalog(row['Standardized Charge'], row['Original Code'], '', [clean(row['Original Charge Description']), clean(row['Original Code'])]);
      const portScope = canonical(row['Port']) === 'NOT STATED' ? 'NOT STATED' : clean(row['Port']);
      const equipment = normalizeEquipment(row['Equipment']);
      const sourceRef = clean(row['Source / Evidence']);
      const fingerprint = crypto.createHash('sha256').update([
        carrier.id, catalog.id, portScope, equipment, clean(row['Currency']).toUpperCase(), amount,
        clean(row['Unit / Basis']), sourceRef
      ].join('|')).digest('hex');
      const existing = await prisma.carrierRate.findUnique({ where: { sourceFingerprint: fingerprint } });
      if (existing) { skippedRows++; continue; }
      const genericContext = ['NOT STATED', 'ALL'].includes(canonical(portScope)) || ['NOT STATED', 'ALL'].includes(canonical(equipment));
      await prisma.carrierRate.create({
        data: {
          carrierProfileId: carrier.id, chargeCatalogId: catalog.id, importBatchId: batch.id,
          originalCode: clean(row['Original Code']) || null, originalDescription: clean(row['Original Charge Description']) || null,
          portScope, equipment, currency: clean(row['Currency']).toUpperCase(), amount, unitBasis: clean(row['Unit / Basis']),
          application: clean(row['Application']) || null, modal: 'SEA_FCL', type: 'DESTINATION', status: 'REFERENCE',
          conditional: canonical(row['Application']).includes('CONDITIONAL') || genericContext, sourceFingerprint: fingerprint,
          evidences: { create: { sourceRef, sourceType: /https?:\/\//i.test(sourceRef) ? 'OFFICIAL_TARIFF' : 'INVOICE', notes: clean(row['Notes']) || null, observedAt: extractObservedDate(row['Notes']) } }
        }
      });
      importedRows++;
    }
    const completed = await prisma.carrierRateImportBatch.update({ where: { id: batch.id }, data: { status: 'COMPLETED', totalRows, importedRows, skippedRows, warningRows: warnings.length, warnings: JSON.stringify(warnings), completedAt: new Date() } });
    res.json({ batch: completed, summary: { totalRows, importedRows, skippedRows, warnings: warnings.slice(0, 30) } });
  } catch (error: any) {
    await prisma.carrierRateImportBatch.update({ where: { id: batch.id }, data: { status: 'FAILED', totalRows, importedRows, skippedRows, warningRows: warnings.length + 1, warnings: JSON.stringify([...warnings, error.message]), completedAt: new Date() } });
    console.error('Erro ao importar base de tarifas:', error);
    res.status(500).json({ error: error.message || 'Erro ao importar base de tarifas.' });
  }
}

export async function listCarrierRates(req: Request, res: Response) {
  const where: any = {};
  if (req.query.carrierProfileId) where.carrierProfileId = String(req.query.carrierProfileId);
  if (req.query.status) where.status = String(req.query.status).toUpperCase();
  const rates = await prisma.carrierRate.findMany({ where, include: { carrierProfile: true, chargeCatalog: true, evidences: true }, orderBy: [{ carrierProfile: { name: 'asc' } }, { chargeCatalog: { standardizedName: 'asc' } }] });
  res.json(rates);
}

export async function carrierRateStats(_req: Request, res: Response) {
  const [rates, batches, catalogs] = await Promise.all([
    prisma.carrierRate.findMany({ select: { status: true, conditional: true, carrierProfileId: true } }),
    prisma.carrierRateImportBatch.findMany({ orderBy: { createdAt: 'desc' }, take: 10 }),
    prisma.chargeCatalog.count()
  ]);
  const byStatus = rates.reduce<Record<string, number>>((acc, rate) => { acc[rate.status] = (acc[rate.status] || 0) + 1; return acc; }, {});
  res.json({ totalRates: rates.length, catalogs, carriers: new Set(rates.map(rate => rate.carrierProfileId)).size, conditional: rates.filter(rate => rate.conditional).length, byStatus, batches });
}

export async function updateCarrierRate(req: Request, res: Response) {
  try {
    const current = await prisma.carrierRate.findUnique({ where: { id: req.params.id } });
    if (!current) return res.status(404).json({ error: 'Tarifa não encontrada.' });
    const status = clean(req.body.status || current.status).toUpperCase();
    const effectiveFrom = req.body.effectiveFrom ? new Date(req.body.effectiveFrom) : current.effectiveFrom;
    const effectiveTo = req.body.effectiveTo ? new Date(req.body.effectiveTo) : current.effectiveTo;
    const portScope = req.body.portScope !== undefined ? clean(req.body.portScope) : current.portScope;
    const equipment = req.body.equipment !== undefined ? normalizeEquipment(req.body.equipment) : current.equipment;
    if (status === 'APPROVED') {
      if (!effectiveFrom || !effectiveTo) return res.status(400).json({ error: 'Informe o início e o fim da vigência antes de aprovar.' });
      if (effectiveTo < effectiveFrom) return res.status(400).json({ error: 'A vigência final deve ser posterior à inicial.' });
      if (canonical(portScope) === 'NOT STATED' || canonical(equipment) === 'NOT STATED') return res.status(400).json({ error: 'Defina o porto e o equipamento antes de aprovar.' });
    }
    const rate = await prisma.carrierRate.update({ where: { id: current.id }, data: {
      portScope, equipment, amount: req.body.amount !== undefined ? Number(req.body.amount) : undefined,
      currency: req.body.currency ? clean(req.body.currency).toUpperCase() : undefined, unitBasis: req.body.unitBasis ? clean(req.body.unitBasis) : undefined,
      effectiveFrom, effectiveTo, status, conditional: req.body.conditional !== undefined ? Boolean(req.body.conditional) : undefined,
      active: req.body.active !== undefined ? Boolean(req.body.active) : undefined
    }, include: { carrierProfile: true, chargeCatalog: true, evidences: true } });
    res.json(rate);
  } catch (error) { res.status(500).json({ error: 'Erro ao atualizar tarifa.' }); }
}

export async function createCarrierRate(req: Request, res: Response) {
  try {
    const carrierProfileId = clean(req.body.carrierProfileId);
    const carrier = await prisma.carrierProfile.findUnique({ where: { id: carrierProfileId } });
    const chargeName = clean(req.body.chargeName), portScope = clean(req.body.portScope) || 'ALL';
    const equipment = normalizeEquipment(req.body.equipment), amount = parseAmount(req.body.amount);
    const currency = clean(req.body.currency || 'USD').toUpperCase(), unitBasis = clean(req.body.unitBasis || 'PER CONTAINER');
    if (!carrier || !chargeName || !Number.isFinite(amount) || amount < 0 || equipment === 'NOT STATED') return res.status(400).json({ error: 'Informe armador, taxa, equipamento e valor válidos.' });
    const enabled = jsonArray((carrier as any).equipmentScopes);
    if (enabled.length && !enabled.includes(equipment)) return res.status(400).json({ error: `Habilite o equipamento ${equipment} no cadastro do armador antes de registrar a taxa.` });
    const effectiveFrom = req.body.effectiveFrom ? new Date(req.body.effectiveFrom) : null;
    const effectiveTo = req.body.effectiveTo ? new Date(req.body.effectiveTo) : null;
    if (effectiveFrom && effectiveTo && effectiveTo < effectiveFrom) return res.status(400).json({ error: 'A vigência final deve ser posterior à inicial.' });
    const status = clean(req.body.status || 'REFERENCE').toUpperCase();
    if (status === 'APPROVED' && (!effectiveFrom || !effectiveTo)) return res.status(400).json({ error: 'Informe a vigência antes de aprovar a tarifa.' });
    const catalog = await upsertCatalog(chargeName, req.body.originalCode, req.body.description);
    const fingerprint = crypto.createHash('sha256').update(['MANUAL', carrier.id, catalog.id, portScope, equipment, currency, amount, unitBasis, Date.now(), Math.random()].join('|')).digest('hex');
    const rate = await prisma.carrierRate.create({ data: {
      carrierProfileId: carrier.id, chargeCatalogId: catalog.id, originalCode: clean(req.body.originalCode) || null,
      originalDescription: clean(req.body.description) || null, portScope, equipment, currency, amount, unitBasis,
      application: clean(req.body.application) || null, modal: clean(req.body.modal || 'SEA_FCL').toUpperCase(), type: clean(req.body.type || 'DESTINATION').toUpperCase(),
      effectiveFrom, effectiveTo, status, conditional: Boolean(req.body.conditional), sourceFingerprint: fingerprint,
      evidences: { create: { sourceRef: 'Cadastro manual', sourceType: 'OTHER', notes: clean(req.body.notes) || 'Taxa cadastrada manualmente.' } }
    }, include: { carrierProfile: true, chargeCatalog: true, evidences: true } });
    res.status(201).json(rate);
  } catch { res.status(500).json({ error: 'Erro ao cadastrar tarifa do armador.' }); }
}

const genericPort = (value: any) => ['ALL', 'BRAZIL PORTS', 'BRASIL', 'BRAZIL'].includes(canonical(value));
const genericEquipment = (value: any) => ['ALL', 'DRY'].includes(canonical(value));
const textMatches = (scope: any, actual: any) => {
  const a = canonical(scope), b = canonical(actual);
  return Boolean(a && b && (a.includes(b) || b.includes(a)));
};

export async function matchCarrierRates(req: Request, res: Response) {
  const carrierName = clean(req.query.carrier);
  if (!carrierName) return res.json([]);
  const profiles = await prisma.carrierProfile.findMany();
  const profile = profiles.find(item => [item.name, item.code, ...jsonArray(item.aliases)].map(canonical).includes(canonical(carrierName)));
  if (!profile) return res.json([]);
  const date = req.query.date ? new Date(String(req.query.date)) : new Date();
  const port = clean(req.query.port), equipment = normalizeEquipment(req.query.equipment), modal = clean(req.query.modal || 'SEA_FCL').toUpperCase(), type = clean(req.query.type || 'DESTINATION').toUpperCase();
  const rates = await prisma.carrierRate.findMany({ where: { carrierProfileId: profile.id, status: 'APPROVED', active: true, conditional: false, modal, type, effectiveFrom: { lte: date }, effectiveTo: { gte: date } }, include: { carrierProfile: true, chargeCatalog: true, evidences: true } });
  const scored = rates.map(rate => {
    const portScore = textMatches(rate.portScope, port) ? 4 : genericPort(rate.portScope) ? 1 : -100;
    const equipmentScore = canonical(rate.equipment) === canonical(equipment) ? 4 : genericEquipment(rate.equipment) ? 1 : -100;
    return { rate, score: portScore + equipmentScore };
  }).filter(item => item.score >= 0).sort((a, b) => b.score - a.score || Number(b.rate.effectiveFrom) - Number(a.rate.effectiveFrom));
  const selected = new Map<string, any>();
  scored.forEach(item => { if (!selected.has(item.rate.chargeCatalogId)) selected.set(item.rate.chargeCatalogId, item.rate); });
  res.json([...selected.values()]);
}
