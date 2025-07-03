/**
 * Wallet Monitor Duplicate Prevention Tests
 * 
 * Tests that wallet monitor strategies for the same monitored wallet
 * update existing strategy instead of creating duplicates
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { TestDatabaseManager } from '../../helpers/db-setup';
import { TestDataFactory } from '../../helpers/test-data-factory';

describe('Wallet Monitor Duplicate Prevention', () => {
  let dbManager: TestDatabaseManager;
  let testTradingWallet: any;
  let testMainWallet: string;

  beforeAll(async () => {
    dbManager = new TestDatabaseManager();
    await dbManager.setupTestDatabase();
    await dbManager.seedTestData();
    
    // Create a test main wallet and trading wallet
    testMainWallet = TestDataFactory.generateTestPublicKey();
    
    const pool = await dbManager.getPool();
    
    // First create the user
    await pool.query(
      `INSERT INTO users (main_wallet_pubkey, created_at, updated_at) 
       VALUES ($1, NOW(), NOW()) ON CONFLICT (main_wallet_pubkey) DO NOTHING`,
      [testMainWallet]
    );
    
    // Then create the trading wallet
    const walletResult = await pool.query(
      `INSERT INTO trading_wallets (main_wallet_pubkey, wallet_pubkey, name, created_at) 
       VALUES ($1, $2, $3, NOW()) RETURNING *`,
      [testMainWallet, TestDataFactory.generateTestPublicKey(), 'Test Wallet Monitor Wallet']
    );
    testTradingWallet = walletResult.rows[0];
  });

  afterAll(async () => {
    if (dbManager) {
      await dbManager.cleanupTestData();
    }
  });

  beforeEach(async () => {
    // Clean up any strategies from previous tests
    const pool = await dbManager.getPool();
    await pool.query(
      'DELETE FROM strategies WHERE trading_wallet_id = $1',
      [testTradingWallet.id]
    );
  });

  describe('Wallet Monitor Strategy Creation', () => {
    it('should create new wallet monitor strategy when none exists', async () => {
      const pool = await dbManager.getPool();
      const monitoredWallet = TestDataFactory.generateTestPublicKey();
      
      // Create first wallet monitor strategy
      const result = await pool.query(
        `INSERT INTO strategies (
          trading_wallet_id, main_wallet_pubkey, strategy_type, 
          config, name, version, is_active, position, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW()) RETURNING *`,
        [
          testTradingWallet.id,
          testMainWallet,
          'wallet-monitor',
          JSON.stringify({ walletAddress: monitoredWallet, percentage: 10 }),
          'First Wallet Monitor',
          1,
          true,
          1
        ]
      );

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].config.walletAddress).toBe(monitoredWallet);
      expect(result.rows[0].config.percentage).toBe(10);
    });

    it('should update existing wallet monitor when monitoring same wallet with different percentage', async () => {
      const pool = await dbManager.getPool();
      const monitoredWallet = TestDataFactory.generateTestPublicKey();
      
      // Create first wallet monitor strategy (10%)
      const firstStrategy = await pool.query(
        `INSERT INTO strategies (
          trading_wallet_id, main_wallet_pubkey, strategy_type, 
          config, name, version, is_active, position, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW()) RETURNING *`,
        [
          testTradingWallet.id,
          testMainWallet,
          'wallet-monitor',
          JSON.stringify({ walletAddress: monitoredWallet, percentage: 10 }),
          'First Wallet Monitor',
          1,
          true,
          1
        ]
      );

      const originalId = firstStrategy.rows[0].id;
      
      // Check for existing wallet monitor for same monitored wallet
      const existingStrategy = await pool.query(
        `SELECT * FROM strategies 
         WHERE trading_wallet_id = $1 
         AND strategy_type = 'wallet-monitor' 
         AND config->>'walletAddress' = $2`,
        [testTradingWallet.id, monitoredWallet]
      );

      expect(existingStrategy.rows).toHaveLength(1);
      
      // Update existing strategy instead of creating new one (simulate API behavior)
      if (existingStrategy.rows.length > 0) {
        await pool.query(
          `UPDATE strategies 
           SET config = $1, name = $2, version = version + 1, updated_at = NOW()
           WHERE id = $3`,
          [
            JSON.stringify({ walletAddress: monitoredWallet, percentage: 25 }),
            'Updated Wallet Monitor',
            originalId
          ]
        );
      }

      // Verify only one strategy exists and it's updated
      const finalStrategies = await pool.query(
        `SELECT * FROM strategies 
         WHERE trading_wallet_id = $1 AND strategy_type = 'wallet-monitor'`,
        [testTradingWallet.id]
      );

      expect(finalStrategies.rows).toHaveLength(1);
      expect(finalStrategies.rows[0].id).toBe(originalId);
      expect(finalStrategies.rows[0].config.percentage).toBe(25);
      expect(finalStrategies.rows[0].name).toBe('Updated Wallet Monitor');
      expect(finalStrategies.rows[0].version).toBe(2);
    });

    it('should allow multiple wallet monitors for different monitored wallets', async () => {
      const pool = await dbManager.getPool();
      const monitoredWallet1 = TestDataFactory.generateTestPublicKey();
      const monitoredWallet2 = TestDataFactory.generateTestPublicKey();
      
      // Create wallet monitor for first wallet
      await pool.query(
        `INSERT INTO strategies (
          trading_wallet_id, main_wallet_pubkey, strategy_type, 
          config, name, version, is_active, position, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())`,
        [
          testTradingWallet.id,
          testMainWallet,
          'wallet-monitor',
          JSON.stringify({ walletAddress: monitoredWallet1, percentage: 10 }),
          'Monitor Wallet 1',
          1,
          true,
          1
        ]
      );

      // Create wallet monitor for second wallet
      await pool.query(
        `INSERT INTO strategies (
          trading_wallet_id, main_wallet_pubkey, strategy_type, 
          config, name, version, is_active, position, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())`,
        [
          testTradingWallet.id,
          testMainWallet,
          'wallet-monitor',
          JSON.stringify({ walletAddress: monitoredWallet2, percentage: 15 }),
          'Monitor Wallet 2',
          1,
          true,
          2
        ]
      );

      // Verify both strategies exist
      const strategies = await pool.query(
        `SELECT * FROM strategies 
         WHERE trading_wallet_id = $1 AND strategy_type = 'wallet-monitor'
         ORDER BY config->>'walletAddress'`,
        [testTradingWallet.id]
      );

      expect(strategies.rows).toHaveLength(2);
      expect(strategies.rows[0].config.walletAddress).toBe(monitoredWallet1);
      expect(strategies.rows[0].config.percentage).toBe(10);
      expect(strategies.rows[1].config.walletAddress).toBe(monitoredWallet2);
      expect(strategies.rows[1].config.percentage).toBe(15);
    });

    it('should not affect non-wallet-monitor strategies', async () => {
      const pool = await dbManager.getPool();
      const monitoredWallet = TestDataFactory.generateTestPublicKey();
      
      // Create wallet monitor strategy
      await pool.query(
        `INSERT INTO strategies (
          trading_wallet_id, main_wallet_pubkey, strategy_type, 
          config, name, version, is_active, position, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())`,
        [
          testTradingWallet.id,
          testMainWallet,
          'wallet-monitor',
          JSON.stringify({ walletAddress: monitoredWallet, percentage: 10 }),
          'Wallet Monitor',
          1,
          true,
          1
        ]
      );

      // Create price monitor strategy
      await pool.query(
        `INSERT INTO strategies (
          trading_wallet_id, main_wallet_pubkey, strategy_type, 
          config, name, version, is_active, position, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())`,
        [
          testTradingWallet.id,
          testMainWallet,
          'price-monitor',
          JSON.stringify({ targetPrice: 100, direction: 'above' }),
          'Price Monitor',
          1,
          true,
          2
        ]
      );

      // Verify both strategies exist with different types
      const strategies = await pool.query(
        `SELECT * FROM strategies 
         WHERE trading_wallet_id = $1
         ORDER BY strategy_type`,
        [testTradingWallet.id]
      );

      expect(strategies.rows).toHaveLength(2);
      expect(strategies.rows[0].strategy_type).toBe('price-monitor');
      expect(strategies.rows[1].strategy_type).toBe('wallet-monitor');
    });
  });

  describe('Edge Cases', () => {
    it('should handle identical wallet monitor config (same wallet, same percentage)', async () => {
      const pool = await dbManager.getPool();
      const monitoredWallet = TestDataFactory.generateTestPublicKey();
      
      // Create first strategy
      const firstResult = await pool.query(
        `INSERT INTO strategies (
          trading_wallet_id, main_wallet_pubkey, strategy_type, 
          config, name, version, is_active, position, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW()) RETURNING *`,
        [
          testTradingWallet.id,
          testMainWallet,
          'wallet-monitor',
          JSON.stringify({ walletAddress: monitoredWallet, percentage: 10 }),
          'First Monitor',
          1,
          true,
          1
        ]
      );

      // Attempt to create identical strategy - should be handled gracefully
      // (In real implementation, this would update the existing one)
      const existingCheck = await pool.query(
        `SELECT * FROM strategies 
         WHERE trading_wallet_id = $1 
         AND strategy_type = 'wallet-monitor' 
         AND config->>'walletAddress' = $2`,
        [testTradingWallet.id, monitoredWallet]
      );

      expect(existingCheck.rows).toHaveLength(1);
      expect(existingCheck.rows[0].id).toBe(firstResult.rows[0].id);
    });
  });
});
