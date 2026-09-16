import { Router } from 'express';
import multer from 'multer';
import { authenticate } from '../middlewares/auth';
import {
  listTickets, getTicket, createTicket, updateTicket,
  addTicketComment, uploadTicketDocuments, downloadTicketDocument
} from '../controllers/ticketController';

const router = Router();
const documentUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 10 } });

router.use(authenticate);
router.get('/', listTickets);
router.get('/:id', getTicket);
router.post('/', createTicket);
router.put('/:id', updateTicket);
router.post('/:id/comments', addTicketComment);
router.post('/:id/documents', documentUpload.array('files', 10), uploadTicketDocuments);
router.get('/:id/documents/:documentId', downloadTicketDocument);

export default router;
