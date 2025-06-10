import { Router } from 'express';
import { WalletBalancesController } from '../controllers/wallet-balances.controller';
import { WalletBalancesService } from '../../../services/wallet-balances.service';
import { Pool } from 'pg';
import { createClient } from 'redis';

export function createWalletBalancesRouter(pool: Pool): Router {
  const router = Router();
  
  // Initialize Redis client (optional)
  let redisClient: ReturnType<typeof createClient> | null = null;
  if (process.env.REDIS_URL) {
    redisClient = createClient({ url: process.env.REDIS_URL });
    redisClient.connect().catch(err => {
      console.error('Failed to connect to Redis in wallet-balances routes:', err);
      redisClient = null;
    });
  }

  // Initialize service with proper parameters including Helius RPC
  const walletBalancesService = new WalletBalancesService(
    pool,
    redisClient,
    process.env.HELIUS_RPC_URL || process.env.SOLANA_RPC_URL || `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
  );
  
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