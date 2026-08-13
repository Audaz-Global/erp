export const BILLING_UNITS = {
  TOTAL_SHIPMENT: 'TOTAL_SHIPMENT',
  PER_DG_PRODUCT: 'PER_DG_PRODUCT',
  PER_ITEM: 'PER_ITEM',
  PER_PACKAGE: 'PER_PACKAGE',
  PER_DOCUMENT: 'PER_DOCUMENT',
  PER_HAWB: 'PER_HAWB',
  PER_MAWB: 'PER_MAWB',
  PER_SHIPMENT: 'PER_SHIPMENT',
  PER_CONTAINER: 'PER_CONTAINER',
  PER_BL: 'PER_BL',
  PER_KG: 'PER_KG',
  PER_CHARGEABLE_WEIGHT: 'PER_CHARGEABLE_WEIGHT',
  PER_CBM: 'PER_CBM',
  PER_TON: 'PER_TON',
  PER_WM: 'PER_WM',
  PERCENTAGE: 'PERCENTAGE',
  UNKNOWN: 'UNKNOWN'
} as const;

export const ISPS_CLASSIFICATIONS = {
  CARRIER: 'ISPS_CARRIER', TERMINAL: 'ISPS_TERMINAL', UNCLASSIFIED: 'ISPS_UNCLASSIFIED'
} as const;

export const FREIGHT_INCLUSION = {
  INCLUDED: 'INCLUDED', NOT_INCLUDED: 'NOT_INCLUDED', TO_CONFIRM: 'TO_CONFIRM'
} as const;

const validUnits = new Set(Object.values(BILLING_UNITS));
const fixedQuantityUnits = new Set([BILLING_UNITS.TOTAL_SHIPMENT, BILLING_UNITS.PER_SHIPMENT]);
const quantityRequiredUnits = new Set([
  BILLING_UNITS.PER_DG_PRODUCT, BILLING_UNITS.PER_ITEM, BILLING_UNITS.PER_PACKAGE,
  BILLING_UNITS.PER_DOCUMENT, BILLING_UNITS.PER_HAWB, BILLING_UNITS.PER_MAWB,
  BILLING_UNITS.PER_CONTAINER, BILLING_UNITS.PER_BL, BILLING_UNITS.PER_KG,
  BILLING_UNITS.PER_CHARGEABLE_WEIGHT, BILLING_UNITS.PER_CBM, BILLING_UNITS.PER_TON, BILLING_UNITS.PER_WM
]);

function plain(value: unknown) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
}

