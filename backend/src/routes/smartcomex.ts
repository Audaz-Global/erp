import { Router } from 'express';
import { authenticate } from '../middlewares/auth';
import { getClients, getQuotations } from '../controllers/smartcomexController';

const router = Router();

router.use(authenticate);

router.get('/clients', getClients);
router.get('/quotations', getQuotations);

export default router;
