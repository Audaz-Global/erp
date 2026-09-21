import { Request, Response } from 'express';
import { prisma } from '../prisma';

const aliases = (value: any) => Array.isArray(value) ? value : String(value || '').split(',').map(v => v.trim()).filter(Boolean);

export async function listAirlineProfiles(_req: Request, res: Response) {
  try { res.json(await prisma.airlineProfile.findMany({ include: { fixedFees: true }, orderBy: { name: 'asc' } })); }
  catch { res.status(500).json({ error: 'Erro ao buscar companhias aéreas.' }); }
}

// Resolve uma companhia aérea pelo nome/código/sigla informado (ex: ao
// processar o retorno de um agente) — mesmo padrão do resolveCarrierProfile.
export async function resolveAirlineProfile(req: Request, res: Response) {
  const name = String(req.query.name || '').trim().toUpperCase();
  if (!name) return res.json(null);
  const profiles = await prisma.airlineProfile.findMany({ where: { active: true }, include: { fixedFees: true } });
  const found = profiles.find(p => {
    const names = [p.name, p.code, ...aliases(p.aliases)].filter(Boolean).map(v => String(v).toUpperCase());
    return names.some(v => v === name || name.includes(v) || v.includes(name));
  });
  if (!found) return res.json(null);
  const names = [found.name, found.code, ...aliases(found.aliases)].filter(Boolean).map(String);
  const fixedFees = await prisma.fixedFee.findMany({
    where: { active: true, OR: [{ airlineProfileId: found.id }, ...names.map(value => ({ carrier: { contains: value, mode: 'insensitive' as const } }))] }
  });
  res.json({ ...found, fixedFees });
}

export async function createAirlineProfile(req: Request, res: Response) {
  try {
    const p = await prisma.airlineProfile.create({
      data: {
        name: String(req.body.name || '').trim(),
        code: req.body.code ? String(req.body.code).trim().toUpperCase() : null,
        aliases: JSON.stringify(aliases(req.body.aliases)),
        description: req.body.description || null,
        active: req.body.active !== false
      }
    });
    res.status(201).json(p);
  } catch (e: any) {
    res.status(e?.code === 'P2002' ? 409 : 500).json({ error: e?.code === 'P2002' ? 'Companhia aérea já cadastrada.' : 'Erro ao criar companhia aérea.' });
  }
}

export async function updateAirlineProfile(req: Request, res: Response) {
  try {
    const p = await prisma.airlineProfile.update({
      where: { id: req.params.id },
      data: {
        name: req.body.name,
        code: req.body.code ? String(req.body.code).trim().toUpperCase() : null,
        aliases: JSON.stringify(aliases(req.body.aliases)),
        description: req.body.description || null,
        active: req.body.active
      }
    });
    res.json(p);
  } catch { res.status(500).json({ error: 'Erro ao atualizar companhia aérea.' }); }
}

export async function deleteAirlineProfile(req: Request, res: Response) {
  try { await prisma.airlineProfile.delete({ where: { id: req.params.id } }); res.status(204).send(); }
  catch { res.status(409).json({ error: 'Companhia aérea possui vínculos e não pode ser excluída.' }); }
}

// Vincula uma taxa (FixedFee) já cadastrada a uma companhia aérea — mesmo
// padrão do "Taxas Locais por Armador" (linkCarrierFee no front).
export async function linkAirlineFee(req: Request, res: Response) {
  try {
    const fee = await prisma.fixedFee.update({ where: { id: req.params.feeId }, data: { airlineProfileId: req.params.id } });
    res.json(fee);
  } catch { res.status(500).json({ error: 'Erro ao vincular taxa.' }); }
}

