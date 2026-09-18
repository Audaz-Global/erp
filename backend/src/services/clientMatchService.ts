import { PrismaClient } from '@prisma/client';
import { cnpjMatchKey } from '../utils/cnpjUtils';
import { companyNamesLikelyMatch, companyNamesOverlap } from '../utils/companyNameUtils';

// Busca um cliente pelo CNPJ: primeiro por igualdade exata (caminho rápido,
// cobre a maioria dos casos), depois por chave normalizada (ignora
// pontuação e prefixo de país) para não duplicar cliente quando o mesmo
// CNPJ chega formatado de outro jeito em uma extração posterior.
export async function findClientByCnpjMatch(prisma: PrismaClient, clientCnpj?: string | null) {
  if (!clientCnpj) return null;

  try {
    const exact = await prisma.client.findFirst({ where: { cnpj: clientCnpj } });
    if (exact) return exact;

    const key = cnpjMatchKey(clientCnpj);
    if (!key) return null;

    const candidates = await prisma.client.findMany({ where: { cnpj: { not: null } } });
    return candidates.find(c => cnpjMatchKey(c.cnpj) === key) || null;
  } catch (error) {
    console.warn('DB offline ou inacessível em findClientByCnpjMatch:', (error as any)?.message || error);
    return null;
  }
}

// Busca um cliente pelo nome: primeiro por igualdade exata, depois por
// correspondência tolerante a abreviação (ex: "CONEX." vs "CONEXOES") —
// usada quando o CNPJ não veio nesta extração/cadastro específico.
export async function findClientByNameMatch(prisma: PrismaClient, clientName?: string | null) {
  if (!clientName) return null;

  try {
    const exact = await prisma.client.findFirst({ where: { name: clientName } });
    if (exact) return exact;

    const candidates = await prisma.client.findMany();
    return candidates.find(c => companyNamesLikelyMatch(c.name, clientName)) || null;
  } catch (error) {
    console.warn('DB offline ou inacessível em findClientByNameMatch:', (error as any)?.message || error);
    return null;
  }
}

// Busca clientes parecidos pra AVISAR o operador antes de criar um cadastro
// novo (tela de Clientes) — mais permissiva que findClientByCnpjMatch/
// findClientByNameMatch de propósito: usa também a raiz do CNPJ (8 primeiros
// dígitos, compartilhada entre matriz e filiais do mesmo grupo) e overlap de
// palavras do nome, então pode incluir clientes que na verdade são empresas
// distintas (ex: filial com CNPJ diferente) — cabe ao operador decidir.
export async function findSimilarClients(
  prisma: PrismaClient,
  params: { name?: string | null; cnpj?: string | null; excludeId?: string | null }
): Promise<Array<{ id: string; name: string; cnpj: string | null; contactName: string | null; quotationsCount: number; matchReason: string }>> {
  const { name, cnpj, excludeId } = params;
  if (!name && !cnpj) return [];

  try {
    const candidates = await prisma.client.findMany({
      where: excludeId ? { id: { not: excludeId } } : undefined,
      include: { _count: { select: { quotations: true } } }
    });

    const cnpjKey = cnpjMatchKey(cnpj);
    const cnpjRoot = cnpjKey && cnpjKey.length >= 8 ? cnpjKey.slice(0, 8) : null;

    const results: Array<{ id: string; name: string; cnpj: string | null; contactName: string | null; quotationsCount: number; matchReason: string }> = [];
    for (const c of candidates) {
      let matchReason: string | null = null;
      const candidateKey = cnpjMatchKey(c.cnpj);
      if (cnpjKey && candidateKey === cnpjKey) {
        matchReason = 'Mesmo CNPJ';
      } else if (cnpjRoot && candidateKey && candidateKey.slice(0, 8) === cnpjRoot) {
        matchReason = 'Mesmo grupo (raiz do CNPJ) — possível matriz/filial';
      } else if (name && companyNamesLikelyMatch(c.name, name)) {
        matchReason = 'Nome muito parecido';
      } else if (name && companyNamesOverlap(c.name, name)) {
        matchReason = 'Nome parcialmente parecido';
      }
      if (matchReason) {
        results.push({ id: c.id, name: c.name, cnpj: c.cnpj, contactName: c.contactName, quotationsCount: c._count.quotations, matchReason });
      }
    }
    return results;
  } catch (error) {
    console.warn('DB offline ou inacessível em findSimilarClients:', (error as any)?.message || error);
    return [];
  }
}
