import { Request, Response } from 'express';
import { prisma } from '../prisma';
import { normalizeBillingUnit, normalizeFee } from '../services/feeCalculationService';

const jsonArray = (value: any): string[] => {
  if (Array.isArray(value)) return value.map(String);
  try { const parsed = JSON.parse(String(value || '[]')); return Array.isArray(parsed) ? parsed.map(String) : []; } catch { return String(value || '').split(',').map(item => item.trim()).filter(Boolean); }
};

async function carrierProfileFor(partner: any) {
  return prisma.carrierProfile.findFirst({
    where: { OR: [{ partnerId: partner.id }, { name: { equals: partner.name, mode: 'insensitive' } }] },
    include: { fieldRules: true }
  });
}

export async function getPartnerProfile(req: Request, res: Response) {
  try {
    const partner = await prisma.agent.findUnique({ where: { id: req.params.id } });
    if (!partner) return res.status(404).json({ error: 'Parceiro não encontrado.' });
    const carrierProfile = await carrierProfileFor(partner);
    if (carrierProfile && carrierProfile.partnerId !== partner.id) await prisma.carrierProfile.update({ where: { id: carrierProfile.id }, data: { partnerId: partner.id } });
    const [fixedFees, carrierRates, deconsolidationRates, partnerRules] = await Promise.all([
      prisma.fixedFee.findMany({ where: { OR: [{ partnerId: partner.id }, ...(carrierProfile ? [{ carrierProfileId: carrierProfile.id }] : []), { carrier: { equals: partner.name, mode: 'insensitive' } }] }, orderBy: { updatedAt: 'desc' } }),
      carrierProfile ? prisma.carrierRate.findMany({ where: { carrierProfileId: carrierProfile.id }, include: { chargeCatalog: true, evidences: true }, orderBy: { updatedAt: 'desc' } }) : [],
      prisma.deconsolidator.findMany({ where: { OR: [{ partnerId: partner.id }, { name: { equals: partner.name, mode: 'insensitive' } }] }, orderBy: { updatedAt: 'desc' } }),
      prisma.partnerRule.findMany({ where: { partnerId: partner.id }, orderBy: [{ priority: 'desc' }, { updatedAt: 'desc' }] })
    ]);
    res.json({ partner: { ...partner, types: jsonArray(partner.types), aliases: jsonArray(partner.aliases), equipmentScopes: jsonArray(partner.equipmentScopes) }, carrierProfile, fixedFees, carrierRates, deconsolidationRates, partnerRules, carrierFieldRules: carrierProfile?.fieldRules || [] });
  } catch (error) { console.error('Erro ao abrir ficha do parceiro:', error); res.status(500).json({ error: 'Erro ao abrir ficha do parceiro.' }); }
}

export async function updatePartnerOperational(req: Request, res: Response) {
  try {
    const partner = await prisma.agent.findUnique({ where: { id: req.params.id } });
    if (!partner) return res.status(404).json({ error: 'Parceiro não encontrado.' });
    const aliases = jsonArray(req.body.aliases);
    const equipmentScopes = jsonArray(req.body.equipmentScopes);
    const updated = await prisma.agent.update({ where: { id: partner.id }, data: { code: req.body.code || null, aliases: JSON.stringify(aliases), equipmentScopes: JSON.stringify(equipmentScopes) } });
    const types = jsonArray(updated.types || JSON.stringify([updated.type]));
    if (types.includes('ARMADOR')) {
      const existing = await carrierProfileFor(updated);
      if (existing) await prisma.carrierProfile.update({ where: { id: existing.id }, data: { partnerId: updated.id, name: updated.name, code: updated.code, aliases: updated.aliases, equipmentScopes: updated.equipmentScopes, active: updated.active } });
      else await prisma.carrierProfile.create({ data: { partnerId: updated.id, name: updated.name, code: updated.code, aliases: updated.aliases || '[]', equipmentScopes: updated.equipmentScopes || '["20GP","40GP","40HC"]', modal: 'SEA', active: updated.active } });
    }
    res.json(updated);
  } catch (error) { console.error(error); res.status(500).json({ error: 'Erro ao atualizar dados operacionais.' }); }
}

export async function createPartnerFee(req: Request, res: Response) {
  try {
    const partner = await prisma.agent.findUnique({ where: { id: req.params.id } });
    if (!partner) return res.status(404).json({ error: 'Parceiro não encontrado.' });
    const kind = String(req.body.kind || 'LOCAL').toUpperCase();
    if (kind === 'DESCONSOLIDATION') {
      const row = await prisma.deconsolidator.create({ data: { partnerId: partner.id, name: partner.name, location: req.body.location || null, modal: String(req.body.modal || 'AIR').toUpperCase(), value: Number(req.body.value), currency: req.body.currency || 'BRL', effectiveFrom: req.body.effectiveFrom ? new Date(req.body.effectiveFrom) : null, effectiveTo: req.body.effectiveTo ? new Date(req.body.effectiveTo) : null, evidence: req.body.evidence || null, active: req.body.active !== false } });
      return res.status(201).json(row);
    }
    const carrierProfile = await carrierProfileFor(partner);
    const normalized = normalizeFee({ name: req.body.name, value: req.body.value, currency: req.body.currency, billingUnit: req.body.billingUnit, chargedBy: partner.name, applicationScope: req.body.type });
    const fee = await prisma.fixedFee.create({ data: { partnerId: partner.id, carrier: partner.name, carrierProfileId: carrierProfile?.id || null, name: req.body.name, containerSize: req.body.containerSize || null, type: req.body.type || 'DESTINATION', value: Number(req.body.value), currency: req.body.currency || 'USD', billingUnit: normalizeBillingUnit(req.body.billingUnit, req.body.name), feeCategory: normalized.canonicalCategory, financialGroup: normalized.financialGroup, chargeNature: normalized.chargeNature, classificationSource: 'MANUAL', ispsClassification: normalized.ispsClassification, includedInFreight: normalized.includedInFreight, modal: req.body.modal || 'ALL', effectiveFrom: req.body.effectiveFrom ? new Date(req.body.effectiveFrom) : null, effectiveTo: req.body.effectiveTo ? new Date(req.body.effectiveTo) : null, evidence: req.body.evidence || null, active: req.body.active !== false } });
    res.status(201).json(fee);
  } catch (error) { console.error(error); res.status(500).json({ error: 'Erro ao cadastrar taxa do parceiro.' }); }
}

