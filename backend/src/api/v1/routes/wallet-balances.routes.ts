import { Router } from 'express';
import { WalletBalancesController } from '../controllers/wallet-balances.controller';
import { WalletBalancesService } from '../../../services/wallet-balances.service';
import { Pool } from 'pg';

export function createWalletBalancesRouter(pool: Pool): Router {
  const router = Router();
  const walletBalancesService = new WalletBalancesService(pool);
  const controller = new WalletBalancesController(walletBalancesService);

  // Get wallet balances
  router.get('/:walletAddress', (req, res) => controller.getBalances(req, res));

  // Update wallet balances
  router.post('/:walletAddress/update', (req, res) => controller.updateBalances(req, res));

  // Populate wallet balances
  router.post('/:walletAddress/populate', (req, res) => controller.updateBalances(req, res));

  // Delete wallet balances
  router.delete('/:walletAddress', (req, res) => controller.deleteBalances(req, res));

  return router;
} 