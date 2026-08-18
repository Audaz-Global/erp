import { NextFunction, Request, Response, Router } from 'express';
import multer from 'multer';
import { authenticate } from '../middlewares/auth';
import { createProfessional, deactivateProfessional, getProfessionalSignature, listProfessionals, updateProfessional } from '../controllers/professionalController';

const router = Router();
const signatureUpload = multer({ storage:multer.memoryStorage(), limits:{ fileSize:1024*1024, files:1 } });
router.use(authenticate);
router.get('/', listProfessionals);
router.post('/', signatureUpload.single('signature'), createProfessional);
router.put('/:id', signatureUpload.single('signature'), updateProfessional);
router.get('/:id/signature', getProfessionalSignature);
router.delete('/:id', deactivateProfessional);
router.use((error: any, _req: Request, res: Response, next: NextFunction) => {
  if (error?.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error:'A assinatura JPEG deve ter no máximo 1 MB.' });
  if (error?.code === 'LIMIT_FILE_COUNT' || error?.code === 'LIMIT_UNEXPECTED_FILE') return res.status(400).json({ error:'Envie somente uma assinatura JPEG.' });
  next(error);
});
export default router;
