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

// Sufixos jurídicos/genéricos que aparecem no final de razões sociais
// brasileiras e não carregam identidade da empresa (ex: "X INDÚSTRIA E
// COMÉRCIO LTDA"). Siglas de UF isoladas no final costumam indicar filial/
// site (ex: "X SP"). Removidas só do final — nunca do meio/início — pra não
// arriscar cortar uma palavra que faça parte do nome de fantasia.
const LEGAL_SUFFIX_WORDS = new Set([
  'LTDA', 'LTD', 'SA', 'EIRELI', 'ME', 'EPP', 'CIA', 'COMPANHIA',
  'INDUSTRIA', 'COMERCIO', 'IMPORTACAO', 'EXPORTACAO', 'IMP', 'EXP',
  'DISTRIBUIDORA', 'HOLDING', 'DO', 'DA', 'DE', 'DOS', 'DAS', 'E',
  'BRASIL', 'BRAZIL'
]);

const BR_STATE_CODES = new Set([
  'SP', 'RJ', 'MG', 'RS', 'PR', 'SC', 'BA', 'PE', 'CE', 'GO', 'DF', 'ES',
  'PA', 'AM', 'MT', 'MS', 'MA', 'PB', 'RN', 'AL', 'SE', 'PI', 'RO', 'AC',
  'AP', 'RR', 'TO'
]);

// "IND"/"COM" (de "Ind. e Com. Ltda") não estão no set por extenso — trata
// como ruído também quando é uma abreviação (prefixo de 3+ letras) de uma
// das palavras do set, mesma tolerância já usada na comparação principal.
function isNoiseWord(word: string, set: Set<string>): boolean {
  if (set.has(word)) return true;
  if (word.length < 3) return false;
  for (const candidate of set) {
    if (candidate.length >= 3 && candidate.startsWith(word)) return true;
  }
  return false;
}

function stripTrailingNoiseWords(words: string[]): string[] {
  const trimmed = [...words];
  let last = trimmed[trimmed.length - 1];
  while (trimmed.length > 1 && last !== undefined && isNoiseWord(last, LEGAL_SUFFIX_WORDS)) {
    trimmed.pop();
    last = trimmed[trimmed.length - 1];
  }
  if (trimmed.length > 1 && last !== undefined && BR_STATE_CODES.has(last)) {
    trimmed.pop();
  }
  return trimmed;
}

// Considera dois nomes de empresa como a mesma empresa quando têm o mesmo
// número de palavras, na mesma ordem, e cada par de palavras é idêntico ou
// uma é abreviação da outra (prefixo de pelo menos 3 letras) — cobre casos
// como a IA extrair "CONEX." numa cotação e "CONEXOES" noutra. Exigir a
// mesma contagem/ordem de palavras evita falso positivo entre empresas
// diferentes que só compartilham um termo comum. Sufixos jurídicos e sigla
// de UF de filial são descartados do final antes da comparação, senão um
// nome curto de e-mail (ex: "RESIPLASTIC SP") nunca bateria contra a razão
// social completa cadastrada ("Resiplastic Indústria e Comércio Ltda").
export function companyNamesLikelyMatch(a?: string | null, b?: string | null): boolean {
  const wordsA = stripTrailingNoiseWords(normalizeCompanyName(a).split(' ').filter(Boolean));
  const wordsB = stripTrailingNoiseWords(normalizeCompanyName(b).split(' ').filter(Boolean));
  if (!wordsA.length || wordsA.length !== wordsB.length) return false;
  return wordsA.every((wa, i) => {
    const wb = wordsB[i] || '';
    if (wa === wb) return true;
    const shorter = wa.length < wb.length ? wa : wb;
    const longer = wa.length < wb.length ? wb : wa;
    return shorter.length >= 3 && longer.startsWith(shorter);
  });
}

// Comparação mais permissiva que companyNamesLikelyMatch — não exige mesma
// contagem/ordem de palavras, só que todas as palavras com identidade (sem
// sufixo jurídico/UF) do nome mais curto apareçam no mais longo. Pega casos
// como "Gestamp" dentro de "GESTAMP BRASIL INDÚSTRIA DE AUTOPEÇAS S/A FILIAL
// TAUBATÉ", que companyNamesLikelyMatch não detecta. Mais propenso a falso
// positivo entre nomes curtos, então serve só pra AVISAR o operador de
// possível duplicidade — nunca pra decidir automaticamente que é o mesmo
// cliente.
export function companyNamesOverlap(a?: string | null, b?: string | null): boolean {
  const meaningfulWords = (value?: string | null) =>
    normalizeCompanyName(value).split(' ').filter(Boolean).filter(w => !isNoiseWord(w, LEGAL_SUFFIX_WORDS));
  const wordsA = meaningfulWords(a);
  const wordsB = meaningfulWords(b);
  if (!wordsA.length || !wordsB.length) return false;
  const [shorter, longer] = wordsA.length <= wordsB.length ? [wordsA, wordsB] : [wordsB, wordsA];
  return shorter.every(sw => longer.some(lw => {
    if (sw === lw) return true;
    const shorterWord = sw.length < lw.length ? sw : lw;
    const longerWord = sw.length < lw.length ? lw : sw;
    return shorterWord.length >= 3 && longerWord.startsWith(shorterWord);
  }));
}
