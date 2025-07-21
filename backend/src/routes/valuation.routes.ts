import { Router } from 'express';
import { Pool } from 'pg';
import { ValuationService } from '../services/valuation.service';

export const createValuationRoutes = (pool: Pool) => {
  const router = Router();
  const valuationService = new ValuationService();

  // GET /api/valuation/pair?tokenA=<mint>&tokenB=<mint>
  router.get('/pair', async (req, res) => {
    try {
      const { tokenA, tokenB } = req.query;

      if (!tokenA || !tokenB) {
        return res.status(400).json({
          error: 'Missing required parameters: tokenA and tokenB'
        });
      }

      if (typeof tokenA !== 'string' || typeof tokenB !== 'string') {
        return res.status(400).json({
          error: 'Invalid parameter types: tokenA and tokenB must be strings'
        });
      }

      const result = await valuationService.getUndervaluedToken(tokenA, tokenB);

      res.json({
        success: true,
        data: result
      });

    } catch (error) {
      console.error('Error getting pair valuation:', error);
      res.status(500).json({
        error: 'Failed to get token pair valuation',
        message: (error as Error).message
      });
    }
  });

  // GET /api/valuation/cache-status
  router.get('/cache-status', async (req, res) => {
    try {
      const cacheStatus = valuationService.getCacheStatus();
      
      res.json({
        success: true,
        data: cacheStatus
      });

    } catch (error) {
      console.error('Error getting cache status:', error);
      res.status(500).json({
        error: 'Failed to get cache status',
        message: (error as Error).message
      });
    }
  });

  return router;
};