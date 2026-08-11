import { Router } from 'express';
import { createAgentDraftEmailTemplate, deleteAgentDraftEmailTemplate, listAgentDraftEmailTemplates, updateAgentDraftEmailTemplate } from '../controllers/agentDraftEmailTemplateController';

const router = Router();
router.get('/', listAgentDraftEmailTemplates);
router.post('/', createAgentDraftEmailTemplate);
router.put('/:id', updateAgentDraftEmailTemplate);
router.delete('/:id', deleteAgentDraftEmailTemplate);
export default router;
