import type { Quotation } from '@prisma/client';
import { normalizeDangerousGoodsStatus, normalizeMsdsStatus } from '../services/dangerousGoodsService';

export interface DraftPayload {
  reference: string | null;
  direction: string | null;
  modal: string | null;
  loadType: string | null;
  incoterm: string | null;
  originCity: string | null;
  originCountry: string | null;
  originPort: string | null;
  destinationCity: string | null;
  destinationCountry: string | null;
  destinationPort: string | null;
  connections: string | null;
  cargoDescription: string | null;
  commodityType: string | null;
  commoditySubtype: string | null;
  temperatureRequirement: string | null;
  coolingPackage: string | null;
  temperatureTrackingStatus: string | null;
  activeContainerStatus: string | null;
  screeningStatus: string | null;
  diplomaticStatus: string | null;
  expressStatus: string | null;
  lithiumBatteryStatus: string | null;
  ncmCodes: string | null;
  totalGrossWeightKg: number | null;
  totalNetWeightKg: number | null;
  totalCbm: number | null;
  totalPackages: number | null;
  packages: string | null;
  commercialValue: number | null;
  commercialCurrency: string | null;
  isImo: boolean;
  dangerousGoodsStatus: string;
  msdsStatus: string;
  unNumber: string | null;
  dangerousGoodsClass: string | null;
  dangerousGoodsProductCount: number | null;
  stackableStatus: string;
  requiresInsurance: boolean;
  requiresStorageEstimate: boolean;
  storageRequestEvidence: string | null;
  needsOriginInland: boolean;
  originInlandRoute: string | null;
  transportRoute: string | null;
  originalEmailText: string;
  clientName: string | null;
  clientCnpj: string | null;
  clientReferenceNumber: string | null;
  agentEmailCode: string | null;
}

const COMMODITY_TYPE_LABELS: Record<string, string> = {
  GENERAL_CARGO: 'Carga geral',
  PHARMACEUTICALS: 'Farmacêutica',
  PERISHABLE: 'Perecível',
  DANGEROUS_GOODS: 'Carga perigosa',
  LIVE_ANIMALS: 'Animais vivos',
  OTHER: 'Outra'
};

const COMMODITY_SUBTYPE_LABELS: Record<string, string> = {
  PASSIVE: 'Passivo',
  ACTIVE: 'Ativo',
  VACCINES: 'Vacinas',
  MEDICINES: 'Medicamentos',
  FOOD: 'Alimentos',
  FRESH_PRODUCE: 'Produtos frescos',
  FLOWERS: 'Flores',
  SEAFOOD: 'Frutos do mar',
  OTHER: 'Outro'
};

const TEMPERATURE_REQUIREMENT_LABELS: Record<string, string> = {
  NOT_REQUIRED: 'Não requerido',
  MINUS_10_TO_MINUS_20_C: '-10°C a -20°C',
  PLUS_2_TO_PLUS_8_C: '2°C a 8°C',
  PLUS_2_TO_PLUS_25_C: '2°C a 25°C',
  PLUS_15_TO_PLUS_25_C: '15°C a 25°C',
  OTHER: 'Outra'
};

const COOLING_PACKAGE_LABELS: Record<string, string> = {
  NOT_APPLICABLE: 'N/A',
  ICE_WATER: 'Gelo/água',
  DRY_ICE: 'Gelo seco',
  OTHER: 'Outra'
};

const STATUS_LABELS: Record<string, string> = {
  YES: 'Sim',
  NO: 'Não',
  TO_CONFIRM: 'A confirmar'
};

function readableValue(value: string | null, labels?: Record<string, string>): string {
  if (!value) return 'Não informado';
  return labels?.[value] || value;
}

