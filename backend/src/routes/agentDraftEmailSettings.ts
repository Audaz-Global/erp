import { Router } from 'express';
import { getAgentDraftEmailSettings, updateAgentDraftEmailSettings } from '../controllers/agentDraftEmailSettingsController';

const router = Router();

router.get('/', getAgentDraftEmailSettings);
router.put('/', updateAgentDraftEmailSettings);

export default router;
