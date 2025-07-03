/**
 * Wallet Monitor API Duplicate Prevention Tests
 * 
 * Tests that the API enforces wallet monitor duplicate prevention
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestApi, teardownTestApi, TestApiSetup, createTestUser } from '../../helpers/api';
import { TestDataFactory } from '../../helpers/test-data-factory';
import { createApp } from '../../../backend/src/server';

describe('Wallet Monitor API Duplicate Prevention', () => {
  let testSetup: TestApiSetup;
  let app: any;
  let testUser: { walletAddress: string; token: string };
  let testWallet: any;

  beforeAll(async () => {
    // Create Express app
    app = createApp();
    
    // Setup test environment
    testSetup = await setupTestApi(app, {
      useTestDatabase: true,
      clientTimeout: 15000,
    });

    // Create test user and wallet
    testUser = await createTestUser(testSetup.apiClient, 'wallet_monitor_test_' + Date.now());
    
    testWallet = await testSetup.tradingWallets.createTradingWallet({
      ownerAddress: testUser.walletAddress,
      wallet: { name: 'Wallet Monitor Test Wallet' },
    });
  });

  afterAll(async () => {
    if (testSetup) {
      await teardownTestApi(testSetup);
    }
  });

  beforeEach(async () => {
    // Clean up strategies before each test
    const pool = await testSetup.dbManager.getPool();
    await pool.query('DELETE FROM strategies WHERE trading_wallet_id = $1', [testWallet.id]);
  });

  describe('Wallet Monitor Duplicate Prevention', () => {
    it('should create new wallet monitor when none exists', async () => {
      const monitoredWallet = TestDataFactory.generateTestPublicKey();
      
      const strategyData = {
        trading_wallet_id: testWallet.id,
        strategy_type: 'wallet-monitor',
        name: 'First Monitor',
        config: {
          walletAddress: monitoredWallet,
          percentage: 10
        }
      };

      const strategy = await testSetup.strategies.createStrategy(strategyData);

      expect(strategy).toMatchObject({
        trading_wallet_id: testWallet.id,
        strategy_type: 'wallet-monitor',
        name: 'First Monitor',
        version: 1
      });
      expect(strategy.config.walletAddress).toBe(monitoredWallet);
      expect(strategy.config.percentage).toBe(10);
    });

    it('should update existing wallet monitor when monitoring same wallet with different percentage', async () => {
      const monitoredWallet = TestDataFactory.generateTestPublicKey();
      
      // Create first wallet monitor (10%)
      const firstStrategy = await testSetup.strategies.createStrategy({
        trading_wallet_id: testWallet.id,
        strategy_type: 'wallet-monitor',
        name: 'First Monitor',
        config: {
          walletAddress: monitoredWallet,
          percentage: 10
        }
      });

      const originalId = firstStrategy.id;

      // Create second wallet monitor for same wallet (25%) - should update existing
      const updatedStrategy = await testSetup.strategies.createStrategy({
        trading_wallet_id: testWallet.id,
        strategy_type: 'wallet-monitor',
        name: 'Updated Monitor',
        config: {
          walletAddress: monitoredWallet,
          percentage: 25
        }
      });

      // Should be the same strategy ID, but updated
      expect(updatedStrategy.id).toBe(originalId);
      expect(updatedStrategy.config.percentage).toBe(25);
      expect(updatedStrategy.name).toBe('Updated Monitor');
      expect(updatedStrategy.version).toBe(2); // Version incremented

      // Verify only one strategy exists in database
      const allStrategies = await testSetup.strategies.getStrategies(testWallet.id);
      const walletMonitorStrategies = allStrategies.filter(s => s.strategy_type === 'wallet-monitor');
      
      expect(walletMonitorStrategies).toHaveLength(1);
      expect(walletMonitorStrategies[0].id).toBe(originalId);
      expect(walletMonitorStrategies[0].config.percentage).toBe(25);
    });

    it('should allow multiple wallet monitors for different monitored wallets', async () => {
      const monitoredWallet1 = TestDataFactory.generateTestPublicKey();
      const monitoredWallet2 = TestDataFactory.generateTestPublicKey();
      
      // Create wallet monitor for first wallet
      const strategy1 = await testSetup.strategies.createStrategy({
        trading_wallet_id: testWallet.id,
        strategy_type: 'wallet-monitor',
        name: 'Monitor Wallet 1',
        config: {
          walletAddress: monitoredWallet1,
          percentage: 10
        }
      });

      // Create wallet monitor for second wallet
      const strategy2 = await testSetup.strategies.createStrategy({
        trading_wallet_id: testWallet.id,
        strategy_type: 'wallet-monitor',
        name: 'Monitor Wallet 2',
        config: {
          walletAddress: monitoredWallet2,
          percentage: 15
        }
      });

      // Both should exist as separate strategies
      expect(strategy1.id).not.toBe(strategy2.id);
      expect(strategy1.config.walletAddress).toBe(monitoredWallet1);
      expect(strategy2.config.walletAddress).toBe(monitoredWallet2);

      // Verify both strategies exist in database
      const allStrategies = await testSetup.strategies.getStrategies(testWallet.id);
      const walletMonitorStrategies = allStrategies.filter(s => s.strategy_type === 'wallet-monitor');
      
      expect(walletMonitorStrategies).toHaveLength(2);
    });

    it('should not affect non-wallet-monitor strategies', async () => {
      const monitoredWallet = TestDataFactory.generateTestPublicKey();
      
      // Create wallet monitor strategy
      await testSetup.strategies.createStrategy({
        trading_wallet_id: testWallet.id,
        strategy_type: 'wallet-monitor',
        name: 'Wallet Monitor',
        config: {
          walletAddress: monitoredWallet,
          percentage: 10
        }
      });

      // Create price monitor strategy
      await testSetup.strategies.createStrategy({
        trading_wallet_id: testWallet.id,
        strategy_type: 'price-monitor',
        name: 'Price Monitor',
        config: {
          targetPrice: 100,
          direction: 'above',
          percentageToSell: 25
        }
      });

      // Both should exist
      const allStrategies = await testSetup.strategies.getStrategies(testWallet.id);
      expect(allStrategies).toHaveLength(2);
      
      const strategyTypes = allStrategies.map(s => s.strategy_type).sort();
      expect(strategyTypes).toEqual(['price-monitor', 'wallet-monitor']);
    });

    it('should handle identical wallet monitor config gracefully', async () => {
      const monitoredWallet = TestDataFactory.generateTestPublicKey();
      const identicalConfig = {
        walletAddress: monitoredWallet,
        percentage: 10
      };
      
      // Create first strategy
      const firstStrategy = await testSetup.strategies.createStrategy({
        trading_wallet_id: testWallet.id,
        strategy_type: 'wallet-monitor',
        name: 'First Monitor',
        config: identicalConfig
      });

      // Create identical strategy - should update the existing one
      const secondStrategy = await testSetup.strategies.createStrategy({
        trading_wallet_id: testWallet.id,
        strategy_type: 'wallet-monitor',
        name: 'Second Monitor',
        config: identicalConfig
      });

      // Should be the same strategy, updated
      expect(secondStrategy.id).toBe(firstStrategy.id);
      expect(secondStrategy.name).toBe('Second Monitor');
      expect(secondStrategy.version).toBe(2);

      // Verify only one strategy exists
      const allStrategies = await testSetup.strategies.getStrategies(testWallet.id);
      const walletMonitorStrategies = allStrategies.filter(s => s.strategy_type === 'wallet-monitor');
      
      expect(walletMonitorStrategies).toHaveLength(1);
    });
  });
});
