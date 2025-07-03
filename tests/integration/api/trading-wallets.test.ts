/**
 * Trading Wallet API Integration Tests
 * 
 * Tests trading wallet CRUD operations, validation, and security
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestApi, teardownTestApi, TestApiSetup, createTestUser } from '../../helpers/api';
import { createApp } from '../../../backend/src/server';

describe('Trading Wallet API', () => {
  let testSetup: TestApiSetup;
  let app: any;
  let testUser1: { walletAddress: string; token: string };
  let testUser2: { walletAddress: string; token: string };

  beforeAll(async () => {
    // Create Express app
    app = createApp();
    
    // Setup test environment
    testSetup = await setupTestApi(app, {
      useTestDatabase: true,
      clientTimeout: 10000,
    });

    // Create test users
    testUser1 = await createTestUser(testSetup.apiClient, 'wallet_test_user_1_' + Date.now());
    testUser2 = await createTestUser(testSetup.apiClient, 'wallet_test_user_2_' + Date.now());
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

  describe('POST /api/trading-wallets', () => {
    it('should create trading wallet with valid parameters', async () => {
      const walletData = {
        ownerAddress: testUser1.walletAddress,
        wallet: {
          name: 'Test Trading Wallet',
        },
      };

      const wallet = await testSetup.tradingWallets.createTradingWallet(walletData);

      expect(wallet).toMatchObject({
        name: walletData.wallet.name,
      });
      expect(wallet.publicKey).toBeDefined();
      expect(wallet.createdAt).toBeDefined();
      expect(typeof wallet.publicKey).toBe('string');
      expect(wallet.publicKey.length).toBeGreaterThan(0);
    });
  });
});
