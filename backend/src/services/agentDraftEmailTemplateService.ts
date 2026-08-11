import { prisma } from '../prisma';

const equipmentFromLoadType = (loadType: string | null | undefined) => {
  const value = String(loadType || '').toUpperCase();
  if (value.includes('40HC')) return '40HC'; if (value.includes('40RH')) return '40RH'; if (value.includes('20RH')) return '20RH';
  if (value.includes('40OT')) return '40OT'; if (value.includes('20OT')) return '20OT'; if (value.includes('40')) return '40GP'; if (value.includes('20')) return '20GP'; return 'ALL';
};
const modalFromQuotation = (modal: string | null | undefined, loadType: string | null | undefined) => {
  const value = String(modal || '').toUpperCase();
  if (value === 'AIR') return 'AIR';
  return String(loadType || '').toUpperCase().includes('LCL') ? 'SEA_LCL' : 'SEA_FCL';
};

export async function findAgentDraftEmailTemplate(input: { incoterm?: string | null; modal?: string | null; direction?: string | null; loadType?: string | null }) {
  const incoterm = String(input.incoterm || 'ALL').toUpperCase(), modal = modalFromQuotation(input.modal, input.loadType), direction = String(input.direction || 'ALL').toUpperCase(), equipment = equipmentFromLoadType(input.loadType);
  const rows: any[] = await (prisma as any).agentDraftEmailTemplate.findMany({ where: { active: true, incoterm: { in: [incoterm, 'ALL'] }, modal: { in: [modal, 'ALL'] }, direction: { in: [direction, 'ALL'] }, equipment: { in: [equipment, 'ALL'] } } });
  return rows.sort((a: any, b: any) => score(b) - score(a))[0] || null;
  function score(row: any) { return (row.incoterm === incoterm ? 8 : 0) + (row.modal === modal ? 4 : 0) + (row.direction === direction ? 2 : 0) + (row.equipment === equipment ? 1 : 0); }
}
