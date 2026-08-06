import { Request, Response } from 'express';
import { prisma } from '../prisma';

const FIELDS = new Set(['TRANSSHIPMENTS','VESSEL_VOYAGE','FREE_TIME','RATE_VALIDITY','CONTRACT_NUMBER']);
const BEHAVIORS = new Set(['EDITABLE','REQUIRED','SUGGESTED','LOCKED','HIDDEN','NOT_APPLICABLE','RETURN_ONLY']);
const STAGES = new Set(['REQUEST','RETURN','FINAL','ALL']);
const MODALS = new Set(['SEA_FCL','SEA_LCL','SEA','ALL']);
const aliases = (value: any) => Array.isArray(value) ? value : String(value || '').split(',').map(v => v.trim()).filter(Boolean);
const EQUIPMENT = new Set(['20GP','40GP','40HC','20RH','40RH','20OT','40OT']);
const equipmentScopes = (value: any) => {
  const values = Array.isArray(value) ? value : (() => { try { return JSON.parse(String(value || '[]')); } catch { return String(value || '').split(','); } })();
  return [...new Set((Array.isArray(values) ? values : []).map(v => String(v).trim().toUpperCase()).filter(v => EQUIPMENT.has(v)))];
};

export async function listCarrierProfiles(_req: Request, res: Response) {
  try { res.json(await prisma.carrierProfile.findMany({ include:{ fieldRules:true, fixedFees:true }, orderBy:{name:'asc'} })); }
  catch { res.status(500).json({error:'Erro ao buscar armadores.'}); }
}
export async function resolveCarrierProfile(req: Request, res: Response) {
  const name=String(req.query.name||'').trim().toUpperCase(); if(!name)return res.json(null);
  const profiles=await prisma.carrierProfile.findMany({where:{active:true},include:{fieldRules:true,fixedFees:true}});
  const found=profiles.find(p=>{const names=[p.name,p.code,...aliases(p.aliases)].filter(Boolean).map(v=>String(v).toUpperCase());return names.some(v=>v===name||name.includes(v)||v.includes(name));});
  if(!found)return res.json(null);
  const names=[found.name,found.code,...aliases(found.aliases)].filter(Boolean).map(String);
  const fixedFees=await prisma.fixedFee.findMany({where:{active:true,OR:[{carrierProfileId:found.id},...names.map(value=>({carrier:{contains:value,mode:'insensitive' as const}}))]}});
  res.json({...found,fixedFees});
}
export async function createCarrierProfile(req:Request,res:Response){try{const scopes=equipmentScopes(req.body.equipmentScopes);const p=await (prisma.carrierProfile as any).create({data:{name:String(req.body.name||'').trim(),code:req.body.code||null,aliases:JSON.stringify(aliases(req.body.aliases)),modal:req.body.modal||'SEA',equipmentScopes:JSON.stringify(scopes.length?scopes:['20GP','40GP','40HC']),active:req.body.active!==false}});res.status(201).json(p);}catch(e:any){res.status(e?.code==='P2002'?409:500).json({error:e?.code==='P2002'?'Armador já cadastrado.':'Erro ao criar armador.'});}}
export async function updateCarrierProfile(req:Request,res:Response){try{const scopes=equipmentScopes(req.body.equipmentScopes);const p=await (prisma.carrierProfile as any).update({where:{id:req.params.id},data:{name:req.body.name,code:req.body.code||null,aliases:JSON.stringify(aliases(req.body.aliases)),modal:req.body.modal,equipmentScopes:JSON.stringify(scopes.length?scopes:['20GP','40GP','40HC']),active:req.body.active}});res.json(p);}catch{res.status(500).json({error:'Erro ao atualizar armador.'});}}
export async function deleteCarrierProfile(req:Request,res:Response){try{await prisma.carrierProfile.delete({where:{id:req.params.id}});res.status(204).send();}catch{res.status(409).json({error:'Armador possui vínculos e não pode ser excluído.'});}}
export async function saveCarrierFieldRule(req:Request,res:Response){try{const d={carrierId:String(req.params.id),modal:String(req.body.modal||'ALL').toUpperCase(),stage:String(req.body.stage||'RETURN').toUpperCase(),fieldKey:String(req.body.fieldKey||'').toUpperCase(),behavior:String(req.body.behavior||'EDITABLE').toUpperCase(),reason:req.body.reason||null,active:req.body.active!==false};if(!FIELDS.has(d.fieldKey)||!BEHAVIORS.has(d.behavior)||!STAGES.has(d.stage)||!MODALS.has(d.modal))return res.status(400).json({error:'Regra inválida.'});const rule=req.body.id?await prisma.carrierFieldRule.update({where:{id:req.body.id},data:d}):await prisma.carrierFieldRule.create({data:d});res.json(rule);}catch(e:any){res.status(e?.code==='P2002'?409:500).json({error:e?.code==='P2002'?'Regra duplicada.':'Erro ao salvar regra.'});}}
export async function deleteCarrierFieldRule(req:Request,res:Response){try{await prisma.carrierFieldRule.delete({where:{id:req.params.ruleId}});res.status(204).send();}catch{res.status(500).json({error:'Erro ao excluir regra.'});}}
export async function seedMaersk(_req:Request,res:Response){const scopes=JSON.stringify(['20GP','40GP','40HC','20RH','40RH','20OT','40OT']);const profile=await (prisma.carrierProfile as any).upsert({where:{name:'Maersk'},update:{code:'MAEU',aliases:JSON.stringify(['MAERSK LINE','MSK','SEALAND']),equipmentScopes:scopes,active:true},create:{name:'Maersk',code:'MAEU',aliases:JSON.stringify(['MAERSK LINE','MSK','SEALAND']),modal:'SEA',equipmentScopes:scopes}});await prisma.fixedFee.updateMany({where:{OR:[{carrier:{contains:'MAERSK',mode:'insensitive'}},{carrier:{equals:'MSK',mode:'insensitive'}}]},data:{carrierProfileId:profile.id}});res.json(profile);}
