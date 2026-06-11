import { Router } from 'express';
import { authenticate, authorizeAdmin } from '../middlewares/auth';
import { 
  createEntry, 
  getEntries, 
  getEntryById, 
  updateEntry, 
  deleteEntry 
} from '../controllers/knowledgeController';

const router = Router();

// Only Admin can manage knowledge base rules, templates and tariffs
router.use(authenticate);
router.use(authorizeAdmin);

router.post('/', createEntry);
router.get('/', getEntries);
router.get('/:id', getEntryById);
router.put('/:id', updateEntry);
router.delete('/:id', deleteEntry);

export default router;
