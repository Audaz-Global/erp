import { PrismaClient } from '@prisma/client';
import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';
import { getAirlineFullName } from './airlineIataService';

const prisma = new PrismaClient();

const DEFAULT_TARIFF_PATH = 'C:\\Users\\CS2\\OneDrive - AUDAZ GLOBAL\\Área de Trabalho\\2026\\Sistema de cotação\\Tarifário Exportação Aérea_Modelo ACG.xlsx';

function getTariffExcelPath(): string | null {
  if (fs.existsSync(DEFAULT_TARIFF_PATH)) {
    return DEFAULT_TARIFF_PATH;
  }
  const relativePaths = [
    path.join(__dirname, '..', '..', '..', '2026', 'Sistema de cotação', 'Tarifário Exportação Aérea_Modelo ACG.xlsx'),
    path.join(process.cwd(), '..', '2026', 'Sistema de cotação', 'Tarifário Exportação Aérea_Modelo ACG.xlsx'),
    path.join(process.cwd(), 'Tarifário Exportação Aérea_Modelo ACG.xlsx')
  ];
  for (const p of relativePaths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export interface AirTariffSearchResult {
  id?: string;
  airlineCode: string;
  airlineName: string;
  originPort: string;
  destinationPort: string;
  commodity: string;
  prodCode: string;
  rateType: string;
  currency: string;
  aircraftTypes: string;
  shcs?: string;
  day?: string;
  flightNo?: string;
  minRate: number | null;
  normalRate?: number | null;
  rate45k?: number | null;
  rate100k?: number | null;
  rate300k?: number | null;
  rate500k?: number | null;
  rate1000k?: number | null;
  rate3000k?: number | null;
  selectedWeightBreak: string;
  unitRatePerKg: number;
  totalFreight: number;
  fromTariffExcel: boolean;
}

export function matchesAirportOrCity(rawPort: string, queryStr: string): boolean {
  if (!queryStr || !queryStr.trim()) return true;
  const q = queryStr.trim().toUpperCase();
  const p = rawPort.trim().toUpperCase();

  if (p === q || q.includes(p) || p.includes(q)) return true;

  // Extrai códigos IATA de 3 letras presentes na string de busca (ex: "GRU - Guarulhos" -> "GRU")
  const extractedIataCodes: string[] = q.match(/\b[A-Z]{3}\b/g) || [];
  if (extractedIataCodes.includes(p)) return true;

  const iataCityMap: Record<string, string[]> = {
    GRU: ['GUARULHOS', 'SAO PAULO', 'SÃO PAULO', 'SP', 'BRASIL', 'BRAZIL'],
    VCP: ['VIRACOPOS', 'CAMPINAS', 'SAO PAULO', 'SÃO PAULO', 'SP'],
    GIG: ['GALEAO', 'GALEÃO', 'RIO DE JANEIRO', 'RJ'],
    SCL: ['SANTIAGO', 'CHILE'],
    GYE: ['GUAYAQUIL', 'EQUADOR', 'ECUADOR'],
    UIO: ['QUITO', 'EQUADOR', 'ECUADOR'],
    LIM: ['LIMA', 'PERU'],
    EZE: ['EZEIZA', 'BUENOS AIRES', 'ARGENTINA'],
    BOG: ['BOGOTA', 'BOGOTÁ', 'COLOMBIA', 'COLÔMBIA'],
    MEX: ['MEXICO', 'MÉXICO', 'CDMX'],
    MIA: ['MIAMI', 'FLORIDA', 'USA', 'EUA'],
    JFK: ['NEW YORK', 'NOVA YORK', 'NY', 'USA'],
    FRA: ['FRANKFURT', 'ALEMANHA', 'GERMANY'],
    CDG: ['PARIS', 'FRANÇA', 'FRANCE']
  };

  const synonyms = iataCityMap[p] || [];
  return synonyms.some(syn => q.includes(syn));
}

/**
 * Lê diretamente do arquivo Excel sem depender do banco de dados (fallback super resiliente).
 */
export function readTariffsFromExcelFileDirectly(
  origin: string,
  destination: string,
  chargableWeightKg: number
): AirTariffSearchResult[] {
  const filePath = getTariffExcelPath();
  if (!filePath) return [];

  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets['Airline Rates'] || workbook.Sheets[workbook.SheetNames[0]!];
  if (!sheet) return [];

  const rawRows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1 });
  if (rawRows.length < 2) return [];

  const headers = (rawRows[0] || []).map((h: any) => String(h || '').trim().toUpperCase());
  const colIndex = (name: string) => headers.findIndex((h: string) => h.includes(name.toUpperCase()));

  const idxAirline = colIndex('AIRLINE');
  const idxOrigin = colIndex('ORIGIN');
  const idxDest = colIndex('DESTINATION');
  const idxCommodity = colIndex('COMMODITY');
  const idxProdCode = colIndex('PROD CODE');
  const idxType = colIndex('TYPE');
  const idxM = colIndex('M');
  const idxN = colIndex('N');
  const idx45 = colIndex('45-KG');
  const idx100 = colIndex('100-KG');
  const idx300 = colIndex('300-KG');
  const idx500 = colIndex('500-KG');
  const idx1000 = colIndex('1000-KG');
  const idx3000 = colIndex('3000-KG');
  const idxCurr = colIndex('CURRENCY');
  const idxSHCs = colIndex('SHCS');
  const idxAircraft = colIndex('AIRCRAFT');
  const idxDay = colIndex('DAY');
  const idxFlightNo = colIndex('FLIGHT');

  const parseNum = (val: any): number | null => {
    if (val === null || val === undefined || val === '') return null;
    const n = typeof val === 'number' ? val : parseFloat(String(val).replace(',', '.'));
    return isNaN(n) ? null : n;
  };

  const results: AirTariffSearchResult[] = [];

  for (let i = 1; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (!row || row.length === 0) continue;

    const rawAirline = String(row[idxAirline] || '').trim();
    const rawOrigin = String(row[idxOrigin] || '').trim().toUpperCase();
    const rawDest = String(row[idxDest] || '').trim().toUpperCase();

    if (!rawAirline || !rawOrigin || !rawDest) continue;

    // Filtra por origem e destino usando correspondência resiliente (IATA / Cidade)
    if (origin && !matchesAirportOrCity(rawOrigin, origin)) continue;
    if (destination && !matchesAirportOrCity(rawDest, destination)) continue;

    const minRate = parseNum(row[idxM]);
    const normalRate = parseNum(row[idxN]);
    const rate45k = parseNum(row[idx45]);
    const rate100k = parseNum(row[idx100]);
    const rate300k = parseNum(row[idx300]);
    const rate500k = parseNum(row[idx500]);
    const rate1000k = parseNum(row[idx1000]);
    const rate3000k = parseNum(row[idx3000]);

    const effectiveWeight = chargableWeightKg > 0 ? chargableWeightKg : 100;

    let selectedBreak = 'M';
    let unitRate: number | null = minRate;

    if (effectiveWeight >= 3000 && rate3000k !== null) {
      selectedBreak = '+3000-KG';
      unitRate = rate3000k;
    } else if (effectiveWeight >= 1000 && rate1000k !== null) {
      selectedBreak = '+1000-KG';
      unitRate = rate1000k;
    } else if (effectiveWeight >= 500 && rate500k !== null) {
      selectedBreak = '+500-KG';
      unitRate = rate500k;
    } else if (effectiveWeight >= 300 && rate300k !== null) {
      selectedBreak = '+300-KG';
      unitRate = rate300k;
    } else if (effectiveWeight >= 100 && rate100k !== null) {
      selectedBreak = '+100-KG';
      unitRate = rate100k;
    } else if (effectiveWeight >= 45 && rate45k !== null) {
      selectedBreak = '+45-KG';
      unitRate = rate45k;
    } else if (normalRate !== null) {
      selectedBreak = 'N (<45KG)';
      unitRate = normalRate;
    } else if (minRate !== null) {
      selectedBreak = 'Mínimo';
      unitRate = minRate;
    }

    if (unitRate === null || unitRate <= 0) {
      const availableRate = rate100k ?? rate45k ?? rate300k ?? rate500k ?? normalRate ?? minRate;
      if (availableRate !== null && availableRate > 0) {
        unitRate = availableRate;
        selectedBreak = '+100-KG';
      } else {
        continue;
      }
    }

    let calculatedFreight = 0;
    if (chargableWeightKg <= 0) {
      calculatedFreight = unitRate;
    } else if (selectedBreak === 'Mínimo' || selectedBreak === 'M') {
      calculatedFreight = unitRate;
    } else {
      calculatedFreight = unitRate * chargableWeightKg;
      if (minRate && calculatedFreight < minRate) {
        calculatedFreight = minRate;
      }
    }

    results.push({
      airlineCode: rawAirline.toUpperCase(),
      airlineName: getAirlineFullName(rawAirline),
      originPort: rawOrigin,
      destinationPort: rawDest,
      commodity: row[idxCommodity] ? String(row[idxCommodity]).trim() : 'General Cargo',
      prodCode: row[idxProdCode] ? String(row[idxProdCode]).trim() : 'STANDARD',
      rateType: row[idxType] ? String(row[idxType]).trim() : 'Market',
      currency: String(row[idxCurr] || 'USD').trim().toUpperCase(),
      aircraftTypes: row[idxAircraft] ? String(row[idxAircraft]).trim() : 'ALL',
      shcs: row[idxSHCs] ? String(row[idxSHCs]).trim() : undefined,
      day: row[idxDay] ? String(row[idxDay]).trim() : undefined,
      flightNo: row[idxFlightNo] ? String(row[idxFlightNo]).trim() : undefined,
      minRate,
      normalRate,
      rate45k,
      rate100k,
      rate300k,
      rate500k,
      rate1000k,
      rate3000k,
      selectedWeightBreak: selectedBreak,
      unitRatePerKg: parseFloat((unitRate || 0).toFixed(2)),
      totalFreight: parseFloat((calculatedFreight || 0).toFixed(2)),
      fromTariffExcel: true
    });
  }

  return results.sort((a, b) => a.totalFreight - b.totalFreight);
}