export async function createPartnerRule(req: Request, res: Response) {
  try {
    const partner = await prisma.agent.findUnique({ where: { id: req.params.id } });
    if (!partner) return res.status(404).json({ error: 'Parceiro não encontrado.' });
    const rule = await prisma.partnerRule.create({ data: { partnerId: partner.id, name: req.body.name, modal: req.body.modal || 'ALL', direction: req.body.direction || 'ALL', incoterm: req.body.incoterm || 'ALL', route: req.body.route || null, equipment: req.body.equipment || null, stage: req.body.stage || 'ALL', fieldKey: req.body.fieldKey || null, behavior: req.body.behavior || 'SUGGESTED', reason: req.body.reason || null, priority: Number(req.body.priority || 0), effectiveFrom: req.body.effectiveFrom ? new Date(req.body.effectiveFrom) : null, effectiveTo: req.body.effectiveTo ? new Date(req.body.effectiveTo) : null, active: req.body.active !== false } });
    res.status(201).json(rule);
  } catch (error) { console.error(error); res.status(500).json({ error: 'Erro ao cadastrar regra do parceiro.' }); }
}

export async function deletePartnerItem(req: Request, res: Response) {
  try {
    const source = String(req.params.source).toUpperCase();
    const id = req.params.itemId;
    if (source === 'FIXED_FEE') await prisma.fixedFee.delete({ where: { id } });
    else if (source === 'DECONSOLIDATION') await prisma.deconsolidator.delete({ where: { id } });
    else if (source === 'PARTNER_RULE') await prisma.partnerRule.delete({ where: { id } });
    else if (source === 'CARRIER_FIELD_RULE') await prisma.carrierFieldRule.delete({ where: { id } });
    else if (source === 'CARRIER_RATE') await prisma.carrierRate.update({ where: { id }, data: { active: false, status: 'REJECTED' } });
    else return res.status(400).json({ error: 'Tipo de registro inválido.' });
    res.status(204).send();
  } catch (error) { console.error(error); res.status(500).json({ error: 'Erro ao remover registro da ficha.' }); }
}

export async function updatePartnerItem(req: Request, res: Response) {
  try {
    const source = String(req.params.source).toUpperCase(), id = req.params.itemId;
    let result: any;
    if (source === 'FIXED_FEE') result = await prisma.fixedFee.update({ where: { id }, data: { name: req.body.name, modal: req.body.modal, type: req.body.type, containerSize: req.body.containerSize || null, value: req.body.value !== undefined ? Number(req.body.value) : undefined, currency: req.body.currency, billingUnit: req.body.billingUnit, effectiveFrom: req.body.effectiveFrom ? new Date(req.body.effectiveFrom) : null, effectiveTo: req.body.effectiveTo ? new Date(req.body.effectiveTo) : null, evidence: req.body.evidence || null } });
    else if (source === 'DECONSOLIDATION') result = await prisma.deconsolidator.update({ where: { id }, data: { location: req.body.location || null, modal: req.body.modal, value: req.body.value !== undefined ? Number(req.body.value) : undefined, currency: req.body.currency, effectiveFrom: req.body.effectiveFrom ? new Date(req.body.effectiveFrom) : null, effectiveTo: req.body.effectiveTo ? new Date(req.body.effectiveTo) : null, evidence: req.body.evidence || null } });
    else if (source === 'CARRIER_RATE') result = await prisma.carrierRate.update({ where: { id }, data: { portScope: req.body.portScope || 'ALL', equipment: req.body.equipment || 'ALL', amount: req.body.amount !== undefined ? Number(req.body.amount) : undefined, currency: req.body.currency, unitBasis: req.body.unitBasis, effectiveFrom: req.body.effectiveFrom ? new Date(req.body.effectiveFrom) : null, effectiveTo: req.body.effectiveTo ? new Date(req.body.effectiveTo) : null } });
    else if (source === 'PARTNER_RULE') result = await prisma.partnerRule.update({ where: { id }, data: { name: req.body.name, modal: req.body.modal, direction: req.body.direction, incoterm: req.body.incoterm, fieldKey: req.body.fieldKey, behavior: req.body.behavior, reason: req.body.reason || null, priority: Number(req.body.priority || 0) } });
    else return res.status(400).json({ error: 'Tipo de registro inválido.' });
    res.json(result);
  } catch (error) { console.error(error); res.status(500).json({ error: 'Erro ao atualizar registro da ficha.' }); }
}
