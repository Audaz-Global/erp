import { Request, Response } from 'express';
import sharp from 'sharp';
import { prisma } from '../prisma';

// Mantém consistência com o max-width:450px usado no HTML da assinatura de e-mail
// (professionalSignatureService.ts) — o arquivo já nasce dentro do limite, sem depender
// do cliente de e-mail respeitar CSS em imagens inline (o Outlook, por exemplo,
// costuma ignorar max-width e mostrar a imagem no tamanho real do arquivo).
const MAX_SIGNATURE_WIDTH = 450;
const MAX_SIGNATURE_HEIGHT = 200;

async function resizeSignatureImage(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .resize({ width: MAX_SIGNATURE_WIDTH, height: MAX_SIGNATURE_HEIGHT, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
}

function professionalData(req: Request, requireSignature: boolean) {
  const name = String(req.body?.name || '').trim();
  const initials = String(req.body?.initials || '').trim().toUpperCase();
  const file = req.file;
  if (!name) throw new Error('Informe o nome do profissional.');
  if (!/^[A-Z]{2,4}$/.test(initials)) throw new Error('As iniciais devem ter de 2 a 4 letras.');
  if (requireSignature && !file) throw new Error('Envie a assinatura em formato JPEG.');
  if (file && !['image/jpeg', 'image/jpg'].includes(file.mimetype)) throw new Error('A assinatura deve estar em formato JPEG (.jpg ou .jpeg).');
  if (file && !(file.buffer[0] === 0xff && file.buffer[1] === 0xd8 && file.buffer[2] === 0xff)) {
    throw new Error('O arquivo enviado não é uma imagem JPEG válida.');
  }
  return {
    name, initials, email: String(req.body?.email || '').trim() || null,
    jobTitle: String(req.body?.jobTitle || '').trim() || null,
    phone: String(req.body?.phone || '').trim() || null,
    active: String(req.body?.active ?? 'true') !== 'false', file
  };
}

const publicSelect = {
  id:true, name:true, initials:true, email:true, jobTitle:true, phone:true, active:true,
  signatureMimeType:true, signatureFileName:true, signatureVersion:true, createdAt:true, updatedAt:true
};

export const listProfessionals = async (_req: Request, res: Response) => {
  try {
    const rows = await prisma.professionalProfile.findMany({ orderBy: [{ active:'desc' }, { name:'asc' }], select: publicSelect });
    res.json(rows.map(row => ({ ...row, hasSignature: Boolean(row.signatureMimeType) })));
  } catch (error: any) { res.status(500).json({ error: error.message || 'Erro ao listar profissionais.' }); }
};

export const createProfessional = async (req: Request, res: Response) => {
  try {
    const data = professionalData(req, true);
    const signatureImage = await resizeSignatureImage(data.file!.buffer);
    const row = await prisma.professionalProfile.create({ data: {
      name:data.name, initials:data.initials, email:data.email, jobTitle:data.jobTitle, phone:data.phone, active:data.active,
      signatureImage, signatureMimeType:'image/jpeg', signatureFileName:data.file!.originalname, signatureVersion:1
    }, select: publicSelect });
    res.status(201).json({ ...row, hasSignature:true });
  } catch (error: any) { res.status(400).json({ error: error.message || 'Erro ao cadastrar profissional.' }); }
};

export const updateProfessional = async (req: Request, res: Response) => {
  try {
    const current = await prisma.professionalProfile.findUnique({ where: { id:String(req.params.id) } });
    if (!current) return res.status(404).json({ error:'Profissional não encontrado.' });
    const data = professionalData(req, false);
    const signatureImage = data.file ? await resizeSignatureImage(data.file.buffer) : null;
    const row = await prisma.professionalProfile.update({ where: { id:current.id }, data: {
      name:data.name, initials:data.initials, email:data.email, jobTitle:data.jobTitle, phone:data.phone, active:data.active,
      ...(signatureImage ? { signatureImage, signatureMimeType:'image/jpeg', signatureFileName:data.file!.originalname, signatureVersion:{ increment:1 } } : {})
    }, select: publicSelect });
    res.json({ ...row, hasSignature:Boolean(row.signatureMimeType) });
  } catch (error: any) { res.status(400).json({ error: error.message || 'Erro ao atualizar profissional.' }); }
};

export const getProfessionalSignature = async (req: Request, res: Response) => {
  const row = await prisma.professionalProfile.findUnique({ where:{ id:String(req.params.id) }, select:{ signatureImage:true, signatureMimeType:true, signatureVersion:true } });
  if (!row?.signatureImage) return res.status(404).json({ error:'Assinatura não cadastrada.' });
  res.setHeader('Content-Type', row.signatureMimeType || 'image/jpeg');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('ETag', `"signature-${req.params.id}-${row.signatureVersion}"`);
  res.send(Buffer.from(row.signatureImage));
};

export const deactivateProfessional = async (req: Request, res: Response) => {
  try {
    await prisma.professionalProfile.update({ where:{ id:String(req.params.id) }, data:{ active:false } });
    res.status(204).send();
  } catch { res.status(404).json({ error:'Profissional não encontrado.' }); }
};
