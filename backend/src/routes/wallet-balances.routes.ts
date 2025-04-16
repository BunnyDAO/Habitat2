import { Router } from 'express';
import { WalletBalancesService } from '../services/wallet-balances.service';
import { Pool } from 'pg';

export function createWalletBalancesRouter(pool: Pool): Router {
  const router = Router();
  const service = new WalletBalancesService(pool);

  // Get balances for a wallet
  router.get('/:walletAddress', async (req, res) => {
    try {
      const { walletAddress } = req.params;
      const balances = await service.getBalances(walletAddress);
      res.json(balances);
    } catch (error) {
      console.error('Error getting balances:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Update a specific balance
  router.post('/', async (req, res) => {
    try {
      const { walletAddress, mintAddress, amount, decimals, lastUpdated } = req.body;
      await service.updateBalance(
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
  router.delete('/:walletAddress', async (req, res) => {
    try {
      const { walletAddress } = req.params;
      await service.deleteBalances(walletAddress);
      res.status(200).json({ message: 'Balances deleted successfully' });
    } catch (error) {
      console.error('Error deleting balances:', error);
      res.status(500).json({ error: 'Failed to delete balances' });
    }
  });

  // Populate balances from blockchain
  router.post('/:walletAddress/populate', async (req, res) => {
    try {
      const { walletAddress } = req.params;
      await service.populateWalletBalances(walletAddress);
      res.status(200).json({ message: 'Balances populated successfully' });
    } catch (error) {
      console.error('Error populating balances:', error);
      res.status(500).json({ error: 'Failed to populate balances' });
    }
  });

  // Hide a token
  router.post('/hide', async (req, res) => {
    try {
      const { walletAddress, mintAddress } = req.body;
      if (!walletAddress || !mintAddress) {
        return res.status(400).json({ error: 'Missing required parameters' });
      }
      await service.hideToken(walletAddress, mintAddress);
      res.json({ success: true });
    } catch (error) {
      console.error('Error hiding token:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Unhide a token
  router.post('/unhide', async (req, res) => {
    try {
      const { walletAddress, mintAddress } = req.body;
      if (!walletAddress || !mintAddress) {
        return res.status(400).json({ error: 'Missing required parameters' });
      }
      await service.unhideToken(walletAddress, mintAddress);
      res.json({ success: true });
    } catch (error) {
      console.error('Error unhiding token:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Get hidden tokens for a wallet
  router.get('/:walletAddress/hidden', async (req, res) => {
    try {
      const { walletAddress } = req.params;
      const hiddenTokens = await service.getHiddenTokens(walletAddress);
      res.json({ hiddenTokens });
    } catch (error) {
      console.error('Error getting hidden tokens:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
} 