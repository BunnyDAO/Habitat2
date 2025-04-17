import { Request, Response } from 'express';
import { HeliusService } from '../services/helius.service';

export class HeliusController {
  private heliusService: HeliusService;

  constructor(heliusService: HeliusService) {
    this.heliusService = heliusService;
  }

  getTransactions = async (req: Request, res: Response) => {
    try {
      const { address } = req.params;
      const transactions = await this.heliusService.getTransactions(address);
      res.json(transactions);
    } catch (error) {
      console.error('Error fetching transactions:', error);
      res.status(500).json({ error: 'Failed to fetch transactions' });
    }
  };

  getTokenHolders = async (req: Request, res: Response) => {
    try {
      const { mint } = req.params;
      const { minAmount } = req.query;
      
      if (!mint) {
        return res.status(400).json({ error: 'Token mint address is required' });
      }

      const holders = await this.heliusService.getTokenHolders(
        mint,
        minAmount ? Number(minAmount) : 0
      );
      
      res.json(holders);
    } catch (error) {
      console.error('Error fetching token holders:', error);
      res.status(500).json({ error: 'Failed to fetch token holders' });
    }
  };

  getWalletTrades = async (req: Request, res: Response) => {
    try {
      const { address } = req.params;
      const { timeframe } = req.query;
      
      if (!address) {
        return res.status(400).json({ error: 'Wallet address is required' });
      }

      const trades = await this.heliusService.getWalletTrades(
        address,
        timeframe ? Number(timeframe) : 7 // Default to 7 days
      );
      
      res.json(trades);
    } catch (error) {
      console.error('Error fetching wallet trades:', error);
      res.status(500).json({ error: 'Failed to fetch wallet trades' });
    }
  };
} 