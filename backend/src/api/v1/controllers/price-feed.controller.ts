import { Request, Response } from 'express';
import { PriceFeedService } from '../services/price-feed.service';

export class PriceFeedController {
  private priceFeedService: PriceFeedService;

  constructor(priceFeedService: PriceFeedService) {
    this.priceFeedService = priceFeedService;
  }

  getPrice = async (req: Request, res: Response) => {
    try {
      const { token } = req.params;
      const price = await this.priceFeedService.getPrice(token);
      res.json({ price });
    } catch (error) {
      console.error('Error fetching price:', error);
      res.status(500).json({ error: 'Failed to fetch price' });
    }
  };

  getPrices = async (req: Request, res: Response) => {
    try {
      const { tokens } = req.query;
      const tokenList = typeof tokens === 'string' ? tokens.split(',') : [];
      const prices = await this.priceFeedService.getPrices(tokenList);
      res.json(prices);
    } catch (error) {
      console.error('Error fetching prices:', error);
      res.status(500).json({ error: 'Failed to fetch prices' });
    }
  };
} 