export function buildCommodityEmailTokens(payload: DraftPayload): Record<string, string> {
  return {
    cargoDescription: readableValue(payload.cargoDescription),
    commodityType: readableValue(payload.commodityType, COMMODITY_TYPE_LABELS),
    commoditySubtype: readableValue(payload.commoditySubtype, COMMODITY_SUBTYPE_LABELS),
    temperatureRequirement: readableValue(payload.temperatureRequirement, TEMPERATURE_REQUIREMENT_LABELS),
    coolingPackage: readableValue(payload.coolingPackage, COOLING_PACKAGE_LABELS),
    temperatureTrackingStatus: readableValue(payload.temperatureTrackingStatus, STATUS_LABELS),
    activeContainerStatus: readableValue(payload.activeContainerStatus, STATUS_LABELS),
    screeningStatus: readableValue(payload.screeningStatus, STATUS_LABELS),
    diplomaticStatus: readableValue(payload.diplomaticStatus, STATUS_LABELS),
    expressStatus: readableValue(payload.expressStatus, STATUS_LABELS),
    lithiumBatteryStatus: readableValue(payload.lithiumBatteryStatus, STATUS_LABELS)
  };
}

type QuotationWithClient = Quotation & { client?: { name?: string; cnpj?: string | null } | null };

export function buildDraftPayload(quotation: QuotationWithClient, originalEmailText: string): DraftPayload {
  const dangerousGoodsStatus = normalizeDangerousGoodsStatus(quotation.dangerousGoodsStatus, quotation.isImo);
  return {
    reference: quotation.reference,
    direction: quotation.direction,
    modal: quotation.modal,
    loadType: quotation.loadType,
    incoterm: quotation.incoterm,
    originCity: quotation.originCity,
    originCountry: quotation.originCountry,
    originPort: quotation.originPort,
    destinationCity: quotation.destinationCity,
    destinationCountry: quotation.destinationCountry,
    destinationPort: quotation.destinationPort,
    connections: quotation.connections,
    cargoDescription: quotation.cargoDescription,
    commodityType: quotation.commodityType,
    commoditySubtype: quotation.commoditySubtype,
    temperatureRequirement: quotation.temperatureRequirement,
    coolingPackage: quotation.coolingPackage,
    temperatureTrackingStatus: quotation.temperatureTrackingStatus,
    activeContainerStatus: quotation.activeContainerStatus,
    screeningStatus: quotation.screeningStatus,
    diplomaticStatus: quotation.diplomaticStatus,
    expressStatus: quotation.expressStatus,
    lithiumBatteryStatus: quotation.lithiumBatteryStatus,
    ncmCodes: quotation.ncmCodes,
    totalGrossWeightKg: quotation.totalGrossWeightKg,
    totalNetWeightKg: quotation.totalNetWeightKg,
    totalCbm: quotation.totalCbm,
    totalPackages: quotation.totalPackages,
    packages: quotation.packages,
    commercialValue: quotation.commercialValue,
    commercialCurrency: quotation.commercialCurrency,
    isImo: quotation.isImo,
    dangerousGoodsStatus,
    msdsStatus: normalizeMsdsStatus(quotation.msdsStatus, dangerousGoodsStatus),
    unNumber: quotation.unNumber,
    dangerousGoodsClass: quotation.dangerousGoodsClass,
    dangerousGoodsProductCount: quotation.dangerousGoodsProductCount,
    stackableStatus: quotation.stackableStatus || 'TO_CONFIRM',
    requiresInsurance: quotation.requiresInsurance,
    requiresStorageEstimate: quotation.requiresStorageEstimate,
    storageRequestEvidence: quotation.storageRequestEvidence,
    needsOriginInland: quotation.needsOriginInland,
    originInlandRoute: quotation.originInlandRoute,
    transportRoute: quotation.transportRoute,
    originalEmailText,
    clientName: quotation.client?.name || null,
    clientCnpj: quotation.client?.cnpj || null,
    clientReferenceNumber: quotation.clientReferenceNumber,
    agentEmailCode: quotation.agentEmailCode
  };
}
