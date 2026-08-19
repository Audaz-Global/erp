export const CANONICAL_INCOTERMS = new Set([
  'EXW', 'FCA', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'
]);

function normalizeKey(value: unknown): string {
  return String(value || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

// Chaves já normalizadas (sem acento/espaço/pontuação) apontando para o código Incoterm 2020 canônico.
// Grafias que colapsam para o próprio código após normalizeKey (ex: "F.O.B" -> "FOB") não precisam de entrada aqui.
const INCOTERM_ALIAS_MAP: Record<string, string> = {
  EXWORKS: 'EXW', EXFACTORY: 'EXW', XWORKS: 'EXW', XWKS: 'EXW', EXWORK: 'EXW',
  FREECARRIER: 'FCA',
  FREEONBOARD: 'FOB',
  COSTANDFREIGHT: 'CFR', CF: 'CFR', CNF: 'CFR', CANDF: 'CFR',
  COSTINSURANCEANDFREIGHT: 'CIF',
  CARRIAGEPAIDTO: 'CPT',
  CARRIAGEANDINSURANCEPAIDTO: 'CIP',
  DELIVEREDATPLACE: 'DAP',
  DELIVEREDATPLACEUNLOADED: 'DPU', DELIVEREDATTERMINAL: 'DPU', DAT: 'DPU',
  DELIVEREDDUTYPAID: 'DDP'
};

// Retorna o texto original (trim) sem correspondência, para não mascarar uma grafia desconhecida.
export function normalizeIncotermText(raw: unknown): string {
  const original = String(raw || '').trim();
  if (!original) return original;
  const key = normalizeKey(original);
  if (CANONICAL_INCOTERMS.has(key)) return key;
  const mapped = INCOTERM_ALIAS_MAP[key];
  return mapped || original;
}
