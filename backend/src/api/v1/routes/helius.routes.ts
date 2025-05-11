import { Router } from 'express';
import { HeliusController } from '../controllers/helius.controller';
import { HeliusService } from '../../services/helius.service';
import { createClient } from 'redis';

export const createHeliusRouter = (
  heliusApiKey: string,
  redisClient: ReturnType<typeof createClient> | null
) => {
  const router = Router();
  const heliusService = new HeliusService(heliusApiKey, redisClient);
  const heliusController = new HeliusController(heliusService);

  router.get('/transactions/:address', heliusController.getTransactions);
  router.get('/token-holders/:mint', heliusController.getTokenHolders);
  router.get('/wallet-trades/:address', heliusController.getWalletTrades);

  return router;
}; 