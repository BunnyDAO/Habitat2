import { Request, Response } from 'express';
import { HeliusService } from '../services/helius.service';
import { WhaleTrackerConfig, WhaleAnalytics, Trade } from '../types/whale-tracker/types';

export class WhaleTrackingController {
  private heliusService: HeliusService;

  constructor(heliusService: HeliusService) {
    this.heliusService = heliusService;
  }

  async getTokenHolders(req: Request, res: Response) {
    try {
      const { tokenMint, minAmount } = req.query;
      if (!tokenMint || typeof tokenMint !== 'string') {
        return res.status(400).json({ error: 'Token mint address is required' });
      }

      const minAmountNum = minAmount ? parseFloat(minAmount as string) : 0;
      const holders = await this.heliusService.getTokenHolders(tokenMint, minAmountNum);
      res.json(holders);
    } catch (error) {
      console.error('Error getting token holders:', error);
      res.status(500).json({ error: 'Failed to get token holders' });
    }
  }

  async getWalletTrades(req: Request, res: Response) {
    try {
      const { address, timeframe } = req.query;
      if (!address || typeof address !== 'string') {
        return res.status(400).json({ error: 'Wallet address is required' });
      }

      const timeframeNum = timeframe ? parseInt(timeframe as string) : 7; // Default 7 days
      const trades = await this.heliusService.getWalletTrades(address, timeframeNum);
      res.json(trades);
    } catch (error) {
      console.error('Error getting wallet trades:', error);
      res.status(500).json({ error: 'Failed to get wallet trades' });
    }
  }

  async calculateTradesProfitability(req: Request, res: Response) {
    try {
      const trades = req.body as Trade[];
      if (!Array.isArray(trades)) {
        return res.status(400).json({ error: 'Trades array is required' });
      }

      const profitableTrades = await this.heliusService.calculateTradesProfitability(trades);
      res.json(profitableTrades);
    } catch (error) {
      console.error('Error calculating trade profitability:', error);
      res.status(500).json({ error: 'Failed to calculate trade profitability' });
    }
  }

  async getWhaleAnalytics(req: Request, res: Response) {
    try {
      const { address } = req.params;
      const config = req.body as WhaleTrackerConfig;
      
      if (!address) {
        return res.status(400).json({ error: 'Wallet address is required' });
      }

      const analytics = await this.heliusService.getWhaleAnalytics(address, config);
      res.json(analytics);
    } catch (error) {
      console.error('Error getting whale analytics:', error);
      res.status(500).json({ error: 'Failed to get whale analytics' });
    }
  }

  async getWhaleTrades(req: Request, res: Response) {
    try {
      const { address } = req.params;
      const config = req.body as WhaleTrackerConfig;
      
      if (!address) {
        return res.status(400).json({ error: 'Wallet address is required' });
      }

      const trades = await this.heliusService.getWhaleTrades(address, config);
      res.json(trades);
    } catch (error) {
      console.error('Error getting whale trades:', error);
      res.status(500).json({ error: 'Failed to get whale trades' });
    }
  }
} 