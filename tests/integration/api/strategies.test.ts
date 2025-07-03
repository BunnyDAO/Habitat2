/**
 * Strategy API Integration Tests
 * 
 * Tests strategy CRUD operations, validation, and security
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestApi, teardownTestApi, TestApiSetup, createTestUser } from '../../helpers/api';
import { TestDataFactory } from '../../helpers/test-data-factory';
import { createApp } from '../../../backend/src/server';

describe('Strategy API', () => {
  let testSetup: TestApiSetup;
  let app: any;
  let testUser1: { walletAddress: string; token: string };
  let testUser2: { walletAddress: string; token: string };
  let testWallet1: any;
  let testWallet2: any;

  beforeAll(async () => {
    // Create Express app
    app = createApp();
    
    // Setup test environment
    testSetup = await setupTestApi(app, {
      useTestDatabase: true,
      clientTimeout: 10000,
    });

    // Create test users
    testUser1 = await createTestUser(testSetup.apiClient, 'strategy_test_user_1_' + Date.now());
    testUser2 = await createTestUser(testSetup.apiClient, 'strategy_test_user_2_' + Date.now());

    // Create test trading wallets
    testWallet1 = await testSetup.tradingWallets.createTradingWallet({
      ownerAddress: testUser1.walletAddress,
      wallet: { name: 'Test Wallet 1' },
    });

    // Switch to user 2 and create their wallet
    testSetup.apiClient.setAuthToken(testUser2.token);
    testWallet2 = await testSetup.tradingWallets.createTradingWallet({
      ownerAddress: testUser2.walletAddress,
      wallet: { name: 'Test Wallet 2' },
    });

    // Switch back to user 1 for most tests
    testSetup.apiClient.setAuthToken(testUser1.token);
  });

  afterAll(async () => {
    if (testSetup) {
      await teardownTestApi(testSetup);
    }
  });

  beforeEach(async () => {
    // Ensure we're authenticated as user 1 for each test
    testSetup.apiClient.setAuthToken(testUser1.token);
  });

  describe('POST /api/strategies', () => {
    it('should create strategy with valid parameters', async () => {
      const strategyData = TestDataFactory.createStrategyRequest({
        trading_wallet_id: testWallet1.id,
        strategy_type: 'wallet-monitor',
        name: 'Test Wallet Monitor',
      });

      const strategy = await testSetup.strategies.createStrategy(strategyData);

      expect(strategy).toMatchObject({
        trading_wallet_id: strategyData.trading_wallet_id,
        strategy_type: strategyData.strategy_type,
        name: strategyData.name,
        main_wallet_pubkey: testUser1.walletAddress,
        is_active: true,
        version: 1,
      });
      expect(strategy.id).toBeDefined();
      expect(strategy.created_at).toBeDefined();
      expect(strategy.updated_at).toBeDefined();
    });
  });
});
