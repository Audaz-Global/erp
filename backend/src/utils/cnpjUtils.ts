// Reduz um CNPJ/Tax ID a uma chave de comparação estável — maiúsculas, sem
// pontuação/espaços e sem prefixo de país colado antes do número (ex: a IA
// às vezes extrai "BR04.610.779/0001-18" em vez de "04.610.779/0001-18").
// Não deve ser usada para exibição nem gravação — só para achar duplicidade
// de cliente com o mesmo CNPJ formatado de jeitos diferentes.
export function cnpjMatchKey(value?: string | null): string | null {
  const cleaned = String(value || '').toUpperCase().replace(/[.\-/\s]/g, '');
  if (!cleaned) return null;
  const withCountryPrefix = cleaned.match(/^[A-Z]{2}(\d{14})$/);
  if (withCountryPrefix) return withCountryPrefix[1] ?? cleaned;
  return cleaned;
}
