import { Request, Response } from 'express';
import { Prisma, PrismaClient } from '@prisma/client';
import { standardFeeSnapshot } from '../services/standardFeeLinkService';
import {
  incotermRuleScopesOverlap,
  lockIncotermRuleOrdering,
  parseIncotermRuleSortOrder
} from '../services/incotermRuleOrderService';

const prisma = new PrismaClient();
const VALID_MODAL_SCOPES = new Set(['ALL', 'AIR', 'SEA_FCL', 'SEA_LCL']);
const VALID_DIRECTIONS = new Set(['ALL', 'IMPORT', 'EXPORT']);
const VALID_INCOTERMS = new Set(['ALL', 'EXW', 'FCA', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP']);

type ApplicationInput = {
  id?: string;
  incoterm?: unknown;
  modal?: unknown;
  direction?: unknown;
  required?: unknown;
  sortOrder?: unknown;
  active?: unknown;
};

function normalizeModalScope(value: unknown) {
  const parts = String(value || 'ALL').toUpperCase().split(',').map(v => v.trim()).filter(Boolean);
  const unique = [...new Set(parts.length ? parts : ['ALL'])];
  if (unique.includes('ALL')) return 'ALL';
  if (!unique.every(scope => VALID_MODAL_SCOPES.has(scope))) throw new Error('Modal de compatibilidade inválido.');
  return unique.join(',');
}

function feeDataFromBody(body: any, current?: any) {
  const chargeType = body.chargeType || current?.chargeType || 'FIXED';
  const pricingStatus = body.pricingStatus === 'ON_REQUEST' ? 'ON_REQUEST' : 'PRICED';
  if (!String(body.name ?? current?.name ?? '').trim()) throw new Error('Informe o nome da taxa.');
  if (pricingStatus === 'PRICED' && (body.value === undefined || body.value === null || body.value === '')) {
    throw new Error('Informe o valor ou selecione “A cotar”.');
  }
  return {
    name: String(body.name ?? current?.name).trim(),
    type: body.type || current?.type || 'ORIGIN',
    chargeType,
    value: pricingStatus === 'ON_REQUEST' ? 0 : Number(body.value),
    pricingStatus,
    minValue: body.minValue !== undefined && body.minValue !== null && body.minValue !== '' ? Number(body.minValue) : null,
    currency: body.currency || current?.currency || 'USD',
    percentBase: chargeType === 'PERCENTAGE' ? (body.percentBase || current?.percentBase || 'FREIGHT') : null,
    description: body.description || null,
    modalScope: normalizeModalScope(body.modalScope ?? current?.modalScope),
    active: body.active !== undefined ? Boolean(body.active) : (current?.active ?? true)
  };
}

export function normalizeApplications(value: unknown) {
  if (!Array.isArray(value)) throw new Error('A lista de aplicações é inválida.');
  return (value as ApplicationInput[]).map((application, index) => {
    const incoterm = String(application.incoterm || '').toUpperCase();
    const modal = String(application.modal || '').toUpperCase();
    const direction = String(application.direction || 'ALL').toUpperCase();
    const sortOrder = parseIncotermRuleSortOrder(application.sortOrder);
    if (!VALID_INCOTERMS.has(incoterm)) throw new Error(`Incoterm inválido na aplicação ${index + 1}.`);
    if (!VALID_MODAL_SCOPES.has(modal)) throw new Error(`Modal inválido na aplicação ${index + 1}.`);
    if (!VALID_DIRECTIONS.has(direction)) throw new Error(`Direção inválida na aplicação ${index + 1}.`);
    if (sortOrder === null) throw new Error(`A ordem da aplicação ${index + 1} deve ser um inteiro maior ou igual a 1.`);
    return { incoterm, modal, direction, required: Boolean(application.required), sortOrder, active: application.active !== false };
  });
}

export function applicationsConflict(left: any, right: any, feeType: string) {
  return left.sortOrder === right.sortOrder && incotermRuleScopesOverlap(
    { ...left, id: '', feeType, feeName: '', sortOrder: left.sortOrder },
    { ...right, id: '', feeType, feeName: '', sortOrder: right.sortOrder }
  );
}

export const getAllStandardFees = async (req: Request, res: Response) => {
  try {
    const fees = await prisma.standardFee.findMany({
      include: {
        incotermRules: { orderBy: [{ incoterm: 'asc' }, { modal: 'asc' }, { direction: 'asc' }, { sortOrder: 'asc' }] },
        _count: { select: { incotermRules: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json(fees);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar taxas locais padrão.' });
  }
};

export const saveStandardFeeWithApplications = async (req: Request, res: Response) => {
  try {
    const id = req.params.id ? String(req.params.id) : '';
    const applications = normalizeApplications(req.body.applications || []);
    const saved = await prisma.$transaction(async tx => {
      await lockIncotermRuleOrdering(tx);
      const current = id ? await tx.standardFee.findUnique({ where: { id } }) : null;
      if (id && !current) throw new Error('Taxa local não encontrada.');
      const feeData = feeDataFromBody(req.body, current);
      const compatibleModals = String(feeData.modalScope || 'ALL').split(',');

      for (let index = 0; index < applications.length; index++) {
        const application = applications[index]!;
        if (!compatibleModals.includes('ALL') && (application.modal === 'ALL' || !compatibleModals.includes(application.modal))) {
          throw new Error(`O modal ${application.modal} da aplicação ${index + 1} não está entre os modais compatíveis da taxa.`);
        }
        const duplicateContext = applications.findIndex((candidate, candidateIndex) => candidateIndex !== index &&
          candidate.incoterm === application.incoterm && candidate.modal === application.modal &&
          candidate.direction === application.direction);
        if (duplicateContext >= 0) throw new Error(`A aplicação ${index + 1} repete o mesmo Incoterm, modal e direção.`);
        const orderConflict = applications.findIndex((candidate, candidateIndex) => candidateIndex < index && applicationsConflict(application, candidate, feeData.type));
        if (orderConflict >= 0) throw new Error(`A ordem ${application.sortOrder} está repetida entre aplicações sobrepostas desta taxa.`);
      }

      const externalRules = await tx.incotermRule.findMany({
        where: { feeType: feeData.type, ...(id ? { standardFeeId: { not: id } } : {}) },
        select: { id: true, incoterm: true, modal: true, direction: true, feeType: true, feeName: true, sortOrder: true }
      });
      for (const application of applications) {
        const conflict = externalRules.find(rule => rule.sortOrder === application.sortOrder && incotermRuleScopesOverlap(
          { ...application, id: '', feeType: feeData.type, feeName: feeData.name }, rule
        ));
        if (conflict) throw new Error(`A ordem ${application.sortOrder} já está sendo usada pela taxa ${conflict.feeName} em um contexto sobreposto.`);
      }

      const fee = id
        ? await tx.standardFee.update({ where: { id }, data: feeData as any })
        : await tx.standardFee.create({ data: feeData as any });
      await tx.incotermRule.deleteMany({ where: { standardFeeId: fee.id } });
      const snapshot = standardFeeSnapshot(fee);
      for (const application of applications) {
        await tx.incotermRule.create({
          data: { ...application, standardFeeId: fee.id, ...snapshot } as any
        });
      }
      return tx.standardFee.findUnique({
        where: { id: fee.id },
        include: { incotermRules: { orderBy: { sortOrder: 'asc' } }, _count: { select: { incotermRules: true } } }
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10000, timeout: 15000 });
    res.status(id ? 200 : 201).json(saved);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro ao salvar taxa e aplicações.';
    const status = /não encontrada/i.test(message) ? 404 : /ordem|aplicação|Incoterm|Modal|Direção|Informe/i.test(message) ? 409 : 500;
    if (status === 500) console.error('Erro ao salvar taxa com aplicações:', error);
    res.status(status).json({ error: message });
  }
};

export const createStandardFee = async (req: Request, res: Response) => {
  try {
    const { name, type, chargeType, value, pricingStatus, minValue, currency, percentBase, description, modalScope, active } = req.body;
    const effectivePricingStatus = pricingStatus === 'ON_REQUEST' ? 'ON_REQUEST' : 'PRICED';
    if (effectivePricingStatus === 'PRICED' && (value === undefined || value === null || value === '')) return res.status(400).json({ error: 'Informe o valor ou selecione “A cotar”.' });
    const fee = await prisma.standardFee.create({
      data: {
        name,
        type,
        chargeType,
        value: effectivePricingStatus === 'ON_REQUEST' ? 0 : Number(value),
        pricingStatus: effectivePricingStatus,
        minValue: minValue !== undefined && minValue !== null && minValue !== '' ? Number(minValue) : null,
        currency: currency || 'USD',
        percentBase: chargeType === 'PERCENTAGE' ? (percentBase || 'FREIGHT') : null,
        description: description || null,
        modalScope: normalizeModalScope(modalScope),
        active: active !== undefined ? active : true
      } as any
    });
    res.status(201).json(fee);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao criar taxa local padrão.' });
  }
};

export const updateStandardFee = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, type, chargeType, value, pricingStatus, minValue, currency, percentBase, description, modalScope, active } = req.body;
    const current = await prisma.standardFee.findUnique({ where: { id } });
    if (!current) return res.status(404).json({ error: 'Taxa local não encontrada.' });
    const effectiveChargeType = chargeType || current.chargeType;
    const effectivePricingStatus = pricingStatus === 'ON_REQUEST' ? 'ON_REQUEST' : (pricingStatus === 'PRICED' ? 'PRICED' : (current as any).pricingStatus || 'PRICED');
    if (effectivePricingStatus === 'PRICED' && value !== undefined && (value === null || value === '')) return res.status(400).json({ error: 'Informe o valor ou selecione “A cotar”.' });

    const fee = await prisma.standardFee.update({
      where: { id },
      data: {
        name,
        type,
        chargeType,
        value: effectivePricingStatus === 'ON_REQUEST' ? 0 : (value !== undefined ? Number(value) : undefined),
        pricingStatus: effectivePricingStatus,
        minValue: minValue !== undefined ? (minValue !== null && minValue !== '' ? Number(minValue) : null) : undefined,
        currency,
        percentBase: percentBase !== undefined || chargeType !== undefined
          ? (effectiveChargeType === 'PERCENTAGE' ? (percentBase || current.percentBase || 'FREIGHT') : null)
          : undefined,
        description: description !== undefined ? (description || null) : undefined,
        modalScope: modalScope !== undefined ? normalizeModalScope(modalScope) : undefined,
        active
      } as any
    });
    res.json(fee);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar taxa local padrão.' });
  }
};

export const deleteStandardFee = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id || '');
    await prisma.$transaction(async tx => {
      await lockIncotermRuleOrdering(tx);
      await tx.incotermRule.deleteMany({ where: { standardFeeId: id } });
      await tx.standardFee.delete({ where: { id } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10000, timeout: 10000 });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao deletar taxa local padrão.' });
  }
};
