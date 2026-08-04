import { Router } from 'express';
import { createIncotermFieldRule, deleteIncotermFieldRule, getIncotermFieldRules, updateIncotermFieldRule } from '../controllers/incotermFieldRuleController';

const router = Router();
router.get('/', getIncotermFieldRules);
router.post('/', createIncotermFieldRule);
router.put('/:id', updateIncotermFieldRule);
router.delete('/:id', deleteIncotermFieldRule);
export default router;
