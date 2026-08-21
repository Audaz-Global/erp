export class CnpjRequiredError extends Error {}

type CnpjCheckInput = {
  loadType?: string | null;
  requiresStorageEstimate?: boolean | null;
  clientCnpj?: string | null;
};

// Sem o CNPJ do cliente, o parceiro/co-loader não consegue localizar a tabela
// de armazenagem de destino aplicável — por isso é obrigatório em LCL ou
// sempre que o cliente pedir estimativa de armazenagem.
export function requiresCnpj(input: CnpjCheckInput): boolean {
  return String(input.loadType || '').toUpperCase() === 'LCL' || Boolean(input.requiresStorageEstimate);
}

export function enforceCnpjRequirement(input: CnpjCheckInput) {
  if (!requiresCnpj(input)) return;
  if (!String(input.clientCnpj || '').trim()) {
    throw new CnpjRequiredError('CNPJ do cliente é obrigatório para cotações LCL ou quando a estimativa de armazenagem de destino for solicitada.');
  }
}
