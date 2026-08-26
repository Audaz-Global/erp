// Normaliza um nome de empresa para comparação: maiúsculas, sem acento,
// pontos e outra pontuação viram espaço, espaços duplicados colapsados.
export function normalizeCompanyName(value?: string | null): string {
  return String(value || '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[^\x00-\x7F]/g, '') // remove marcas de acento (não-ASCII) que sobraram da decomposição NFD
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Considera dois nomes de empresa como a mesma empresa quando têm o mesmo
// número de palavras, na mesma ordem, e cada par de palavras é idêntico ou
// uma é abreviação da outra (prefixo de pelo menos 3 letras) — cobre casos
// como a IA extrair "CONEX." numa cotação e "CONEXOES" noutra. Exigir a
// mesma contagem/ordem de palavras evita falso positivo entre empresas
// diferentes que só compartilham um termo comum.
export function companyNamesLikelyMatch(a?: string | null, b?: string | null): boolean {
  const wordsA = normalizeCompanyName(a).split(' ').filter(Boolean);
  const wordsB = normalizeCompanyName(b).split(' ').filter(Boolean);
  if (!wordsA.length || wordsA.length !== wordsB.length) return false;
  return wordsA.every((wa, i) => {
    const wb = wordsB[i] || '';
    if (wa === wb) return true;
    const shorter = wa.length < wb.length ? wa : wb;
    const longer = wa.length < wb.length ? wb : wa;
    return shorter.length >= 3 && longer.startsWith(shorter);
  });
}
