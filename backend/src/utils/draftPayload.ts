import type { Quotation } from '@prisma/client';

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
  requiresInsurance: boolean;
  transportRoute: string | null;
  originalEmailText: string;
}

export function buildDraftPayload(quotation: Quotation, originalEmailText: string): DraftPayload {
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
    requiresInsurance: quotation.requiresInsurance,
    transportRoute: quotation.transportRoute,
    originalEmailText
  };
}
