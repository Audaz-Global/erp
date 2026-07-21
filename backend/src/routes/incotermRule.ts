import { Router } from 'express';
import {
  getIncotermRules,
  createIncotermRule,
  updateIncotermRule,
  deleteIncotermRule,
  seedIncotermRules
} from '../controllers/incotermRuleController';

const router = Router();

router.get('/', getIncotermRules);
router.post('/', createIncotermRule);
router.post('/seed', seedIncotermRules);
router.put('/:id', updateIncotermRule);
router.delete('/:id', deleteIncotermRule);

export default router;
