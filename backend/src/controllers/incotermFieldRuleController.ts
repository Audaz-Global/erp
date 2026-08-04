import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const VALID_MODALS = new Set(['AIR', 'SEA_FCL', 'SEA_LCL', 'ALL']);
const VALID_STAGES = new Set(['REQUEST', 'RETURN', 'FINAL', 'ALL']);
const VALID_FIELDS = new Set(['INTERNATIONAL_FREIGHT', 'ORIGIN_INLAND', 'ORIGIN_FEES', 'INSURANCE', 'DESTINATION_FEES', 'NATIONAL_INLAND', 'CUSTOMS_CLEARANCE']);
const VALID_BEHAVIORS = new Set(['EDITABLE', 'REQUIRED', 'SUGGESTED', 'LOCKED', 'HIDDEN', 'NOT_APPLICABLE', 'RETURN_ONLY']);

function normalized(body: any) {
  return {
    incoterm: String(body.incoterm || '').toUpperCase(),
    modal: String(body.modal || 'ALL').toUpperCase(),
    stage: String(body.stage || 'ALL').toUpperCase(),
    fieldKey: String(body.fieldKey || '').toUpperCase(),
    behavior: String(body.behavior || 'EDITABLE').toUpperCase(),
    reason: body.reason ? String(body.reason).trim() : null,
    active: body.active !== false
  };
}

function validate(data: ReturnType<typeof normalized>) {
  if (!data.incoterm) return 'Informe o Incoterm.';
  if (!VALID_MODALS.has(data.modal)) return 'Modal inválido.';
  if (!VALID_STAGES.has(data.stage)) return 'Etapa inválida.';
  if (!VALID_FIELDS.has(data.fieldKey)) return 'Campo inválido.';
  if (!VALID_BEHAVIORS.has(data.behavior)) return 'Comportamento inválido.';
  return null;
}

export async function getIncotermFieldRules(req: Request, res: Response) {
  try {
    const where: any = {};
    if (req.query.incoterm) where.incoterm = String(req.query.incoterm).toUpperCase();
    if (req.query.modal) where.modal = { in: [String(req.query.modal).toUpperCase(), 'ALL'] };
    if (req.query.stage) where.stage = { in: [String(req.query.stage).toUpperCase(), 'ALL'] };
    const rules = await prisma.incotermFieldRule.findMany({ where, orderBy: [{ incoterm: 'asc' }, { fieldKey: 'asc' }] });
    res.json(rules);
  } catch (error) {
    console.error('Erro ao buscar travas de Incoterm:', error);
    res.status(500).json({ error: 'Erro ao buscar travas de Incoterm.' });
  }
}

export async function createIncotermFieldRule(req: Request, res: Response) {
  try {
    const data = normalized(req.body);
    const error = validate(data);
    if (error) return res.status(400).json({ error });
    const rule = await prisma.incotermFieldRule.create({ data });
    res.status(201).json(rule);
  } catch (error: any) {
    if (error?.code === 'P2002') return res.status(409).json({ error: 'Já existe uma trava para esta combinação.' });
    console.error('Erro ao criar trava de Incoterm:', error);
    res.status(500).json({ error: 'Erro ao criar trava de Incoterm.' });
  }
}

export async function updateIncotermFieldRule(req: Request, res: Response) {
  try {
    const data = normalized(req.body);
    const error = validate(data);
    if (error) return res.status(400).json({ error });
    const rule = await prisma.incotermFieldRule.update({ where: { id: req.params.id }, data });
    res.json(rule);
  } catch (error: any) {
    if (error?.code === 'P2002') return res.status(409).json({ error: 'Já existe uma trava para esta combinação.' });
    res.status(500).json({ error: 'Erro ao atualizar trava de Incoterm.' });
  }
}

export async function deleteIncotermFieldRule(req: Request, res: Response) {
  try {
    await prisma.incotermFieldRule.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch {
    res.status(500).json({ error: 'Erro ao excluir trava de Incoterm.' });
  }
}
