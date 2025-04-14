import { Router } from 'express';
import { ChartDataController } from '../controllers/chart-data.controller';
import { ChartDataService } from '../services/chart-data.service';
import { TokenService } from '../../../services/token.service';
import { Redis } from 'ioredis';

export function createChartDataRouter(redis: Redis | null, tokenService: TokenService): Router {
  const router = Router();
  const chartDataService = new ChartDataService(redis, tokenService);
  const chartDataController = new ChartDataController(chartDataService);

  router.get('/:tokenMint', (req, res) => chartDataController.getTokenPriceChartData(req, res));

  return router;
} 