import { Router } from 'express';
import { getAllStandardFees, createStandardFee, updateStandardFee, deleteStandardFee } from '../controllers/standardFeeController';

const router = Router();

router.get('/', getAllStandardFees);
router.post('/', createStandardFee);
router.put('/:id', updateStandardFee);
router.delete('/:id', deleteStandardFee);

export default router;
