import { Router } from 'express';
import multer from 'multer';
import {
  getFixedFees,
  createFixedFee,
  updateFixedFee,
  deleteFixedFee,
  importFixedFeesXlsx
} from '../controllers/fixedFeeController';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.get('/', getFixedFees);
router.post('/', createFixedFee);
router.put('/:id', updateFixedFee);
router.delete('/:id', deleteFixedFee);
router.post('/import', upload.single('file'), importFixedFeesXlsx);

export default router;
