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
