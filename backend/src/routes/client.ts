import { Router } from 'express';
import { authenticate } from '../middlewares/auth';
import { createClient, getClient, listClients, updateClient } from '../controllers/clientController';

const router = Router();
router.use(authenticate);
router.get('/', listClients);
router.get('/:id', getClient);
router.post('/', createClient);
router.put('/:id', updateClient);

export default router;
