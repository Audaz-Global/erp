import { Router } from 'express';
import { authenticate } from '../middlewares/auth';
import { 
  createQuotation, 
  getQuotations, 
  getQuotationById, 
  updateQuotation, 
  deleteQuotation,
  generateQuotationPdf,
  updatePhase,
  getPublicWebView
} from '../controllers/quotationController';

const router = Router();

// Rota pública para visualização web da cotação
router.get('/:id/view', getPublicWebView);

// Protect all other quotation routes
router.use(authenticate);

router.post('/', createQuotation);
router.get('/', getQuotations);
router.get('/:id', getQuotationById);
router.get('/:id/pdf', generateQuotationPdf);
router.put('/:id', updateQuotation);
router.put('/:id/phase', updatePhase);
router.delete('/:id', deleteQuotation);

export default router;
