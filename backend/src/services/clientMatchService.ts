import { PrismaClient } from '@prisma/client';
import { cnpjMatchKey } from '../utils/cnpjUtils';

// Busca um cliente pelo CNPJ: primeiro por igualdade exata (caminho rápido,
// cobre a maioria dos casos), depois por chave normalizada (ignora
// pontuação e prefixo de país) para não duplicar cliente quando o mesmo
// CNPJ chega formatado de outro jeito em uma extração posterior.
export async function findClientByCnpjMatch(prisma: PrismaClient, clientCnpj?: string | null) {
  if (!clientCnpj) return null;

  const exact = await prisma.client.findFirst({ where: { cnpj: clientCnpj } });
  if (exact) return exact;

  const key = cnpjMatchKey(clientCnpj);
  if (!key) return null;

  const candidates = await prisma.client.findMany({ where: { cnpj: { not: null } } });
  return candidates.find(c => cnpjMatchKey(c.cnpj) === key) || null;
}
