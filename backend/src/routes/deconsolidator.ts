import { Router } from 'express';
import {
  getDeconsolidators,
  createDeconsolidator,
  updateDeconsolidator,
  deleteDeconsolidator,
  seedDeconsolidators
} from '../controllers/deconsolidatorController';

const router = Router();

router.get('/', getDeconsolidators);
router.post('/', createDeconsolidator);
router.post('/seed', seedDeconsolidators);
router.put('/:id', updateDeconsolidator);
router.delete('/:id', deleteDeconsolidator);

export default router;
