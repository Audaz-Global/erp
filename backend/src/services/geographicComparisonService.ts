import { prisma } from '../prisma';

// Clusters de portos/aeroportos considerados alternativas próximas entre si.
// Curado manualmente — sem dado geográfico (lat/long) no sistema. Expandir
// conforme surgirem casos reais de rotas concorrentes na mesma região.
interface PortCluster {
  label: string;
  ports: string[];
}

const PORT_CLUSTERS: PortCluster[] = [
  { label: 'Portugal', ports: ['Lisboa', 'Porto', 'Leixões', 'Leixoes', 'Sines'] },
  { label: 'Espanha', ports: ['Barcelona', 'Valência', 'Valencia', 'Algeciras', 'Bilbao'] },
  { label: 'Itália', ports: ['Gênova', 'Genova', 'La Spezia', 'Nápoles', 'Napoli', 'Livorno'] },
  { label: 'China', ports: ['Xangai', 'Shanghai', 'Ningbo', 'Shenzhen', 'Qingdao', 'Yantian'] },
  { label: 'Alemanha', ports: ['Hamburgo', 'Hamburg', 'Bremerhaven', 'Bremen'] },
  { label: 'Holanda', ports: ['Roterdã', 'Roterda', 'Rotterdam', 'Amsterdã', 'Amsterda', 'Amsterdam'] },
  { label: 'EUA - Costa Oeste', ports: ['Los Angeles', 'Long Beach', 'Oakland'] },
  { label: 'EUA - Costa Leste', ports: ['New York', 'Nova York', 'Newark', 'Norfolk', 'Savannah'] },
];

const MIN_SAMPLES = 3;
const MIN_DIFF_PERCENT = 15;
const LOOKBACK_MONTHS = 12;

const canonical = (value: any) => String(value || '')
  .normalize('NFD').replace(/\p{Diacritic}/gu, '')
  .toUpperCase().trim();

function findCluster(portText?: string | null): PortCluster | null {
  const p = canonical(portText);
  if (!p) return null;
  return PORT_CLUSTERS.find(cluster => cluster.ports.some(name => p.includes(canonical(name)))) || null;
}

function matchedPortLabel(cluster: PortCluster, portText?: string | null): string | null {
  const p = canonical(portText);
  if (!p) return null;
  const match = cluster.ports.find(name => p.includes(canonical(name)));
  return match || null;
}

// Conversão aproximada só para tornar valores em moedas diferentes comparáveis
// entre si nesta análise estatística — mesmas taxas de referência já usadas
// no resumo de custos da Revisão Final.
function toUsdApprox(value: number, currency?: string | null): number {
  const c = (currency || 'USD').toUpperCase();
  if (c === 'BRL') return value / 5.05;
  if (c === 'EUR') return value * (5.50 / 5.05);
  return value;
}

export interface GeoComparisonInput {
  originPort?: string | null;
  originCountry?: string | null;
  destinationPort?: string | null;
  destinationCountry?: string | null;
  modal?: string | null;
  direction?: string | null;
  freightValue?: number | null;
  freightCurrency?: string | null;
}

export interface GeoComparisonAlert {
  message: string;
  side: 'ORIGIN' | 'DESTINATION';
  currentPort: string;
  cheaperPort: string;
  diffPercent: number;
  sampleCount: number;
}

async function historicalAveragesByPort(
  side: 'ORIGIN' | 'DESTINATION',
  cluster: PortCluster,
  modal: string,
  direction: string
): Promise<Map<string, { total: number; count: number }>> {
  const since = new Date();
  since.setMonth(since.getMonth() - LOOKBACK_MONTHS);
  const portField = side === 'ORIGIN' ? 'originPort' : 'destinationPort';

  const rows = await prisma.quotation.findMany({
    where: {
      modal,
      direction,
      freightValue: { not: null, gt: 0 },
      createdAt: { gte: since }
    },
    select: { [portField]: true, freightValue: true, freightCurrency: true } as any
  });

  const byLabel = new Map<string, { total: number; count: number }>();
  for (const row of rows as any[]) {
    const label = matchedPortLabel(cluster, row[portField]);
    if (!label) continue;
    const usd = toUsdApprox(Number(row.freightValue), row.freightCurrency);
    if (!Number.isFinite(usd) || usd <= 0) continue;
    const entry = byLabel.get(label) || { total: 0, count: 0 };
    entry.total += usd;
    entry.count += 1;
    byLabel.set(label, entry);
  }
  return byLabel;
}

async function evaluateSide(
  side: 'ORIGIN' | 'DESTINATION',
  portText: string | undefined | null,
  modal: string,
  direction: string,
  currentFreightUsd: number | null
): Promise<GeoComparisonAlert | null> {
  if (!portText) return null;
  const cluster = findCluster(portText);
  if (!cluster || cluster.ports.length < 2) return null;
  const ownLabel = matchedPortLabel(cluster, portText);
  if (!ownLabel) return null;

  const averages = await historicalAveragesByPort(side, cluster, modal, direction);

  let currentAvg = currentFreightUsd;
  if (currentAvg == null) {
    const own = averages.get(ownLabel);
    if (!own || own.count < MIN_SAMPLES) return null;
    currentAvg = own.total / own.count;
  }
  if (!currentAvg || currentAvg <= 0) return null;

  let best: { label: string; avg: number; count: number } | null = null;
  for (const [label, entry] of averages.entries()) {
    if (label === ownLabel) continue;
    if (entry.count < MIN_SAMPLES) continue;
    const avg = entry.total / entry.count;
    if (!best || avg < best.avg) best = { label, avg, count: entry.count };
  }
  if (!best) return null;

  const diffPercent = ((currentAvg - best.avg) / currentAvg) * 100;
  if (diffPercent < MIN_DIFF_PERCENT) return null;

  const sideLabel = side === 'ORIGIN' ? 'origem' : 'destino';
  return {
    side,
    currentPort: ownLabel,
    cheaperPort: best.label,
    diffPercent: Math.round(diffPercent),
    sampleCount: best.count,
    message: `Rotas via ${ownLabel} (${sideLabel}) custam em média ${Math.round(diffPercent)}% a mais que via ${best.label}, com base em ${best.count} cotações recentes. Vale avaliar ${best.label} como alternativa.`
  };
}

export async function getGeographicComparisonAlerts(input: GeoComparisonInput): Promise<GeoComparisonAlert[]> {
  const modal = (input.modal || '').toUpperCase();
  const direction = (input.direction || '').toUpperCase();
  if (!modal || !direction) return [];

  const currentFreightUsd = input.freightValue && input.freightValue > 0
    ? toUsdApprox(Number(input.freightValue), input.freightCurrency)
    : null;

  const [originAlert, destinationAlert] = await Promise.all([
    evaluateSide('ORIGIN', input.originPort, modal, direction, currentFreightUsd),
    evaluateSide('DESTINATION', input.destinationPort, modal, direction, currentFreightUsd)
  ]);

  return [originAlert, destinationAlert].filter((a): a is GeoComparisonAlert => Boolean(a));
}
