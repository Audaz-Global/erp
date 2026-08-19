import { prisma } from '../prisma';
import { normalizeCurrency } from './feeCalculationService';

export const GROUND_SERVICE_TYPES = ['DTA', 'RODOVIARIO_NACIONAL'] as const;

function text(value: unknown) { const result = String(value ?? '').trim(); return result || null; }
function nullableBoolean(value: unknown) {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return null;
}

export function normalizeGroundServiceLegs(input: unknown, legacy: any = {}) {
  const supplied = Array.isArray(input);
  const rows: any[] = supplied ? input as any[] : (legacy?.needsTransport ? [{
    serviceType:'RODOVIARIO_NACIONAL', requested:true, route:legacy.transportRoute,
    partnerName:legacy.truckerName, partnerEmail:legacy.truckerEmail,
    value:legacy.truckerValue, currency:legacy.truckerCurrency, customsStatus:'NACIONALIZADA'
  }] : []);
  const byType = new Map<string, any>();
  rows.forEach(row => {
    const serviceType = String(row?.serviceType || '').toUpperCase();
    if (!GROUND_SERVICE_TYPES.includes(serviceType as any) || row?.requested === false) return;
    byType.set(serviceType, {
      serviceType, requested:true, route:text(row.route), originLocation:text(row.originLocation),
      destinationLocation:text(row.destinationLocation),
      customsStatus:serviceType === 'DTA' ? 'SOB_CONTROLE_ADUANEIRO' : 'NACIONALIZADA',
      bondedTerminal:text(row.bondedTerminal), customsUnit:text(row.customsUnit), vehicleType:text(row.vehicleType),
      partnerId:text(row.partnerId), partnerName:text(row.partnerName), partnerEmail:text(row.partnerEmail),
      currency:normalizeCurrency(row.currency || 'BRL'), taxesIncluded:nullableBoolean(row.taxesIncluded),
      requestEvidence:text(row.requestEvidence), operationalNotes:text(row.operationalNotes)
    });
  });
  return { supplied, legs:[...byType.values()] };
}

export async function syncGroundServiceLegs(quotationId: string, input: unknown, legacy: any = {}) {
  const normalized = normalizeGroundServiceLegs(input, legacy);
  if (!normalized.supplied && !legacy?.needsTransport) return [];
  const types = normalized.legs.map(item => item.serviceType);
  await prisma.$transaction(async tx => {
    await tx.groundServiceLeg.deleteMany({ where:{ quotationId, ...(types.length ? { serviceType:{ notIn:types } } : {}) } });
    for (const leg of normalized.legs) {
      await tx.groundServiceLeg.upsert({
        where:{ quotationId_serviceType:{ quotationId, serviceType:leg.serviceType } },
        create:{ quotationId, ...leg }, update:leg
      });
    }
  });
  return prisma.groundServiceLeg.findMany({ where:{ quotationId }, orderBy:{ serviceType:'asc' } });
}

export function legacyRoadFields(legs: any[]) {
  const road = legs.find(item => item.serviceType === 'RODOVIARIO_NACIONAL' && item.requested);
  return road ? {
    needsTransport:true, transportRoute:road.route, truckerName:road.partnerName,
    truckerEmail:road.partnerEmail, truckerValue:road.value, truckerCurrency:road.currency
  } : { needsTransport:false, transportRoute:null, truckerName:null, truckerEmail:null };
}

export function groundServiceFinancialGroup(serviceType: string) {
  return serviceType === 'DTA' ? 'FREIGHT_COMPONENT' : 'DESTINATION_CHARGE';
}

export async function backfillLegacyRoadLegs() {
  const quotations = await prisma.quotation.findMany({
    where:{ needsTransport:true, groundServiceLegs:{ none:{ serviceType:'RODOVIARIO_NACIONAL' } } },
    select:{ id:true, transportRoute:true, truckerName:true, truckerEmail:true, truckerDraftEmail:true, truckerSentAt:true,
      truckerResponseRaw:true, truckerValue:true, truckerCurrency:true }
  });
  for (const quotation of quotations) {
    await prisma.groundServiceLeg.create({ data:{ quotationId:quotation.id, serviceType:'RODOVIARIO_NACIONAL', requested:true,
      route:quotation.transportRoute, customsStatus:'NACIONALIZADA', partnerName:quotation.truckerName, partnerEmail:quotation.truckerEmail,
      draftEmail:quotation.truckerDraftEmail, sentAt:quotation.truckerSentAt, responseRaw:quotation.truckerResponseRaw,
      value:quotation.truckerValue, currency:normalizeCurrency(quotation.truckerCurrency || 'BRL'), pricingSource:quotation.truckerValue != null ? 'LEGACY_MIGRATION' : null } });
  }
  return quotations.length;
}
