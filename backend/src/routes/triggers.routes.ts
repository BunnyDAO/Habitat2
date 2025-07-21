import { Router } from 'express';
import { Pool } from 'pg';
import { TriggerService, PairTradeSignal } from '../services/trigger.service';

export const createTriggersRoutes = (pool: Pool) => {
  const router = Router();
  const triggerService = new TriggerService();

  // POST /api/triggers/pair-trade
  router.post('/pair-trade', async (req, res) => {
    try {
      const signal: PairTradeSignal = req.body;

      // Validate required fields
      if (!signal.tokenAMint || !signal.tokenBMint || !signal.action || !signal.targetToken || !signal.percentage) {
        return res.status(400).json({
          error: 'Missing required fields: tokenAMint, tokenBMint, action, targetToken, percentage'
        });
      }

      // Add timestamp if not provided
      if (!signal.timestamp) {
        signal.timestamp = new Date().toISOString();
      }

      const result = await triggerService.processPairTradeSignal(signal);

      res.json({
        success: true,
        data: result
      });

    } catch (error) {
      console.error('Error processing pair trade signal:', error);
      res.status(400).json({
        error: 'Failed to process pair trade signal',
        message: (error as Error).message
      });
    }
  });

  // GET /api/triggers/status
  router.get('/status', async (req, res) => {
    try {
      // Mock status endpoint - would return system health, processing stats, etc.
      const status = {
        isHealthy: true,
        lastProcessedSignal: new Date().toISOString(),
        activeStrategies: 5, // Would query from database
        processingQueueSize: 0
      };

      res.json({
        success: true,
        data: status
      });

    } catch (error) {
      console.error('Error getting trigger status:', error);
      res.status(500).json({
        error: 'Failed to get trigger status',
        message: (error as Error).message
      });
    }
  });

  return router;
};