/**
 * Lê o arquivo Excel do Tarifário ACG e carrega todos os registros na tabela AirExportTariffRate no banco de dados.
 */
export async function importTariffFromBuffer(buffer: Buffer): Promise<{ totalRows: number; importedRows: number }> {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets['Airline Rates'] || workbook.Sheets[workbook.SheetNames[0]!];
  if (!sheet) {
    throw new Error('Aba Airline Rates não encontrada no arquivo Excel.');
  }

  const rawRows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1 });
  if (rawRows.length < 2) {
    return { totalRows: 0, importedRows: 0 };
  }

  const headers = (rawRows[0] || []).map((h: any) => String(h || '').trim().toUpperCase());
  const colIndex = (name: string) => headers.findIndex((h: string) => h.includes(name.toUpperCase()));

  const idxAirline = colIndex('AIRLINE');
  const idxOrigin = colIndex('ORIGIN');
  const idxDest = colIndex('DESTINATION');
  const idxCommodity = colIndex('COMMODITY');
  const idxProdCode = colIndex('PROD CODE');
  const idxType = colIndex('TYPE');
  const idxM = colIndex('M');
  const idxN = colIndex('N');
  const idx45 = colIndex('45-KG');
  const idx100 = colIndex('100-KG');
  const idx300 = colIndex('300-KG');
  const idx500 = colIndex('500-KG');
  const idx1000 = colIndex('1000-KG');
  const idx3000 = colIndex('3000-KG');
  const idxCurr = colIndex('CURRENCY');
  const idxSHCs = colIndex('SHCS');
  const idxAircraft = colIndex('AIRCRAFT');
  const idxDay = colIndex('DAY');
  const idxFlightNo = colIndex('FLIGHT');

  const parseNum = (val: any): number | null => {
    if (val === null || val === undefined || val === '') return null;
    const n = typeof val === 'number' ? val : parseFloat(String(val).replace(',', '.'));
    return isNaN(n) ? null : n;
  };

  const recordsToCreate: any[] = [];

  for (let i = 1; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (!row || row.length === 0) continue;

    const rawAirline = String(row[idxAirline] || '').trim();
    const rawOrigin = String(row[idxOrigin] || '').trim();
    const rawDest = String(row[idxDest] || '').trim();

    if (!rawAirline || !rawOrigin || !rawDest) continue;

    const airlineName = getAirlineFullName(rawAirline);

    recordsToCreate.push({
      airlineCode: rawAirline.toUpperCase(),
      airlineName,
      originPort: rawOrigin.toUpperCase(),
      destinationPort: rawDest.toUpperCase(),
      commodity: row[idxCommodity] ? String(row[idxCommodity]).trim() : 'General Cargo',
      prodCode: row[idxProdCode] ? String(row[idxProdCode]).trim() : null,
      rateType: row[idxType] ? String(row[idxType]).trim() : null,
      minRate: parseNum(row[idxM]),
      normalRate: parseNum(row[idxN]),
      rate45k: parseNum(row[idx45]),
      rate100k: parseNum(row[idx100]),
      rate300k: parseNum(row[idx300]),
      rate500k: parseNum(row[idx500]),
      rate1000k: parseNum(row[idx1000]),
      rate3000k: parseNum(row[idx3000]),
      currency: String(row[idxCurr] || 'USD').trim().toUpperCase(),
      shcs: row[idxSHCs] ? String(row[idxSHCs]).trim() : null,
      aircraftTypes: row[idxAircraft] ? String(row[idxAircraft]).trim() : 'ALL',
      day: row[idxDay] ? String(row[idxDay]).trim() : null,
      flightNo: row[idxFlightNo] ? String(row[idxFlightNo]).trim() : null,
      active: true
    });
  }

  await prisma.airExportTariffRate.deleteMany({});
  
  if (recordsToCreate.length > 0) {
    await prisma.airExportTariffRate.createMany({
      data: recordsToCreate
    });
  }

  return { totalRows: rawRows.length - 1, importedRows: recordsToCreate.length };
}

