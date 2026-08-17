import { PrismaClient } from '@prisma/client';

const parseTypes = (value: string | null, fallback: string) => {
  try { const parsed = JSON.parse(value || '[]'); if (Array.isArray(parsed) && parsed.length) return parsed.map(String); } catch {}
  return [fallback || 'AGENTE'];
};

export async function backfillPartnerLinks(prisma: PrismaClient) {
  let linked = 0;
  const agents = await prisma.agent.findMany();
  for (const agent of agents) {
    if (!agent.types) {
      await prisma.agent.update({ where: { id: agent.id }, data: { types: JSON.stringify([agent.type || 'AGENTE']) } });
      linked++;
    }
  }

  const refreshedAgents = await prisma.agent.findMany();
  const findAgent = (name: string) => refreshedAgents.find(agent => agent.name.trim().toLowerCase() === name.trim().toLowerCase());
  const profiles = await prisma.carrierProfile.findMany();
  for (const profile of profiles) {
    let agent = profile.partnerId ? refreshedAgents.find(item => item.id === profile.partnerId) : findAgent(profile.name);
    if (!agent) {
      agent = await prisma.agent.create({ data: { name: profile.name, type: 'ARMADOR', types: JSON.stringify(['ARMADOR']), code: profile.code, aliases: profile.aliases, equipmentScopes: profile.equipmentScopes, modals: 'SEA_FCL, SEA_LCL', origins: 'Global', destinations: 'Brasil', active: profile.active } });
      refreshedAgents.push(agent); linked++;
    } else {
      const types = parseTypes(agent.types, agent.type);
      if (!types.includes('ARMADOR')) {
        types.push('ARMADOR');
        await prisma.agent.update({ where: { id: agent.id }, data: { types: JSON.stringify(types), code: agent.code || profile.code, aliases: agent.aliases || profile.aliases, equipmentScopes: agent.equipmentScopes || profile.equipmentScopes } });
        agent.types = JSON.stringify(types);
        linked++;
      }
    }
    const conflictingProfile = await prisma.carrierProfile.findFirst({ where: { partnerId: agent.id, id: { not: profile.id } } });
    if (!conflictingProfile && profile.partnerId !== agent.id) { await prisma.carrierProfile.update({ where: { id: profile.id }, data: { partnerId: agent.id } }); linked++; }
  }

  const deconsolidators = await prisma.deconsolidator.findMany();
  for (const row of deconsolidators) {
    let agent = row.partnerId ? refreshedAgents.find(item => item.id === row.partnerId) : findAgent(row.name);
    if (!agent) {
      agent = await prisma.agent.create({ data: { name: row.name, type: 'DESCONSOLIDADOR', types: JSON.stringify(['DESCONSOLIDADOR']), modals: row.modal, origins: 'Brasil', destinations: 'Brasil', active: row.active } });
      refreshedAgents.push(agent); linked++;
    } else {
      const types = parseTypes(agent.types, agent.type);
      if (!types.includes('DESCONSOLIDADOR')) { types.push('DESCONSOLIDADOR'); await prisma.agent.update({ where: { id: agent.id }, data: { types: JSON.stringify(types) } }); agent.types = JSON.stringify(types); linked++; }
    }
    if (row.partnerId !== agent.id) { await prisma.deconsolidator.update({ where: { id: row.id }, data: { partnerId: agent.id } }); linked++; }
  }

  const fees = await prisma.fixedFee.findMany({ where: { partnerId: null, carrier: { not: null } } });
  for (const fee of fees) {
    let agent = fee.carrier ? findAgent(fee.carrier) : undefined;
    const carrierName = String(fee.carrier || '').trim();
    if (!agent && carrierName && !['GERAL', 'ALL', 'PADRAO', 'PADRÃO'].includes(carrierName.toUpperCase())) {
      const role = fee.modal === 'AIR' ? 'CIA_AEREA' : fee.modal.startsWith('SEA') ? 'ARMADOR' : 'AGENTE';
      agent = await prisma.agent.create({ data: { name: carrierName, type: role, types: JSON.stringify([role]), modals: fee.modal, origins: 'Global', destinations: 'Brasil', active: fee.active } });
      refreshedAgents.push(agent); linked++;
    }
    if (agent) { await prisma.fixedFee.update({ where: { id: fee.id }, data: { partnerId: agent.id } }); linked++; }
  }

  for (const agent of refreshedAgents) {
    const types = parseTypes(agent.types, agent.type);
    if (!types.includes('ARMADOR')) continue;
    const profile = await prisma.carrierProfile.findFirst({ where: { OR: [{ partnerId: agent.id }, { name: { equals: agent.name, mode: 'insensitive' } }] } });
    if (!profile) {
      await prisma.carrierProfile.create({ data: { partnerId: agent.id, name: agent.name, code: agent.code, aliases: agent.aliases || '[]', equipmentScopes: agent.equipmentScopes || '["20GP","40GP","40HC"]', modal: 'SEA', active: agent.active } });
      linked++;
    } else if (!profile.partnerId) {
      const conflict = await prisma.carrierProfile.findFirst({ where: { partnerId: agent.id, id: { not: profile.id } } });
      if (!conflict) { await prisma.carrierProfile.update({ where: { id: profile.id }, data: { partnerId: agent.id } }); linked++; }
    }
  }
  return linked;
}
