import { Request, Response } from 'express';
import { WalletBalancesService } from '../../../services/wallet-balances.service';

export class WalletBalancesController {
  constructor(private walletBalancesService: WalletBalancesService) {}

  async getBalances(req: Request, res: Response): Promise<void> {
    try {
      const { walletAddress } = req.params;
      if (!walletAddress) {
        res.status(400).json({ error: 'Wallet address is required' });
        return;
      }

      const balances = await this.walletBalancesService.getBalances(walletAddress);
      res.json(balances);
    } catch (error) {
      console.error('Error in getBalances:', error);
      res.status(500).json({ error: 'Failed to fetch wallet balances' });
    }
  }

  async updateBalances(req: Request, res: Response): Promise<void> {
    try {
      const { walletAddress } = req.params;
      if (!walletAddress) {
        res.status(400).json({ error: 'Wallet address is required' });
        return;
      }

      await this.walletBalancesService.populateWalletBalances(walletAddress);
      res.json({ message: 'Wallet balances updated successfully' });
    } catch (error) {
      console.error('Error in updateBalances:', error);
      res.status(500).json({ error: 'Failed to update wallet balances' });
    }
  }

  async deleteBalances(req: Request, res: Response): Promise<void> {
    try {
      const { walletAddress } = req.params;
      if (!walletAddress) {
        res.status(400).json({ error: 'Wallet address is required' });
        return;
      }

      await this.walletBalancesService.deleteBalances(walletAddress);
      res.json({ message: 'Wallet balances deleted successfully' });
    } catch (error) {
      console.error('Error in deleteBalances:', error);
      res.status(500).json({ error: 'Failed to delete wallet balances' });
    }
  }
} 