function finite(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function canonicalFeeCategory(name: unknown) {
  const value = plain(name).replace(/[^A-Z0-9]+/g, ' ').trim();
  const aliases = [
    /\bDG\s*(FEE|SURCHARGE|CHARGE)\b/, /\bIMO\s*(FEE|SURCHARGE|CHARGE)\b/,
    /\bDGR\s*(FEE|SURCHARGE|CHARGE)\b/,
    /\bDANGEROUS\s*(GOODS|CARGO)\s*(FEE|SURCHARGE|CHARGE)\b/,
    /\bHAZMAT\s*(FEE|SURCHARGE|CHARGE)\b/
  ];
  if (aliases.some(pattern => pattern.test(value))) return 'DANGEROUS_GOODS_FEE';
  if (/\bISPS\b|\bINTERNATIONAL SHIP AND PORT FACILITY SECURITY\b|\b(TERMINAL|PORT) SECURITY (FEE|CHARGE|SURCHARGE)\b/.test(value)) return 'ISPS_FEE';
  return null;
}

export function normalizeIspsClassification(value: unknown, context: unknown) {
  const explicit = plain(value).replace(/[^A-Z0-9]+/g, '_');
  if (Object.values(ISPS_CLASSIFICATIONS).includes(explicit as any)) return explicit;
  const text = plain(context).replace(/[^A-Z0-9]+/g, ' ');
  const carrier = /\b(CARRIER|ARMADOR|VESSEL|NAVIO|OCEAN FREIGHT|SEA FREIGHT|SHIPPING LINE)\b/.test(text);
  const terminal = /\b(TERMINAL|PORT|PORTO|WHARF|CY)\b/.test(text);
  if (carrier && !terminal) return ISPS_CLASSIFICATIONS.CARRIER;
  if (terminal && !carrier) return ISPS_CLASSIFICATIONS.TERMINAL;
  return ISPS_CLASSIFICATIONS.UNCLASSIFIED;
}

export function normalizeFreightInclusion(value: unknown) {
  if (value === true) return FREIGHT_INCLUSION.INCLUDED;
  if (value === false) return FREIGHT_INCLUSION.NOT_INCLUDED;
  const normalized = plain(value).replace(/[^A-Z0-9]+/g, '_');
  if (Object.values(FREIGHT_INCLUSION).includes(normalized as any)) return normalized;
  if (/INCLUD|INCLUS|ALL_IN/.test(normalized)) return FREIGHT_INCLUSION.INCLUDED;
  if (/NOT_INCLUDED|EXCLUD|SEPARATE|A_PARTE|ADDITIONAL|ADICIONAL/.test(normalized)) return FREIGHT_INCLUSION.NOT_INCLUDED;
  return FREIGHT_INCLUSION.TO_CONFIRM;
}

function normalizeApplicationScope(value: unknown) {
  const normalized = plain(value);
  if (/ORIGIN|ORIGEM/.test(normalized)) return 'ORIGIN';
  if (/DESTINATION|DESTINO/.test(normalized)) return 'DESTINATION';
  if (/TRANSIT|TRANSITO|TRANSSHIPMENT|TRANSBORDO/.test(normalized)) return 'TRANSIT';
  return 'UNKNOWN';
}

export function normalizeBillingUnit(value: unknown, originalUnit?: unknown) {
  const normalized = plain(value).replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
  if (validUnits.has(normalized as any)) return normalized;
  const source = `${normalized} ${plain(originalUnit)}`.replace(/[^A-Z0-9]+/g, ' ').trim();
  const rules: Array<[RegExp, string]> = [
    [/\b(PER DG PRODUCT|PER IMO PRODUCT|PER DANGEROUS (GOODS|PRODUCT)|DG ITEM|IMO ITEM)\b/, BILLING_UNITS.PER_DG_PRODUCT],
    [/\b(PER CONTAINER|PER CNTR|CNTR|CONT(EINER|AINER))\b/, BILLING_UNITS.PER_CONTAINER],
    [/\b(PER SHIPMENT|PER SHPT|SHIPMENT|REMESSA|EMBARQUE|FIXED|FIXO)\b/, BILLING_UNITS.PER_SHIPMENT],
    [/\b(PER DOCUMENT|PER DOC|SET OF DOCS|DOCUMENTO)\b/, BILLING_UNITS.PER_DOCUMENT],
    [/\b(PER HAWB|HAWB)\b/, BILLING_UNITS.PER_HAWB], [/\b(PER MAWB|MAWB)\b/, BILLING_UNITS.PER_MAWB],
    [/\b(PER BL|B\/L)\b/, BILLING_UNITS.PER_BL],
    [/\b(PER (PACKAGE|VOLUME)|PACKAGE|VOLUME)\b/, BILLING_UNITS.PER_PACKAGE],
    [/\b(PER (ITEM|UNIT)|ITEM|UNIDADE)\b/, BILLING_UNITS.PER_ITEM],
    [/\b(PER CHARGEABLE|CHARGEABLE WEIGHT|PESO TAXAVEL)\b/, BILLING_UNITS.PER_CHARGEABLE_WEIGHT],
    [/\b(PER TON|TONELADA|TONNE)\b/, BILLING_UNITS.PER_TON], [/\b(W M|WM|PER WM|WEIGHT OR MEASURE)\b/, BILLING_UNITS.PER_WM],
    [/\b(PER KG|\/KG|KG)\b/, BILLING_UNITS.PER_KG], [/\b(PER CBM|M3|CBM)\b/, BILLING_UNITS.PER_CBM],
    [/\b(PERCENTAGE|PERCENTUAL|PERCENT|%)\b/, BILLING_UNITS.PERCENTAGE],
    [/\b(TOTAL|ALL IN)\b/, BILLING_UNITS.TOTAL_SHIPMENT]
  ];
  return rules.find(([pattern]) => pattern.test(source))?.[1] || BILLING_UNITS.UNKNOWN;
}

export function normalizeFee(fee: any) {
  const source = fee && typeof fee === 'object' ? fee : {};
  const hasStructuredFields = ['unitValue', 'billingUnit', 'quantity', 'totalValue'].some(key => source[key] !== undefined);
  const billingUnit = normalizeBillingUnit(source.billingUnit || source.unit, source.originalUnit || source.unitLabel || source.application);
  let unitValue = finite(source.unitValue);
  let quantity = finite(source.quantity);
  let totalValue = finite(source.totalValue);
  const legacyValue = finite(source.value) || 0;

  if (!hasStructuredFields) {
    unitValue = legacyValue;
    quantity = 1;
    totalValue = legacyValue;
  } else {
    if (fixedQuantityUnits.has(billingUnit as any) && quantity === null) quantity = 1;
    // `value` era o total no formato legado. Quando a resposta já traz
    // unidade/quantidade, preserve essa semântica e derive o unitário para
    // evitar multiplicar o total novamente.
    if (totalValue === null && source.value !== undefined) totalValue = legacyValue;
    if (unitValue === null) unitValue = totalValue !== null && quantity !== null && quantity !== 0 ? totalValue / quantity : legacyValue;
    if (totalValue === null && unitValue !== null && quantity !== null) totalValue = unitValue * quantity;
    if (totalValue === null && source.valueIsTotal === true) totalValue = legacyValue;
  }

  const calculated = unitValue !== null && quantity !== null ? unitValue * quantity : null;
  const inconsistentTotal = calculated !== null && totalValue !== null && Math.abs(calculated - totalValue) > 0.01;
  const quantityMissing = quantityRequiredUnits.has(billingUnit as any) && quantity === null;
  const unitMissing = billingUnit === BILLING_UNITS.UNKNOWN;
  const canonicalCategory = source.canonicalCategory || canonicalFeeCategory(source.name);
  const ispsContext = [source.name, source.evidence, source.description, source.originalUnit, source.chargedBy].filter(Boolean).join(' ');
  const ispsClassification = canonicalCategory === 'ISPS_FEE' ? normalizeIspsClassification(source.ispsClassification, ispsContext) : null;
  const includedInFreight = canonicalCategory === 'ISPS_FEE' ? normalizeFreightInclusion(source.includedInFreight !== undefined ? source.includedInFreight : ispsContext) : null;
  const ispsClassificationMissing = canonicalCategory === 'ISPS_FEE' && ispsClassification === ISPS_CLASSIFICATIONS.UNCLASSIFIED;
  const freightInclusionUnknown = canonicalCategory === 'ISPS_FEE' && includedInFreight === FREIGHT_INCLUSION.TO_CONFIRM;
  const needsReview = Boolean(source.needsReview || unitMissing || quantityMissing || inconsistentTotal || ispsClassificationMissing || freightInclusionUnknown);
  const reviewReasons = [
    ...(Array.isArray(source.reviewReasons) ? source.reviewReasons : []),
    ...(unitMissing ? ['BILLING_UNIT_MISSING'] : []),
    ...(quantityMissing ? ['QUANTITY_MISSING'] : []),
    ...(inconsistentTotal ? ['TOTAL_MISMATCH'] : []),
    ...(ispsClassificationMissing ? ['ISPS_CLASSIFICATION_MISSING'] : []),
    ...(freightInclusionUnknown ? ['ISPS_FREIGHT_INCLUSION_UNCONFIRMED'] : [])
  ];
  return {
    ...source,
    name: String(source.name || '').trim(), currency: String(source.currency || 'USD').toUpperCase(),
    canonicalCategory,
    unitValue: unitValue || 0, value: totalValue ?? legacyValue, billingUnit,
    originalUnit: source.originalUnit || source.unitLabel || source.application || null,
    quantity, totalValue, quantitySource: source.quantitySource || null,
    evidence: source.evidence || null, confidence: finite(source.confidence),
    ispsClassification, applicationScope: canonicalCategory === 'ISPS_FEE' ? normalizeApplicationScope(source.applicationScope || source.feeType || ispsContext) : null,
    chargedBy: canonicalCategory === 'ISPS_FEE' ? (source.chargedBy || null) : null,
    includedInFreight,
    needsReview, reviewReasons: [...new Set(reviewReasons)]
  };
}

export function normalizeFeeList(value: unknown, defaultScope?: 'ORIGIN' | 'DESTINATION'): any[] {
  let fees: any[] = [];
  if (Array.isArray(value)) fees = value;
  else if (typeof value === 'string') {
    try { const parsed = JSON.parse(value); fees = Array.isArray(parsed) ? parsed : []; } catch { fees = []; }
  }
  return fees.map(fee => normalizeFee(defaultScope && !fee?.applicationScope ? { ...fee, applicationScope: defaultScope } : fee));
}

export function resolveFeeQuantities(value: unknown, context: any) {
  return normalizeFeeList(value).map(fee => {
    if (fee.quantity !== null) return fee;
    let quantity: number | null = null;
    let quantitySource: string | null = null;
    if (fee.billingUnit === BILLING_UNITS.PER_DG_PRODUCT && Number(context?.dangerousGoodsProductCount) > 0) {
      quantity = Number(context.dangerousGoodsProductCount); quantitySource = 'CARGO_DG_PRODUCTS';
    } else if (fee.billingUnit === BILLING_UNITS.PER_PACKAGE && Number(context?.totalPackages) > 0) {
      quantity = Number(context.totalPackages); quantitySource = 'PACKAGE_COUNT';
    } else if (fee.billingUnit === BILLING_UNITS.PER_CBM && Number(context?.totalCbm) > 0) {
      quantity = Number(context.totalCbm); quantitySource = 'CARGO_CBM';
    }
    return quantity === null ? fee : normalizeFee({ ...fee, quantity, quantitySource, totalValue: fee.unitValue * quantity, value: fee.unitValue * quantity, needsReview: false, reviewReasons: [] });
  });
}

export function feeTotal(fee: any) {
  return normalizeFee(fee).totalValue;
}

export function feeCalculationAlerts(fees: unknown) {
  return normalizeFeeList(fees).filter(fee => fee.needsReview).map(fee => ({
    code: fee.reviewReasons[0] || 'FEE_REVIEW_REQUIRED', feeName: fee.name,
    message: `${fee.name || 'Taxa'}: ${fee.reviewReasons.includes('ISPS_CLASSIFICATION_MISSING') ? 'ISPS sem classificação entre armador e terminal' : fee.reviewReasons.includes('ISPS_FREIGHT_INCLUSION_UNCONFIRMED') ? 'não foi possível confirmar se a ISPS já está incluída no frete' : fee.reviewReasons.includes('BILLING_UNIT_MISSING') ? 'unidade de cobrança não identificada' : fee.reviewReasons.includes('QUANTITY_MISSING') ? 'quantidade aplicável não identificada' : 'total divergente do valor unitário × quantidade'}.`
  }));
}

export function ispsCompliance(fees: unknown) {
  const ispsFees = normalizeFeeList(fees).filter(fee => fee.canonicalCategory === 'ISPS_FEE');
  const alerts: Array<{ code: string; level: 'INFO' | 'WARNING'; message: string; feeNames?: string[] }> = [];
  const groups = new Map<string, any[]>();
  for (const fee of ispsFees) {
    if (fee.ispsClassification === ISPS_CLASSIFICATIONS.UNCLASSIFIED) alerts.push({ code:'ISPS_UNCLASSIFIED', level:'WARNING', message:`${fee.name}: classifique a ISPS como armador ou terminal.`, feeNames:[fee.name] });
    if (fee.includedInFreight === FREIGHT_INCLUSION.INCLUDED) alerts.push({ code:'ISPS_ALREADY_INCLUDED', level:'WARNING', message:`${fee.name}: a cobrança foi indicada como incluída no frete; verifique antes de somá-la separadamente.`, feeNames:[fee.name] });
    if (fee.includedInFreight === FREIGHT_INCLUSION.TO_CONFIRM) alerts.push({ code:'ISPS_INCLUSION_TO_CONFIRM', level:'WARNING', message:`${fee.name}: confirme se a ISPS está incluída no frete marítimo.`, feeNames:[fee.name] });
    const key = [fee.ispsClassification, fee.applicationScope, plain(fee.chargedBy), fee.billingUnit].join('|');
    groups.set(key, [...(groups.get(key) || []), fee]);
  }
  groups.forEach(group => { if (group.length > 1) alerts.push({ code:'ISPS_POSSIBLE_DUPLICATE', level:'WARNING', message:'Possível duplicidade de ISPS com mesma classificação, aplicação, responsável e unidade.', feeNames:group.map(fee => fee.name) }); });
  const classes = new Set(ispsFees.map(fee => fee.ispsClassification));
  if (classes.has(ISPS_CLASSIFICATIONS.CARRIER) && classes.has(ISPS_CLASSIFICATIONS.TERMINAL)) alerts.push({ code:'ISPS_CARRIER_AND_TERMINAL', level:'INFO', message:'ISPS de armador e de terminal coexistem. Confirme que ambas são aplicáveis.', feeNames:ispsFees.map(fee => fee.name) });
  return { ispsFees, alerts };
}
