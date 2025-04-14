import { Router } from 'express';
import { SwapService } from '../../../services/swap.service';
import { Pool } from 'pg';
import { Connection, Keypair } from '@solana/web3.js';

export function createSwapRouter(pool: Pool, connection: Connection): Router {
  const router = Router();
  const swapService = new SwapService(pool, connection);

  // Execute a swap
  router.post('/execute', async (req, res) => {
    try {
      const {
        inputMint,
        outputMint,
        amount,
        slippageBps,
        walletKeypair,
        feeWalletPubkey,
        feeBps
      } = req.body;

      if (!inputMint || !outputMint || !amount || !walletKeypair) {
        return res.status(400).json({ error: 'Missing required parameters' });
      }

      // Deserialize the wallet keypair
      const keypair = Keypair.fromSecretKey(
        Buffer.from(walletKeypair.secretKey)
      );

      const result = await swapService.swapTokens({
        inputMint,
        outputMint,
        amount,
        slippageBps,
        walletKeypair: keypair,
        feeWalletPubkey,
        feeBps
      });

      res.json(result);
    } catch (error) {
      console.error('Error executing swap:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to execute swap' });
    }
  });

  return router;
} 