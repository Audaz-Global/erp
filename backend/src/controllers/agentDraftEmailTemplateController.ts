import { Request, Response } from 'express';
import { prisma } from '../prisma';

const scope = (value: any) => String(value || 'ALL').trim().toUpperCase() || 'ALL';
const clean = (value: any) => String(value || '').trim();

export async function listAgentDraftEmailTemplates(_req: Request, res: Response) {
  try { res.json(await (prisma as any).agentDraftEmailTemplate.findMany({ orderBy: [{ incoterm: 'asc' }, { modal: 'asc' }, { name: 'asc' }] })); }
  catch { res.status(500).json({ error: 'Erro ao listar modelos de e-mail.' }); }
}

export async function createAgentDraftEmailTemplate(req: Request, res: Response) {
  try {
    if (!clean(req.body.name) || !clean(req.body.bodyTemplate)) return res.status(400).json({ error: 'Informe nome e corpo do modelo.' });
    const item = await (prisma as any).agentDraftEmailTemplate.create({ data: { name: clean(req.body.name), incoterm: scope(req.body.incoterm), modal: scope(req.body.modal), direction: scope(req.body.direction), equipment: scope(req.body.equipment), subjectTemplate: clean(req.body.subjectTemplate) || null, bodyTemplate: clean(req.body.bodyTemplate), active: req.body.active !== false } });
    res.status(201).json(item);
  } catch { res.status(500).json({ error: 'Erro ao criar modelo de e-mail.' }); }
}

export async function updateAgentDraftEmailTemplate(req: Request, res: Response) {
  try {
    const item = await (prisma as any).agentDraftEmailTemplate.update({ where: { id: req.params.id }, data: { name: clean(req.body.name), incoterm: scope(req.body.incoterm), modal: scope(req.body.modal), direction: scope(req.body.direction), equipment: scope(req.body.equipment), subjectTemplate: clean(req.body.subjectTemplate) || null, bodyTemplate: clean(req.body.bodyTemplate), active: req.body.active !== false } });
    res.json(item);
  } catch { res.status(500).json({ error: 'Erro ao atualizar modelo de e-mail.' }); }
}

export async function deleteAgentDraftEmailTemplate(req: Request, res: Response) {
  try { await (prisma as any).agentDraftEmailTemplate.delete({ where: { id: req.params.id } }); res.status(204).send(); }
  catch { res.status(500).json({ error: 'Erro ao excluir modelo de e-mail.' }); }
}
