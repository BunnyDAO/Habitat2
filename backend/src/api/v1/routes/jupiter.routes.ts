import { Router } from 'express';
import { JupiterController } from '../controllers/jupiter.controller';
import { JupiterService } from 'services/jupiter.service';
import { createClient } from 'redis';
import { Pool } from 'pg';
import { Connection } from '@solana/web3.js';

export const createJupiterRouter = (pool: Pool, redisClient: ReturnType<typeof createClient> | null) => {
  const router = Router();
  const jupiterService = new JupiterService(pool, redisClient);
  const connection = new Connection(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com');
  const jupiterController = new JupiterController(jupiterService, pool, connection, redisClient);

  router.get('/price/:token', jupiterController.getTokenPrice);
  router.get('/prices', jupiterController.getTokenPrices);
  router.get('/quote', jupiterController.getQuote);
  router.get('/tokens', jupiterController.getAllTokens);
  router.post('/swap', jupiterController.executeSwap);

  return router;
}; 