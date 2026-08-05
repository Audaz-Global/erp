import { prisma } from '../prisma';

export async function getDraftEmailFieldLabels(modal: string, direction: string): Promise<string[]> {
  const rows = await prisma.draftEmailFieldRule.findMany({
    where: { active: true, modal: { in: [modal, 'ALL'] }, direction: { in: [direction, 'ALL'] } },
    orderBy: { sortOrder: 'asc' }
  });
  return rows.map(r => r.fieldLabel);
}
