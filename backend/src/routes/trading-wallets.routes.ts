import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { TradingWallet } from '../../src/types/wallet';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.middleware';
import { WalletService } from '../services/wallet.service';

const router = express.Router();

export function createTradingWalletsRouter() {
  // Initialize Supabase client
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!
  );

  // Initialize WalletService
  const walletService = WalletService.getInstance();

  // Test database connection on router creation
  (async () => {
    try {
      await supabase.from('users').select('count').single();
      console.log('Successfully connected to Supabase');
    } catch (error) {
      console.error('Error testing Supabase connection:', error);
    }
  })();

  // Get trading wallets for an owner
  router.get('/:ownerAddress', authMiddleware, async (req: AuthenticatedRequest, res) => {
    console.log('Received GET request for trading wallets');
    const { ownerAddress } = req.params;
    console.log('Owner address:', ownerAddress);
    
    if (req.user?.main_wallet_pubkey !== ownerAddress) {
      return res.status(403).json({ error: 'Unauthorized access to trading wallets' });
    }

    try {
      // Get all trading wallets for this user
      const { data: wallets, error } = await supabase
        .from('trading_wallets')
        .select('wallet_pubkey, name, created_at')
        .eq('main_wallet_pubkey', ownerAddress)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching trading wallets:', error);
        throw error;
      }

      // Map database fields to expected frontend format
      const mappedWallets = wallets?.map(wallet => ({
        publicKey: wallet.wallet_pubkey,
        name: wallet.name,
        createdAt: wallet.created_at
      })) || [];
      
      console.log('Found wallets:', mappedWallets);
      res.json(mappedWallets);
    } catch (error) {
      console.error('Error fetching trading wallets:', error);
      res.status(500).json({ error: 'Failed to fetch trading wallets' });
    }
  });

  // Save a trading wallet
  router.post('/', authMiddleware, async (req: AuthenticatedRequest, res) => {
    console.log('Received POST request to /trading-wallets');
    console.log('Request body:', req.body);
    
    const { ownerAddress, wallet } = req.body as { ownerAddress: string; wallet: TradingWallet };
    console.log('Extracted ownerAddress:', ownerAddress);
    console.log('Extracted wallet:', wallet);
    
    if (req.user?.main_wallet_pubkey !== ownerAddress) {
      return res.status(403).json({ error: 'Unauthorized access to trading wallets' });
    }

    try {
      // Create wallet using WalletService
      const newWallet = await walletService.createWallet(
        ownerAddress,
        wallet.name
      );

      console.log('Successfully created trading wallet:', newWallet);
      res.status(200).json(newWallet);
    } catch (error) {
      console.error('Error saving trading wallet:', error);
      res.status(500).json({ error: 'Failed to save trading wallet' });
    }
  });

  // Delete a trading wallet
  router.delete('/:walletPubkey', authMiddleware, async (req: AuthenticatedRequest, res) => {
    const { walletPubkey } = req.params;
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_ANON_KEY!
    );

    try {
      await supabase.from('trading_wallets').delete().eq('wallet_pubkey', walletPubkey);
      res.status(200).json({ success: true });
    } catch (error) {
      console.error('Error deleting trading wallet:', error);
      res.status(500).json({ error: 'Failed to delete trading wallet' });
    }
  });

  // Update trading wallet name
  router.put('/:walletPubkey/name', authMiddleware, async (req: AuthenticatedRequest, res) => {
    console.log('Received PUT request to update trading wallet name');
    const { walletPubkey } = req.params;
    const { name } = req.body;
    console.log('Wallet public key:', walletPubkey);
    console.log('New name:', name);

    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'Name is required and must be a string' });
    }

    try {
      await walletService.updateWalletName(walletPubkey, name, req.user!.main_wallet_pubkey);
      res.json({ success: true, message: 'Wallet name updated successfully' });
    } catch (error) {
      console.error('Error updating wallet name:', error);
      res.status(500).json({ error: 'Failed to update wallet name' });
    }
  });

  // Get trading wallet ID by public key
  router.get('/by-pubkey/:walletPubkey', authMiddleware, async (req: AuthenticatedRequest, res) => {
    console.log('Received GET request for trading wallet ID by public key');
    const { walletPubkey } = req.params;
    console.log('Wallet public key:', walletPubkey);
    
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_ANON_KEY!
    );

    try {
      const { data: result, error } = await supabase
        .from('trading_wallets')
        .select('id, main_wallet_pubkey, wallet_pubkey')
        .eq('wallet_pubkey', walletPubkey)
        .single();

      if (error) {
        console.error('Error fetching trading wallet ID:', error);
        throw error;
      }

      if (result.main_wallet_pubkey !== req.user?.main_wallet_pubkey) {
        return res.status(403).json({ error: 'Unauthorized access to trading wallet' });
      }

      console.log('Found trading wallet ID:', result.id);
      res.json({ id: result.id, wallet_pubkey: result.wallet_pubkey });
    } catch (error) {
      console.error('Error fetching trading wallet ID:', error);
      res.status(500).json({ error: 'Failed to fetch trading wallet ID' });
    }
  });

  return router;
} 