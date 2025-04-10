import express from 'express';
import { Pool } from 'pg';
import { TradingWallet } from '../../src/types/wallet';

const router = express.Router();

export function createTradingWalletsRouter(pool: Pool) {
  // Test database connection on router creation
  pool.query('SELECT NOW()', (err) => {
    if (err) {
      console.error('Error testing database connection:', err);
    } else {
      console.log('Successfully connected to database');
    }
  });

  // Get trading wallets for an owner
  router.get('/:ownerAddress', async (req, res) => {
    console.log('Received GET request for trading wallets');
    const { ownerAddress } = req.params;
    console.log('Owner address:', ownerAddress);
    
    const client = await pool.connect();
    console.log('Got database client');

    try {
      // Get all trading wallets for this user directly
      const walletsResult = await client.query(`
        SELECT wallet_pubkey as "publicKey", name, 
               EXTRACT(EPOCH FROM created_at) * 1000 as "createdAt"
        FROM trading_wallets
        WHERE main_wallet_pubkey = $1
        ORDER BY created_at DESC
      `, [ownerAddress]);

      console.log('Found wallets:', walletsResult.rows);
      res.json(walletsResult.rows);
    } catch (error) {
      console.error('Error fetching trading wallets:', error);
      res.status(500).json({ error: 'Failed to fetch trading wallets' });
    } finally {
      client.release();
      console.log('Released database client');
    }
  });

  // Save a trading wallet
  router.post('/', async (req, res) => {
    console.log('Received POST request to /trading-wallets');
    console.log('Request body:', req.body);
    
    const { ownerAddress, wallet } = req.body as { ownerAddress: string; wallet: TradingWallet };
    console.log('Extracted ownerAddress:', ownerAddress);
    console.log('Extracted wallet:', wallet);
    
    const client = await pool.connect();
    console.log('Got database client');

    try {
      await client.query('BEGIN');
      console.log('Started transaction');

      // First check if user exists
      const userResult = await client.query(`
        SELECT main_wallet_pubkey FROM users WHERE main_wallet_pubkey = $1
      `, [ownerAddress]);

      if (userResult.rows.length === 0) {
        // Insert user if not exists
        console.log('User does not exist, creating new user');
        await client.query(`
          INSERT INTO users (main_wallet_pubkey)
          VALUES ($1)
        `, [ownerAddress]);
        console.log('Created new user');
      }

      // Insert trading wallet
      console.log('Inserting trading wallet:', wallet.publicKey);
      const result = await client.query(`
        INSERT INTO trading_wallets (main_wallet_pubkey, wallet_pubkey, name, created_at)
        VALUES ($1, $2, $3, to_timestamp($4 / 1000.0))
        RETURNING id, wallet_pubkey as "publicKey", name, 
                 EXTRACT(EPOCH FROM created_at) * 1000 as "createdAt"
      `, [ownerAddress, wallet.publicKey, wallet.name || null, wallet.createdAt]);

      await client.query('COMMIT');
      console.log('Successfully committed transaction');
      console.log('Inserted wallet:', result.rows[0]);
      res.status(200).json(result.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error saving trading wallet:', error);
      // Send more detailed error information
      const err = error as { message?: string; code?: string };
      res.status(500).json({ 
        error: 'Failed to save trading wallet',
        details: err.message || 'Unknown error',
        code: err.code || 'UNKNOWN'
      });
    } finally {
      client.release();
      console.log('Released database client');
    }
  });

  // Delete a trading wallet
  router.delete('/:walletPubkey', async (req, res) => {
    const { walletPubkey } = req.params;
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      await client.query(`
        DELETE FROM trading_wallets
        WHERE wallet_pubkey = $1
      `, [walletPubkey]);

      await client.query('COMMIT');
      res.status(200).json({ success: true });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error deleting trading wallet:', error);
      res.status(500).json({ error: 'Failed to delete trading wallet' });
    } finally {
      client.release();
    }
  });

  return router;
} 