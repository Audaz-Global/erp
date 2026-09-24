import { Router } from 'express';
import { authenticate } from '../middlewares/auth';
import { getClientProfile, listPendingValidation, resolveAgentValidation, searchAtlantisAgent, searchAtlantisCustomer } from '../controllers/atlantisController';

const router = Router();
router.use(authenticate);
router.get('/search-customer', searchAtlantisCustomer);
router.get('/search-agent', searchAtlantisAgent);
router.get('/client-profile', getClientProfile);
router.get('/pending-validation', listPendingValidation);
router.put('/agents/:id/resolve', resolveAgentValidation);

export default router;
