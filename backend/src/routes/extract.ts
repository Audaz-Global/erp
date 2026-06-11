import { Router } from 'express';
import multer from 'multer';
import { extractData, generateDraft } from '../controllers/extractController';
import { authenticate } from '../middlewares/auth';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// Endpoint protegido para receber os arquivos/textos e extrair via IA
// A rota espera um form-data com um campo opcional 'text' e um campo de arquivos 'files' (multiplos)
router.post('/', authenticate, upload.array('files'), extractData);

// Rota para gerar rascunho de e-mail para o agente
router.post('/draft/:id', authenticate, generateDraft);

export default router;
