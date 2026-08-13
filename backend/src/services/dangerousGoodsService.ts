export const DG_STATUS = {
  CONFIRMED: 'CONFIRMED',
  NOT_DANGEROUS: 'NOT_DANGEROUS',
  TO_CONFIRM: 'TO_CONFIRM'
} as const;

export const MSDS_STATUS = {
  NOT_REQUESTED: 'NOT_REQUESTED',
  REQUESTED: 'REQUESTED',
  PENDING: 'PENDING',
  RECEIVED: 'RECEIVED',
  VALIDATED: 'VALIDATED',
  WAIVED: 'WAIVED'
} as const;

const dgStatusValues = new Set(Object.values(DG_STATUS));
const msdsStatusValues = new Set(Object.values(MSDS_STATUS));

function plain(value: unknown) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
}

export function normalizeDangerousGoodsStatus(value: unknown, legacyIsImo?: unknown) {
  const normalized = plain(value).replace(/[ -]+/g, '_');
  // Registros anteriores ao status tri-state podem chegar com o novo default
  // TO_CONFIRM e o indicador legado verdadeiro. Nesse caso, preserve a
  // classificação já confirmada.
  if ((legacyIsImo === true || legacyIsImo === 'true') && (!normalized || normalized === DG_STATUS.TO_CONFIRM)) return DG_STATUS.CONFIRMED;
  if (dgStatusValues.has(normalized as any)) return normalized;
  if (['SIM', 'YES', 'TRUE', 'DG', 'IMO', 'DANGEROUS_GOODS'].includes(normalized)) return DG_STATUS.CONFIRMED;
  if (['NAO', 'NO', 'FALSE', 'NON_DG', 'NOT_DANGEROUS'].includes(normalized)) return DG_STATUS.NOT_DANGEROUS;
  if (legacyIsImo === true || legacyIsImo === 'true') return DG_STATUS.CONFIRMED;
  if (legacyIsImo === false || legacyIsImo === 'false') return DG_STATUS.NOT_DANGEROUS;
  return DG_STATUS.TO_CONFIRM;
}

export function normalizeMsdsStatus(value: unknown, dangerousGoodsStatus: string) {
  const normalized = plain(value).replace(/[ -]+/g, '_');
  if (msdsStatusValues.has(normalized as any)) return normalized;
  return dangerousGoodsStatus === DG_STATUS.CONFIRMED ? MSDS_STATUS.PENDING : MSDS_STATUS.NOT_REQUESTED;
}

export function canonicalFeeCategory(name: unknown) {
  const value = plain(name).replace(/[^A-Z0-9]+/g, ' ').trim();
  const aliases = [
    /\bDG\s*(FEE|SURCHARGE|CHARGE)\b/,
    /\bIMO\s*(FEE|SURCHARGE|CHARGE)\b/,
    /\bDGR\s*(FEE|SURCHARGE|CHARGE)\b/,
    /\bDANGEROUS\s*(GOODS|CARGO)\s*(FEE|SURCHARGE|CHARGE)\b/,
    /\bHAZMAT\s*(FEE|SURCHARGE|CHARGE)\b/
  ];
  return aliases.some(pattern => pattern.test(value)) ? 'DANGEROUS_GOODS_FEE' : null;
}

export function normalizeFeeList(value: unknown): any[] {
  let fees: any[] = [];
  if (Array.isArray(value)) fees = value;
  else if (typeof value === 'string') {
    try { const parsed = JSON.parse(value); fees = Array.isArray(parsed) ? parsed : []; } catch { fees = []; }
  }
  return fees.map(fee => {
    const canonicalCategory = canonicalFeeCategory(fee?.name);
    return canonicalCategory ? { ...fee, canonicalCategory } : fee;
  });
}

export function normalizeDangerousGoodsPayload(payload: any, current?: any) {
  const hasStatus = payload.dangerousGoodsStatus !== undefined;
  const hasLegacy = payload.isImo !== undefined;
  const status = normalizeDangerousGoodsStatus(
    hasStatus ? payload.dangerousGoodsStatus : current?.dangerousGoodsStatus,
    hasLegacy ? payload.isImo : (!hasStatus ? current?.isImo : undefined)
  );
  payload.dangerousGoodsStatus = status;
  payload.isImo = status === DG_STATUS.CONFIRMED;
  payload.msdsStatus = normalizeMsdsStatus(
    payload.msdsStatus !== undefined ? payload.msdsStatus : current?.msdsStatus,
    status
  );
  for (const field of ['originServices', 'destinationServices']) {
    if (payload[field] !== undefined && payload[field] !== null) {
      payload[field] = JSON.stringify(normalizeFeeList(payload[field]));
    }
  }
  return payload;
}

export function dangerousGoodsCompliance(quotation: any) {
  const status = normalizeDangerousGoodsStatus(quotation?.dangerousGoodsStatus, quotation?.isImo);
  const msdsStatus = normalizeMsdsStatus(quotation?.msdsStatus, status);
  const fees = [
    ...normalizeFeeList(quotation?.originServices),
    ...normalizeFeeList(quotation?.destinationServices)
  ];
  const dgFees = fees.filter(fee => fee?.canonicalCategory === 'DANGEROUS_GOODS_FEE');
  const alerts: Array<{ code: string; level: 'INFO' | 'WARNING'; message: string }> = [];
  if (status === DG_STATUS.TO_CONFIRM) alerts.push({ code: 'DG_TO_CONFIRM', level: 'WARNING', message: 'Classificação de carga perigosa ainda precisa ser confirmada.' });
  if (status === DG_STATUS.CONFIRMED && !['RECEIVED', 'VALIDATED', 'WAIVED'].includes(msdsStatus)) {
    alerts.push({ code: 'MSDS_PENDING', level: 'WARNING', message: 'MSDS pendente. Solicite ou verifique o documento; a cotação pode continuar.' });
  }
  if (status === DG_STATUS.CONFIRMED && dgFees.length === 0) alerts.push({ code: 'DG_FEE_MISSING', level: 'WARNING', message: 'Carga perigosa sem DG Fee, IMO Fee ou taxa equivalente identificada.' });
  if (dgFees.length > 1) alerts.push({ code: 'DG_FEE_DUPLICATE', level: 'WARNING', message: 'Possível duplicidade de taxa DG/IMO. Confirme se as cobranças são realmente distintas.' });
  return { status, msdsStatus, dgFeeCount: dgFees.length, dgFees, alerts };
}

export function withDangerousGoodsCompliance<T extends object>(quotation: T) {
  const compliance = dangerousGoodsCompliance(quotation);
  return { ...quotation, dangerousGoodsStatus: compliance.status, msdsStatus: compliance.msdsStatus, dangerousGoodsCompliance: compliance };
}
