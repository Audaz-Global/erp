import { Router } from 'express';
import { authenticate } from '../middlewares/auth';
import multer from 'multer';
import { uploadQuotationDocuments, listQuotationDocuments, downloadQuotationDocument, updateQuotationDocument, deleteQuotationDocument, listQuotationDispatches } from '../controllers/quotationDocumentController';
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
const documentUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 25 } });

// Rota pública para visualização web da cotação
router.get('/:id/view', getPublicWebView);

// Protect all other quotation routes
router.use(authenticate);

router.post('/', createQuotation);
router.get('/', getQuotations);
router.post('/:id/documents', documentUpload.array('files', 25), uploadQuotationDocuments);
router.get('/:id/documents', listQuotationDocuments);
router.get('/:id/documents/:documentId/download', downloadQuotationDocument);
router.patch('/:id/documents/:documentId', updateQuotationDocument);
router.delete('/:id/documents/:documentId', deleteQuotationDocument);
router.get('/:id/email-dispatches', listQuotationDispatches);
router.get('/:id', getQuotationById);
router.get('/:id/pdf', generateQuotationPdf);
router.put('/:id', updateQuotation);
router.put('/:id/phase', updatePhase);
router.delete('/:id', deleteQuotation);

export default router;
