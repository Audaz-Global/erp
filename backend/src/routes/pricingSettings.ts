import { Router } from 'express';
import { getPricingSettings, updatePricingSettings } from '../controllers/pricingSettingsController';

const router = Router();

router.get('/', getPricingSettings);
router.put('/', updatePricingSettings);

export default router;
