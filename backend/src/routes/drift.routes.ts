import { Router } from 'express';
import { DriftController } from '../controllers/drift.controller';

const router = Router();

/**
 * @route GET /api/drift/markets
 * @desc Get all available Drift perpetual markets with leverage info
 * @access Public
 */
router.get('/markets', DriftController.getMarkets);

/**
 * @route GET /api/drift/markets/:marketIndex
 * @desc Get specific Drift market by index
 * @access Public
 */
router.get('/markets/:marketIndex', DriftController.getMarket);

export default router;