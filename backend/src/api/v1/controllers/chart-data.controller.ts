import { Request, Response } from 'express';
import { ChartDataService } from '../services/chart-data.service';

export class ChartDataController {
  private chartDataService: ChartDataService;

  constructor(chartDataService: ChartDataService) {
    this.chartDataService = chartDataService;
  }

  async getTokenPriceChartData(req: Request, res: Response) {
    try {
      const { tokenMint } = req.params;
      
      if (!tokenMint) {
        return res.status(400).json({ error: 'Token mint address is required' });
      }

      const data = await this.chartDataService.getTokenPriceChartData(tokenMint);
      res.json(data);
    } catch (error) {
      console.error('Error in getTokenPriceChartData:', error);
      res.status(500).json({ error: 'Failed to fetch chart data' });
    }
  }
} 