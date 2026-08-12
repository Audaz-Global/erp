import { IncotermRule, Prisma, PrismaClient } from '@prisma/client';

type RuleOrderScope = Pick<IncotermRule, 'id' | 'incoterm' | 'modal' | 'direction' | 'feeType' | 'feeName' | 'sortOrder'> & {
  createdAt?: Date | string;
};
type PrismaLike = PrismaClient | Prisma.TransactionClient;

export class IncotermRuleOrderConflictError extends Error {
  constructor(public readonly conflictingFeeName: string, public readonly sortOrder: number) {
    super(`A ordem ${sortOrder} já está sendo usada pela taxa ${conflictingFeeName} neste contexto.`);
  }
}

export function parseIncotermRuleSortOrder(value: unknown): number | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || value.trim() === '')) return null;
  const order = typeof value === 'number' ? value : Number(value.trim());
  return Number.isInteger(order) && order >= 1 ? order : null;
}

function dimensionOverlaps(left: string, right: string): boolean {
  return left === 'ALL' || right === 'ALL' || left === right;
}

export function incotermRuleScopesOverlap(left: RuleOrderScope, right: RuleOrderScope): boolean {
  return left.feeType === right.feeType &&
    dimensionOverlaps(left.incoterm, right.incoterm) &&
    dimensionOverlaps(left.modal, right.modal) &&
    dimensionOverlaps(left.direction, right.direction);
}

export async function lockIncotermRuleOrdering(prisma: PrismaLike): Promise<void> {
  // Retorna apenas um inteiro, pois o Prisma não desserializa o tipo void
  // produzido quando pg_advisory_xact_lock é selecionado diretamente.
  await prisma.$queryRawUnsafe('SELECT 1::int AS acquired FROM pg_advisory_xact_lock(74201931)');
}

export async function findIncotermRuleOrderConflict(
  prisma: PrismaLike,
  scope: Omit<RuleOrderScope, 'feeName'>
): Promise<RuleOrderScope | null> {
  const candidates = await prisma.incotermRule.findMany({
    where: {
      feeType: scope.feeType,
      sortOrder: scope.sortOrder,
      ...(scope.id ? { id: { not: scope.id } } : {})
    },
    select: {
      id: true,
      incoterm: true,
      modal: true,
      direction: true,
      feeType: true,
      feeName: true,
      sortOrder: true
    }
  });

  return candidates.find(candidate => incotermRuleScopesOverlap(scope as RuleOrderScope, candidate)) || null;
}

export function normalizeIncotermRuleOrderAssignments(rules: RuleOrderScope[]): Array<{ id: string; sortOrder: number }> {
  const ordered = [...rules].sort((left, right) => {
    const leftValid = parseIncotermRuleSortOrder(left.sortOrder) ?? Number.MAX_SAFE_INTEGER;
    const rightValid = parseIncotermRuleSortOrder(right.sortOrder) ?? Number.MAX_SAFE_INTEGER;
    return leftValid - rightValid || left.incoterm.localeCompare(right.incoterm) ||
      left.modal.localeCompare(right.modal) || left.direction.localeCompare(right.direction) ||
      left.feeType.localeCompare(right.feeType) ||
      String(left.createdAt || '').localeCompare(String(right.createdAt || '')) || left.id.localeCompare(right.id);
  });
  const assigned: RuleOrderScope[] = [];
  const changes: Array<{ id: string; sortOrder: number }> = [];

  for (const rule of ordered) {
    const desired = parseIncotermRuleSortOrder(rule.sortOrder);
    const usedOrders = new Set(
      assigned.filter(candidate => incotermRuleScopesOverlap(rule, candidate)).map(candidate => candidate.sortOrder)
    );
    let nextOrder = desired && !usedOrders.has(desired) ? desired : 1;
    while (usedOrders.has(nextOrder)) nextOrder++;
    const normalized = { ...rule, sortOrder: nextOrder };
    assigned.push(normalized);
    if (nextOrder !== rule.sortOrder) changes.push({ id: rule.id, sortOrder: nextOrder });
  }

  return changes;
}

export async function normalizeIncotermRuleSortOrders(prisma: PrismaClient): Promise<number> {
  return prisma.$transaction(async tx => {
    await lockIncotermRuleOrdering(tx);
    const rules = await tx.incotermRule.findMany({
      select: {
        id: true,
        incoterm: true,
        modal: true,
        direction: true,
        feeType: true,
        feeName: true,
        sortOrder: true,
        createdAt: true
      }
    });
    const changes = normalizeIncotermRuleOrderAssignments(rules);
    for (const change of changes) {
      await tx.incotermRule.update({ where: { id: change.id }, data: { sortOrder: change.sortOrder } });
    }
    return changes.length;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10000, timeout: 30000 });
}
