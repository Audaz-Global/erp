export type TransportDecision = {
  requested: boolean;
  evidence: string;
  source: 'EXPLICIT_TEXT' | 'ADDRESS_DETECTED' | 'NOT_REQUESTED';
};

const TRANSPORT_REQUEST_PATTERNS = [
  /\b(?:frete|transporte)\s+(?:rodovi[aá]rio|terrestre|nacional)\b/i,
  /\b(?:entrega|entregar)\s+(?:final\s+)?(?:em|no|na|para|at[eé])\b/i,
  /\b(?:coleta|coletar)\s+(?:nacional|no\s+brasil|em|no|na)\b/i,
  /\bporta\s+a\s+porta\b/i,
  /\bdoor\s*[- ]?\s*to\s*[- ]?\s*door\b/i,
  /\b(?:local|final)\s+delivery\b/i,
  /\b(?:road\s+freight|domestic\s+trucking|inland\s+(?:delivery|transport))\b/i
];

const DTA_REQUEST_PATTERNS = [
  /\bDTA\b/i,
  /\btr[aâ]nsito\s+aduaneiro\b/i,
  /\bremo[cç][aã]o\s+(?:aduaneira|alfandegada)\b/i,
  /\b(?:remover|transferir|tr[aâ]nsito)\b.{0,80}\b(?:CLIA|EADI|porto\s+seco|recinto\s+alfandegado)\b/i,
  /\bcarga\s+(?:ainda\s+)?n[aã]o\s+nacionalizada\b/i
];

export function findExplicitDomesticTransportRequest(sourceText: string): TransportDecision {
  const lines = String(sourceText || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const evidence = lines.find(line => !DTA_REQUEST_PATTERNS.some(pattern => pattern.test(line)) && TRANSPORT_REQUEST_PATTERNS.some(pattern => pattern.test(line))) || '';
  return evidence
    ? { requested: true, evidence: evidence.slice(0, 500), source: 'EXPLICIT_TEXT' }
    : { requested: false, evidence: '', source: 'NOT_REQUESTED' };
}

export function findExplicitDtaRequest(sourceText: string): TransportDecision {
  const lines = String(sourceText || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const evidence = lines.find(line => DTA_REQUEST_PATTERNS.some(pattern => pattern.test(line))) || '';
  return evidence
    ? { requested:true, evidence:evidence.slice(0, 500), source:'EXPLICIT_TEXT' }
    : { requested:false, evidence:'', source:'NOT_REQUESTED' };
}

// Endereço completo tem número (rua/CEP) e um tamanho mínimo — descarta nome de cidade isolado.
function looksLikeCompleteAddress(evidence: unknown): boolean {
  const text = String(evidence || '').trim();
  return text.length >= 8 && /\d/.test(text);
}

// A evidência precisa aparecer de fato na fonte, para não aceitar um endereço alucinado pela IA.
function sourceContainsEvidence(sourceText: string, evidence: unknown): boolean {
  const normalize = (value: unknown) => String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const normalizedEvidence = normalize(evidence);
  if (!normalizedEvidence) return false;
  return normalize(sourceText).includes(normalizedEvidence);
}

export function applyDomesticTransportEvidencePolicy(extracted: any, sourceText: string) {
  if (!extracted?.route) return extracted;

  const explicitDecision = findExplicitDomesticTransportRequest(sourceText);
  const dtaDecision = findExplicitDtaRequest(sourceText);

  // A IA pode sinalizar um endereço completo de coleta/entrega sem pedido verbal explícito.
  // Só confiamos nisso com uma checagem determinística: a evidência precisa parecer um
  // endereço real e precisa aparecer literalmente no texto de origem.
  const aiDetectedAddress = extracted.route.transport_source === 'ADDRESS_DETECTED'
    && looksLikeCompleteAddress(extracted.route.transport_evidence)
    && sourceContainsEvidence(sourceText, extracted.route.transport_evidence);

  const decision: TransportDecision = explicitDecision.requested
    ? explicitDecision
    : aiDetectedAddress
      ? { requested: true, evidence: String(extracted.route.transport_evidence).slice(0, 500), source: 'ADDRESS_DETECTED' }
      : explicitDecision;

  extracted.route.needs_transport = decision.requested;
  extracted.route.transport_source = decision.source;
  extracted.route.transport_evidence = decision.evidence;
  extracted.route.needs_dta = dtaDecision.requested;
  extracted.route.dta_source = dtaDecision.source;
  extracted.route.dta_evidence = dtaDecision.evidence;
  extracted.route.dta_route = dtaDecision.requested ? (extracted.route.dta_route || dtaDecision.evidence) : '';

  if (!decision.requested) {
    extracted.route.transport_route = '';
    // Sem uma entrega terrestre expressa, o destino operacional é o porto/aeroporto.
    // Isso evita transformar endereços inferidos de assinatura em trechos para cotação.
    if (extracted.route.destination_airport) {
      extracted.route.destination_city = extracted.route.destination_airport;
    }
  }

  return extracted;
}
