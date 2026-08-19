export type TransportDecision = {
  requested: boolean;
  evidence: string;
  source: 'EXPLICIT_TEXT' | 'NOT_REQUESTED';
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

export function applyDomesticTransportEvidencePolicy(extracted: any, sourceText: string) {
  if (!extracted?.route) return extracted;

  const decision = findExplicitDomesticTransportRequest(sourceText);
  const dtaDecision = findExplicitDtaRequest(sourceText);
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
