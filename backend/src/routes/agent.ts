import { Router } from 'express';
import multer from 'multer';
import { getAgents, createAgent, updateAgent, deleteAgent, importAgents } from '../controllers/agentController';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.get('/', getAgents);
router.post('/', createAgent);
router.put('/:id', updateAgent);
router.delete('/:id', deleteAgent);
router.post('/import', upload.single('file'), importAgents);

export default router;
