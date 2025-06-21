import { Router } from 'express';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.middleware';
import { createClient } from '@supabase/supabase-js';
import { EncryptionService } from '../services/encryption.service';
import { Keypair, Transaction } from '@solana/web3.js';

const router = Router();
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

// Secure endpoint to get trading wallet keypair for transaction signing
// This endpoint does NOT expose private keys to the client
router.post('/sign-transaction',
  authMiddleware,
  async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      const { strategy_id, unsigned_transaction } = req.body;

      if (!strategy_id || !unsigned_transaction) {
        return res.status(400).json({ error: 'strategy_id and unsigned_transaction are required' });
      }

      // Get strategy and verify ownership
      const { data: strategy, error: strategyError } = await supabase
        .from('strategies')
        .select(`
          id,
          trading_wallet_id,
          main_wallet_pubkey,
          is_active,
          trading_wallets!inner(
            id,
            wallet_pubkey,
            main_wallet_pubkey
          )
        `)
        .eq('id', strategy_id)
        .eq('main_wallet_pubkey', req.user.main_wallet_pubkey)
        .eq('is_active', true)
        .single();

      if (strategyError || !strategy) {
        return res.status(404).json({ error: 'Strategy not found or access denied' });
      }

      // Get encrypted private key securely
      const encryptionService = EncryptionService.getInstance();
      const privateKeyHex = await encryptionService.getWalletPrivateKey(strategy.trading_wallet_id);
      
      // Convert hex to Uint8Array and create Keypair
      const privateKeyBuffer = Buffer.from(privateKeyHex, 'hex');
      const keypair = Keypair.fromSecretKey(privateKeyBuffer);

      // Verify the keypair matches the expected public key
      const expectedPublicKey = (strategy as any).trading_wallets.wallet_pubkey;
      if (keypair.publicKey.toString() !== expectedPublicKey) {
        throw new Error('Keypair verification failed');
      }

      // Deserialize and sign the transaction
      const transaction = Transaction.from(Buffer.from(unsigned_transaction, 'base64'));
      transaction.sign(keypair);

      // Return signed transaction (not the private key!)
      const signedTransaction = transaction.serialize().toString('base64');

      // Log the operation for audit trail
      await supabase
        .from('key_operations_audit')
        .insert([{
          encrypted_key_id: strategy.trading_wallet_id, // This should be the encrypted_wallet_keys.id
          operation_type: 'transaction_signing',
          status: 'success',
          metadata: { 
            strategy_id: strategy_id,
            user_id: req.user.main_wallet_pubkey,
            transaction_size: unsigned_transaction.length
          }
        }]);

      res.json({
        signed_transaction: signedTransaction,
        public_key: keypair.publicKey.toString()
      });

    } catch (error) {
      console.error('Error signing transaction:', error);
      
      // Log failed operation
      try {
        await supabase
          .from('key_operations_audit')
          .insert([{
            encrypted_key_id: null,
            operation_type: 'transaction_signing',
            status: 'failed',
            error_message: error instanceof Error ? error.message : 'Unknown error',
            metadata: { 
              user_id: req.user?.main_wallet_pubkey,
              strategy_id: req.body.strategy_id
            }
          }]);
      } catch (auditError) {
        console.error('Failed to log audit trail:', auditError);
      }

      res.status(500).json({ error: 'Failed to sign transaction' });
    }
  }
);

// Secure endpoint to get trading wallet public key (safe to expose)
router.get('/public-key/:strategy_id',
  authMiddleware,
  async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      const { strategy_id } = req.params;

      // Get strategy and verify ownership
      const { data: strategy, error: strategyError } = await supabase
        .from('strategies')
        .select(`
          id,
          trading_wallet_id,
          main_wallet_pubkey,
          trading_wallets!inner(
            id,
            wallet_pubkey
          )
        `)
        .eq('id', strategy_id)
        .eq('main_wallet_pubkey', req.user.main_wallet_pubkey)
        .single();

      if (strategyError || !strategy) {
        return res.status(404).json({ error: 'Strategy not found or access denied' });
      }

      res.json({
        public_key: (strategy as any).trading_wallets.wallet_pubkey,
        trading_wallet_id: strategy.trading_wallet_id
      });

    } catch (error) {
      console.error('Error getting public key:', error);
      res.status(500).json({ error: 'Failed to get public key' });
    }
  }
);

export default router; 