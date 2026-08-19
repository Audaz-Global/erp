import { Request, Response } from 'express';
import { prisma } from '../prisma';
import { GROUND_SERVICE_TYPES } from '../services/groundServiceService';
import { normalizeCurrency } from '../services/feeCalculationService';

function serviceType(value: unknown) {
  const type = String(value || '').toUpperCase();
  if (!GROUND_SERVICE_TYPES.includes(type as any)) throw new Error('Tipo deve ser DTA ou RODOVIARIO_NACIONAL.');
  return type;
}
function tariffData(body: any) {
  const name = String(body?.name || '').trim();
  if (!name) throw new Error('Informe o nome da tarifa.');
  const baseValue = Number(body?.baseValue);
  if (!Number.isFinite(baseValue) || baseValue < 0) throw new Error('Informe um valor base válido.');
  const optionalNumber = (value: any) => value === '' || value == null ? null : Number(value);
  return {
    serviceType:serviceType(body?.serviceType), name, partnerId:String(body?.partnerId || '').trim() || null,
    originLocation:String(body?.originLocation || '').trim() || null, destinationLocation:String(body?.destinationLocation || '').trim() || null,
    vehicleType:String(body?.vehicleType || '').trim() || null, weightFromKg:optionalNumber(body?.weightFromKg),
    weightToKg:optionalNumber(body?.weightToKg), baseValue, minimumValue:optionalNumber(body?.minimumValue),
    currency:normalizeCurrency(body?.currency || 'BRL'), taxesIncluded:body?.taxesIncluded == null ? null : Boolean(body.taxesIncluded),
    pricingRules:String(body?.pricingRules || '').trim() || null, operationalRules:String(body?.operationalRules || '').trim() || null,
    active:body?.active !== false
  };
}

export async function listGroundTariffs(req: Request, res: Response) {
  try {
    const type = req.query.serviceType ? serviceType(req.query.serviceType) : undefined;
    res.json(await prisma.groundServiceTariff.findMany({ where:type ? { serviceType:type } : {}, orderBy:[{ active:'desc' }, { name:'asc' }] }));
  } catch (error: any) { res.status(400).json({ error:error.message }); }
}
export async function createGroundTariff(req: Request, res: Response) {
  try { res.status(201).json(await prisma.groundServiceTariff.create({ data:tariffData(req.body) })); }
  catch (error: any) { res.status(400).json({ error:error.message }); }
}
export async function updateGroundTariff(req: Request, res: Response) {
  try { res.json(await prisma.groundServiceTariff.update({ where:{ id:String(req.params.id) }, data:tariffData(req.body) })); }
  catch (error: any) { res.status(400).json({ error:error.message }); }
}
export async function deactivateGroundTariff(req: Request, res: Response) {
  try { await prisma.groundServiceTariff.update({ where:{ id:String(req.params.id) }, data:{ active:false } }); res.status(204).send(); }
  catch { res.status(404).json({ error:'Tarifa não encontrada.' }); }
}

export async function updateGroundServiceLeg(req: Request, res: Response) {
  try {
    const value = req.body?.value === '' || req.body?.value == null ? null : Number(req.body.value);
    if (value != null && (!Number.isFinite(value) || value < 0)) throw new Error('Informe um valor válido.');
    const row = await prisma.groundServiceLeg.update({ where:{ id:String(req.params.id) }, data:{
      value, currency:normalizeCurrency(req.body?.currency || 'BRL'), taxesIncluded:req.body?.taxesIncluded == null ? null : Boolean(req.body.taxesIncluded),
      transitTime:String(req.body?.transitTime || '').trim() || null, pricingSource:String(req.body?.pricingSource || 'MANUAL').trim(),
      additionalCharges:typeof req.body?.additionalCharges === 'string' ? req.body.additionalCharges : JSON.stringify(req.body?.additionalCharges || []),
      operationalNotes:String(req.body?.operationalNotes || '').trim() || null, responseRaw:String(req.body?.responseRaw || '').trim() || null
    } });
    res.json(row);
  } catch (error: any) { res.status(400).json({ error:error.message }); }
}

export async function suggestGroundTariff(req: Request, res: Response) {
  try {
    const type = serviceType(req.query.serviceType);
    const origin = String(req.query.origin || '').toLowerCase();
    const destination = String(req.query.destination || '').toLowerCase();
    const vehicle = String(req.query.vehicleType || '').toLowerCase();
    const weight = Number(req.query.weightKg || 0);
    const rows = await prisma.groundServiceTariff.findMany({ where:{ serviceType:type, active:true } });
    const ranked = rows.map(row => {
      if (weight && ((row.weightFromKg != null && weight < row.weightFromKg) || (row.weightToKg != null && weight > row.weightToKg))) return { row, score:-1 };
      let score = 0;
      if (row.originLocation && origin.includes(row.originLocation.toLowerCase())) score += 3;
      if (row.destinationLocation && destination.includes(row.destinationLocation.toLowerCase())) score += 3;
      if (row.vehicleType && vehicle && vehicle.includes(row.vehicleType.toLowerCase())) score += 2;
      if (!row.originLocation && !row.destinationLocation) score += 1;
      return { row, score };
    }).filter(item => item.score >= 0).sort((a,b) => b.score - a.score);
    const best = ranked[0]?.row;
    if (!best) return res.json({ match:null, reason:'Nenhuma tarifa ativa compatível com o trecho e o peso.' });
    res.json({ match:{ ...best, calculatedValue:Math.max(best.baseValue, best.minimumValue || 0), financialGroup:type === 'DTA' ? 'FREIGHT_COMPONENT' : 'DESTINATION_CHARGE' }, reason:type === 'DTA' ? 'Componente do frete antes da nacionalização.' : 'Custo de destino após a nacionalização.' });
  } catch (error: any) { res.status(400).json({ error:error.message }); }
}
