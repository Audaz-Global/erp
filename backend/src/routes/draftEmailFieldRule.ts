import { Router } from 'express';
import {
  getDraftEmailFieldRules,
  createDraftEmailFieldRule,
  updateDraftEmailFieldRule,
  deleteDraftEmailFieldRule,
  seedDraftEmailFieldRules
} from '../controllers/draftEmailFieldRuleController';

const router = Router();

router.get('/', getDraftEmailFieldRules);
router.post('/', createDraftEmailFieldRule);
router.post('/seed', seedDraftEmailFieldRules);
router.put('/:id', updateDraftEmailFieldRule);
router.delete('/:id', deleteDraftEmailFieldRule);

export default router;
