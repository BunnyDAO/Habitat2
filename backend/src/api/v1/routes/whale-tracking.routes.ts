import { Router } from 'express';
import { WhaleTrackingController } from '../controllers/whale-tracking.controller';
import { WhaleTrackingService } from '../services/whale-tracking.service';
import { HeliusService } from '../../../services/helius.service';
import { Redis } from 'ioredis';

export function createWhaleTrackingRouter(redis: Redis | null, heliusService: HeliusService): Router {
  const router = Router();
  const whaleTrackingService = new WhaleTrackingService(redis, heliusService);
  const whaleTrackingController = new WhaleTrackingController(whaleTrackingService);

  router.get('/transactions/:address', (req, res) => whaleTrackingController.getWhaleTransactions(req, res));
  router.get('/token-price/:mintAddress', (req, res) => whaleTrackingController.getTokenPrice(req, res));

  return router;
} 