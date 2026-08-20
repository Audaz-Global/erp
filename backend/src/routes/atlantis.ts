import { Router } from 'express';
import { authenticate } from '../middlewares/auth';
import { listPendingValidation, resolveAgentValidation, resolveClientValidation, searchAtlantisAgent, searchAtlantisCustomer } from '../controllers/atlantisController';

const router = Router();
router.use(authenticate);
router.get('/search-customer', searchAtlantisCustomer);
router.get('/search-agent', searchAtlantisAgent);
router.get('/pending-validation', listPendingValidation);
router.put('/clients/:id/resolve', resolveClientValidation);
router.put('/agents/:id/resolve', resolveAgentValidation);

export default router;
