import { Router } from 'express';
import { PriceFeedController } from '../controllers/price-feed.controller';
import { PriceFeedService } from '../services/price-feed.service';
import { createClient } from 'redis';
import { HeliusService } from '../../../services/helius.service';

export const createPriceFeedRouter = (
  redisClient: ReturnType<typeof createClient>,
  heliusService: HeliusService
) => {
  const router = Router();
  const priceFeedService = new PriceFeedService(redisClient, heliusService);
  const priceFeedController = new PriceFeedController(priceFeedService);

  router.get('/price/:token', priceFeedController.getPrice);
  router.get('/prices', priceFeedController.getPrices);

  return router;
}; 