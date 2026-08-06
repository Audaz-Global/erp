import { Router } from 'express';
import multer from 'multer';
import { carrierRateStats, createCarrierRate, importDanielRates, listCarrierRates, matchCarrierRates, updateCarrierRate } from '../controllers/carrierRateController';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.get('/', listCarrierRates);
router.get('/stats', carrierRateStats);
router.get('/match', matchCarrierRates);
router.post('/', createCarrierRate);
router.post('/import-daniel', upload.single('file'), importDanielRates);
router.put('/:id', updateCarrierRate);

export default router;
