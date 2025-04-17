import { Router } from 'express';
import { JupiterController } from '../controllers/jupiter.controller';
import { JupiterService } from '../services/jupiter.service';
import { createClient } from 'redis';

export const createJupiterRouter = (redisClient: ReturnType<typeof createClient> | null) => {
  const router = Router();
  const jupiterService = new JupiterService(redisClient);
  const jupiterController = new JupiterController(jupiterService);

  router.get('/price/:token', jupiterController.getTokenPrice);
  router.get('/prices', jupiterController.getTokenPrices);
  router.get('/quote', jupiterController.getQuote);
  router.get('/tokens', jupiterController.getAllTokens);

  return router;
}; 