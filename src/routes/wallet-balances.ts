import { Router, Request, Response } from 'express';
import { WalletBalancesService } from '../services/wallet-balances.service';

export function createWalletBalancesRouter(walletBalancesService: WalletBalancesService) {
  const router = Router();

  // Get balances for a wallet
  router.get('/:walletAddress', async (req: Request, res: Response) => {
    try {
      const { walletAddress } = req.params;
      const balances = await walletBalancesService.getBalances(walletAddress);
      res.json(balances);
    } catch (error) {
      console.error('Error fetching balances:', error);
      res.status(500).json({ error: 'Failed to fetch balances' });
    }
  });

  // Update a specific balance
  router.post('/', async (req: Request, res: Response) => {
    try {
      const { walletAddress, mintAddress, amount, decimals, lastUpdated } = req.body;
      await walletBalancesService.updateBalance(
        walletAddress,
        mintAddress,
        amount,
        decimals,
        lastUpdated
      );
      res.status(200).json({ message: 'Balance updated successfully' });
    } catch (error) {
      console.error('Error updating balance:', error);
      res.status(500).json({ error: 'Failed to update balance' });
    }
  });

  // Delete all balances for a wallet
  router.delete('/:walletAddress', async (req: Request, res: Response) => {
    try {
      const { walletAddress } = req.params;
      await walletBalancesService.deleteBalances(walletAddress);
      res.status(200).json({ message: 'Balances deleted successfully' });
    } catch (error) {
      console.error('Error deleting balances:', error);
      res.status(500).json({ error: 'Failed to delete balances' });
    }
  });

  // Populate balances from blockchain
  router.post('/:walletAddress/populate', async (req: Request, res: Response) => {
    try {
      const { walletAddress } = req.params;
      await walletBalancesService.populateWalletBalances(walletAddress);
      res.status(200).json({ message: 'Balances populated successfully' });
    } catch (error) {
      console.error('Error populating balances:', error);
      res.status(500).json({ error: 'Failed to populate balances' });
    }
  });

  return router;
} 