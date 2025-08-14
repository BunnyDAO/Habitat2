import { Router } from 'express';
import { DriftController } from '../controllers/drift.controller';
import { authMiddleware } from '../middleware/auth.middleware';

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

/**
 * @route POST /api/drift/close-position
 * @desc Close an open Drift perpetual position
 * @access Private
 */
router.post('/close-position', authMiddleware, DriftController.closePosition);

/**
 * @route POST /api/drift/reduce-position
 * @desc Reduce an open Drift perpetual position by percentage
 * @access Private
 */
router.post('/reduce-position', authMiddleware, DriftController.reducePosition);

/**
 * @route GET /api/drift/position/:jobId
 * @desc Get current position status for a Drift strategy
 * @access Private
 */
router.get('/position/:jobId', authMiddleware, DriftController.getPosition);

/**
 * @route POST /api/drift/withdraw-collateral
 * @desc Withdraw collateral from Drift account
 * @access Private
 */
router.post('/withdraw-collateral', authMiddleware, DriftController.withdrawCollateral);

/**
 * @route POST /api/drift/settle-pnl/:jobId
 * @desc Settle unsettled PnL for a Drift strategy
 * @access Private
 */
router.post('/settle-pnl/:jobId', authMiddleware, DriftController.settlePnL);

export default router;