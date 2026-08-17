import { Router } from 'express';
import multer from 'multer';
import { getAgents, createAgent, updateAgent, deleteAgent, importAgents, syncCarriers } from '../controllers/agentController';
import { createPartnerFee, createPartnerRule, deletePartnerItem, getPartnerProfile, updatePartnerItem, updatePartnerOperational } from '../controllers/partnerProfileController';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.get('/', getAgents);
router.get('/profile/:id', getPartnerProfile);
router.put('/profile/:id/operational', updatePartnerOperational);
router.post('/profile/:id/fees', createPartnerFee);
router.post('/profile/:id/rules', createPartnerRule);
router.delete('/profile/:id/items/:source/:itemId', deletePartnerItem);
router.put('/profile/:id/items/:source/:itemId', updatePartnerItem);
router.post('/', createAgent);
router.put('/:id', updateAgent);
router.delete('/:id', deleteAgent);
router.post('/import', upload.single('file'), importAgents);
router.post('/sync-carriers', upload.single('file'), syncCarriers);

export default router;
