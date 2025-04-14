import { Request, Response } from 'express';
import { WhaleTrackingService } from '../services/whale-tracking.service';

export class WhaleTrackingController {
  private whaleTrackingService: WhaleTrackingService;

  constructor(whaleTrackingService: WhaleTrackingService) {
    this.whaleTrackingService = whaleTrackingService;
  }

  async getWhaleTransactions(req: Request, res: Response) {
    try {
      const { address } = req.params;
      
      if (!address) {
        return res.status(400).json({ error: 'Wallet address is required' });
      }

      const transactions = await this.whaleTrackingService.getWhaleTransactions(address);
      res.json(transactions);
    } catch (error) {
      console.error('Error in getWhaleTransactions:', error);
      res.status(500).json({ error: 'Failed to fetch whale transactions' });
    }
  }

  async getTokenPrice(req: Request, res: Response) {
    try {
      const { mintAddress } = req.params;
      
      if (!mintAddress) {
        return res.status(400).json({ error: 'Token mint address is required' });
      }

      const price = await this.whaleTrackingService.getTokenPrice(mintAddress);
      res.json({ price });
    } catch (error) {
      console.error('Error in getTokenPrice:', error);
      res.status(500).json({ error: 'Failed to fetch token price' });
    }
  }
} 