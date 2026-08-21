export class HybridModalError extends Error {}

export function enforceHybridModalAcknowledgement(input: { hybridModalDetected?: boolean | null; hybridModalAcknowledged?: boolean | null }) {
  if (input.hybridModalDetected && !input.hybridModalAcknowledged) {
    throw new HybridModalError('Esta cotação foi identificada como um possível embarque híbrido (dois modais). Confirme que é um único modal ou duplique a cotação para o outro modal antes de prosseguir.');
  }
}

export type HybridModalDecision = {
  detected: boolean;
  airEvidence: string;
  seaEvidence: string;
  note: string;
};

// Termos fortes o bastante para indicar um embarque aéreo real (não apenas uma
// menção incidental, como "seguir de caminhão até o aeroporto").
const AIR_SIGNAL_PATTERNS = [
  /\bAWB\b/i,
  /\bair\s*waybill\b/i,
  /\bairway\s*bill\b/i,
  /\bfrete\s*a[ée]reo\b/i,
  /\bembarque\s*a[ée]reo\b/i,
  /\bcarga\s*a[ée]rea\b/i,
  /\bair\s*freight\b/i,
  /\bair\s*shipment\b/i
];

// Termos fortes o bastante para indicar um embarque marítimo/LCL real.
const SEA_SIGNAL_PATTERNS = [
  /\bB\/L\b/i,
  /\bbill\s*of\s*lading\b/i,
  /\bLCL\b/,
  /\bFCL\b/,
  /\bfrete\s*mar[ií]timo\b/i,
  /\bembarque\s*mar[ií]timo\b/i,
  /\bcarga\s*mar[ií]tima\b/i,
  /\bsea\s*freight\b/i,
  /\bcont[eê]iner(?:es)?\b/i,
  /\bcontainer(?:s)?\b/i
];

function firstMatchingLine(sourceText: string, patterns: RegExp[]): string {
  const lines = String(sourceText || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const line = lines.find(item => patterns.some(pattern => pattern.test(item)));
  return line ? line.slice(0, 500) : '';
}

// Rede de segurança determinística: roda sempre, independente do que a IA
// concluiu, procurando termos fortes de AMBOS os modais no mesmo texto-fonte.
export function detectHybridModalSignals(sourceText: string): HybridModalDecision {
  const airEvidence = firstMatchingLine(sourceText, AIR_SIGNAL_PATTERNS);
  const seaEvidence = firstMatchingLine(sourceText, SEA_SIGNAL_PATTERNS);
  const detected = Boolean(airEvidence && seaEvidence);
  return {
    detected,
    airEvidence,
    seaEvidence,
    note: detected ? 'Termos de frete aéreo e marítimo/LCL identificados na mesma solicitação (varredura automática).' : ''
  };
}

// Combina o sinal da IA (mais preciso, entende contexto) com a varredura
// determinística (mais barata, serve de rede de segurança) num único veredito.
export function applyHybridModalPolicy(extracted: any, sourceText: string) {
  if (!extracted?.cargo) return extracted;
  const deterministic = detectHybridModalSignals(sourceText);
  const aiDetected = Boolean(extracted.cargo.hybrid_shipment_detected);
  const aiNote = String(extracted.cargo.hybrid_shipment_note || '').trim();

  const detected = aiDetected || deterministic.detected;
  const notes = [aiDetected ? aiNote : '', deterministic.detected ? deterministic.note : ''].filter(Boolean);

  extracted.cargo.hybrid_shipment_detected = detected;
  extracted.cargo.hybrid_shipment_note = notes.join(' ') || null;
  extracted.cargo.hybrid_shipment_air_evidence = deterministic.airEvidence || null;
  extracted.cargo.hybrid_shipment_sea_evidence = deterministic.seaEvidence || null;
  return extracted;
}