/**
 * Busca e calcula os fretes disponíveis no tarifário para a rota, peso e commodity fornecidos.
 */
export async function searchAirExportRates(
  origin: string,
  destination: string,
  chargableWeightKg: number,
  commodity?: string
): Promise<AirTariffSearchResult[]> {
  const originClean = String(origin || '').trim().toUpperCase();
  const destClean = String(destination || '').trim().toUpperCase();

  try {
    // Busca todas as taxas ativas (sem filtro de rota no DB para manter o fuzzy search matchesAirportOrCity)
    const allRates = await prisma.airExportTariffRate.findMany({
      where: { active: true }
    });

    const results: AirTariffSearchResult[] = [];

    for (const rate of allRates) {
      if (originClean && !matchesAirportOrCity(rate.originPort, originClean)) continue;
      if (destClean && !matchesAirportOrCity(rate.destinationPort, destClean)) continue;

      const effectiveWeight = chargableWeightKg > 0 ? chargableWeightKg : 100;

      let selectedBreak = 'M';
      let unitRate: number | null = rate.minRate;

      if (effectiveWeight >= 3000 && rate.rate3000k !== null) {
        selectedBreak = '+3000-KG';
        unitRate = rate.rate3000k;
      } else if (effectiveWeight >= 1000 && rate.rate1000k !== null) {
        selectedBreak = '+1000-KG';
        unitRate = rate.rate1000k;
      } else if (effectiveWeight >= 500 && rate.rate500k !== null) {
        selectedBreak = '+500-KG';
        unitRate = rate.rate500k;
      } else if (effectiveWeight >= 300 && rate.rate300k !== null) {
        selectedBreak = '+300-KG';
        unitRate = rate.rate300k;
      } else if (effectiveWeight >= 100 && rate.rate100k !== null) {
        selectedBreak = '+100-KG';
        unitRate = rate.rate100k;
      } else if (effectiveWeight >= 45 && rate.rate45k !== null) {
        selectedBreak = '+45-KG';
        unitRate = rate.rate45k;
      } else if (rate.normalRate !== null) {
        selectedBreak = 'N (<45KG)';
        unitRate = rate.normalRate;
      } else if (rate.minRate !== null) {
        selectedBreak = 'Mínimo';
        unitRate = rate.minRate;
      }

      if (unitRate === null || unitRate <= 0) {
        const availableRate = rate.rate100k ?? rate.rate45k ?? rate.rate300k ?? rate.rate500k ?? rate.normalRate ?? rate.minRate;
        if (availableRate !== null && availableRate > 0) {
          unitRate = availableRate;
          selectedBreak = '+100-KG';
        } else {
          continue;
        }
      }

      let calculatedFreight = 0;
      if (chargableWeightKg <= 0) {
        calculatedFreight = unitRate;
      } else if (selectedBreak === 'Mínimo' || selectedBreak === 'M') {
        calculatedFreight = unitRate;
      } else {
        calculatedFreight = unitRate * chargableWeightKg;
        if (rate.minRate && calculatedFreight < rate.minRate) {
          calculatedFreight = rate.minRate;
        }
      }

      results.push({
        id: rate.id,
        airlineCode: rate.airlineCode,
        airlineName: rate.airlineName,
        originPort: rate.originPort,
        destinationPort: rate.destinationPort,
        commodity: rate.commodity || 'General Cargo',
        prodCode: rate.prodCode || 'STANDARD',
        rateType: rate.rateType || 'Market',
        currency: rate.currency || 'USD',
        aircraftTypes: rate.aircraftTypes || 'ALL',
        shcs: rate.shcs || undefined,
        day: rate.day || undefined,
        flightNo: rate.flightNo || undefined,
        minRate: rate.minRate,
        normalRate: rate.normalRate,
        rate45k: rate.rate45k,
        rate100k: rate.rate100k,
        rate300k: rate.rate300k,
        rate500k: rate.rate500k,
        rate1000k: rate.rate1000k,
        rate3000k: rate.rate3000k,
        selectedWeightBreak: selectedBreak,
        unitRatePerKg: parseFloat((unitRate || 0).toFixed(2)),
        totalFreight: parseFloat((calculatedFreight || 0).toFixed(2)),
        fromTariffExcel: false
      });
    }

    return results.sort((a, b) => a.totalFreight - b.totalFreight);
  } catch (err) {
    console.error('Erro na consulta do tarifário:', err);
    return [];
  }
}
