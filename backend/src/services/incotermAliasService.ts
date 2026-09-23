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
  if (mapped) return mapped;

  // Notação padrão Incoterms 2020: código + local nomeado (ex: "EXW Jasienica",
  // "FOB Shanghai, China"). Se a IA extraiu a frase inteira, usa só o código
  // no início, senão o <select> do Passo 3 não bate com nenhuma opção e o
  // campo fica em branco mesmo com o incoterm certo na auditoria.
  const leadingMatch = original.match(/^([A-Za-z]{2,4})\b/);
  if (leadingMatch) {
    const leadingKey = normalizeKey(leadingMatch[1]);
    if (CANONICAL_INCOTERMS.has(leadingKey)) return leadingKey;
  }

  return original;
}

// Incoterms 2020: FOB (junto com FAS/CFR/CIF) é exclusivo de transporte
// aquaviário — não existe "FOB aéreo". Quando o modal é aéreo e o Incoterm
// lido (extraído por IA ou digitado manualmente) é FOB, o equivalente
// correto é FCA (mesmo princípio de entrega ao transportador indicado pelo
// comprador, sem a exigência específica de embarque marítimo).
export function coerceIncotermForModal(incoterm: string, modal: unknown): string {
  const isAir = String(modal || '').trim().toUpperCase() === 'AIR';
  return isAir && incoterm === 'FOB' ? 'FCA' : incoterm;
}