// Catálogo de companhias aéreas do "Projeto Atlantis" (planilha de
// Importação Aérea, aba "Cias Aéreas & Hubs Globais") — nome, código IATA e
// siglas usadas nos AWBs de cada uma. Sem valores por companhia: os valores
// das taxas seguem únicos, já cadastrados na Árvore de Incoterms.
const ATLANTIS_AIRLINES: Array<{ name: string; code: string; aliases: string[]; description: string }> = [
  { name: 'LATAM CARGO', code: 'LA', aliases: ['BAS', 'FSC', 'SSC', 'MYC', 'AWB', 'DBC', 'RAC', 'SOC', 'CCA'], description: 'LATAM AIRLINES GROUP (IATA: LA / 045) - Chile/Brasil. Hubs: MIA, FRA, MAD, SCL, LIM → GRU, VCP, GIG, CWB. Faturamento Mensal IATA/CASS. Moedas: USD/BRL.' },
  { name: 'LUFTHANSA CARGO', code: 'LH', aliases: ['AFR', 'FSC', 'ISS', 'DFC', 'BGC', 'X-RAY', 'CTC'], description: 'LUFTHANSA CARGO AG (IATA: LH / 020) - Alemanha. Hubs: FRA, MUC → GRU, VCP, GIG, CNF. Faturamento CASS Brasil. Moedas: EUR/USD/BRL.' },
  { name: 'CARGOLUX AIRLINES', code: 'CV', aliases: ['WEIGHT RATE', 'FSC', 'SSC', 'FUEL', 'CTC'], description: 'CARGOLUX AIRLINES INTERNATIONAL (IATA: CV / 172) - Luxemburgo. Hubs: LUX, MXP → VCP, CWB, GIG, GRU. Faturamento Quinzenal/USD.' },
  { name: 'EMIRATES SKYCARGO', code: 'EK', aliases: ['BAS', 'FSC', 'SEC', 'CBC', 'DFC', 'CCA', 'WAR'], description: 'EMIRATES AIRLINE (IATA: EK / 176) - Emirados Árabes. Hubs: DXB, HKG, PVG, NBO → GRU, VCP. Faturamento CASS/Transferência. Moedas: USD/BRL.' },
  { name: 'QATAR AIRWAYS CARGO', code: 'QR', aliases: ['AFR', 'FSC', 'SSC', 'BFC', 'AWC', 'CCC', 'CGC', 'DFC', 'RAC'], description: 'QATAR AIRWAYS (IATA: QR / 157) - Catar. Hubs: DOH, ICN, SIN, BKK → GRU, VCP. Faturamento CASS Brasil. Moedas: USD/BRL.' },
  { name: 'AIR FRANCE CARGO', code: 'AF', aliases: ['CC', 'CDG', 'DG LIGHT', 'DG NORMAL', 'RBC'], description: 'AIR FRANCE-KLM CARGO (IATA: AF / 057) - França. Hubs: CDG, AMS → GRU, VCP, GIG. Faturamento CASS Brasil. Moedas: EUR/USD.' },
  { name: 'KLM CARGO', code: 'KL', aliases: ['CC', 'AMS', 'DG LIGHT', 'DG NORMAL', 'RBC'], description: 'AIR FRANCE-KLM CARGO (IATA: KL / 074) - Holanda. Hubs: CDG, AMS → GRU, VCP, GIG. Faturamento CASS Brasil. Moedas: EUR/USD.' },
  { name: 'AMERICAN AIRLINES', code: 'AA', aliases: ['CCC', 'RAC', 'RI', 'FAIR BOOKING', 'NO-SHOW'], description: 'AMERICAN AIRLINES INC. (IATA: AA / 001) - Estados Unidos. Hubs: MIA, DFW, JFK → GRU, GIG. Faturamento USD/Fatura Agente. Regra de No-Show (USD 300).' },
  { name: 'SWISS WORLDCARGO', code: 'LX', aliases: ['CCC', 'CGC', 'BIC', 'BFC', 'DBC', 'DHC', 'SEC', 'RAC'], description: 'SWISS INTERNATIONAL AIR LINES (IATA: LX / 724) - Suíça. Hubs: ZRH, GVA → GRU. Faturamento CASS Brasil. Moedas: USD/CHF/BRL.' },
  { name: 'ETHIOPIAN AIRLINES', code: 'ET', aliases: ['AWC', 'DTC', 'ASC', 'LVC', 'RAC', 'DGR RECHECK', 'CCA'], description: 'ETHIOPIAN AIRLINES (IATA: ET / 071) - Etiópia. Hubs: ADD, CAN, PVG, HKG → GRU. Faturamento Boleto/CASS. Moedas: USD/BRL.' }
];

export async function importAtlantisAirlines(_req: Request, res: Response) {
  const results = [];
  for (const airline of ATLANTIS_AIRLINES) {
    const saved = await prisma.airlineProfile.upsert({
      where: { name: airline.name },
      update: { code: airline.code, aliases: JSON.stringify(airline.aliases), description: airline.description },
      create: { name: airline.name, code: airline.code, aliases: JSON.stringify(airline.aliases), description: airline.description }
    });
    results.push(saved);
  }
  res.json({ imported: results.length, airlines: results });
}
