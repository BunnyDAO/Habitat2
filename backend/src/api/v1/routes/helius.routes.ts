import { Router } from 'express';
import { HeliusController } from '../controllers/helius.controller';
import { HeliusService } from '../services/helius.service';
import { createClient } from 'redis';

export const createHeliusRouter = (
  redisClient: ReturnType<typeof createClient> | null,
  heliusApiKey: string
) => {
  const router = Router();
  const heliusService = new HeliusService(redisClient, heliusApiKey);
  const heliusController = new HeliusController(heliusService);

  router.get('/transactions/:address', heliusController.getTransactions);
  router.get('/token-holders/:mint', heliusController.getTokenHolders);
  router.get('/wallet-trades/:address', heliusController.getWalletTrades);

  return router;
}; 