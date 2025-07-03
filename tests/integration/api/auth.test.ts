/**
 * Authentication API Integration Tests
 * 
 * Tests the authentication endpoints and JWT token management
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestApi, teardownTestApi, TestApiSetup } from '../../helpers/api';
import { createApp } from '../../../backend/src/server';
import { ApiError } from '../../helpers/api/api-client';

describe('Authentication API', () => {
  let testSetup: TestApiSetup;
  let app: any;

  beforeAll(async () => {
    // Create Express app
    app = createApp();
    
    // Setup test environment
    testSetup = await setupTestApi(app, {
      useTestDatabase: true,
      clientTimeout: 5000,
    });
  });

  afterAll(async () => {
    if (testSetup) {
      await teardownTestApi(testSetup);
    }
  });

  beforeEach(async () => {
    // Clear any existing auth token
    testSetup.apiClient.clearAuthToken();
  });

  describe('POST /api/auth/signin', () => {
    it('should create JWT token for new wallet address', async () => {
      const walletAddress = 'test_wallet_' + Date.now();
      
      const result = await testSetup.apiClient.signin(walletAddress);
      
      expect(result).toHaveProperty('access_token');
      expect(typeof result.access_token).toBe('string');
      expect(result.access_token.length).toBeGreaterThan(0);
    });

    it('should return JWT token for existing wallet address', async () => {
      const walletAddress = 'existing_wallet_' + Date.now();
      
      // Sign in first time
      const firstResult = await testSetup.apiClient.signin(walletAddress);
      
      // Clear token and sign in again
      testSetup.apiClient.clearAuthToken();
      const secondResult = await testSetup.apiClient.signin(walletAddress);
      
      expect(secondResult).toHaveProperty('access_token');
      expect(typeof secondResult.access_token).toBe('string');
      expect(secondResult.access_token).not.toBe(firstResult.access_token);
    });

    it('should reject requests without wallet address', async () => {
      await expect(
        testSetup.apiClient.post('/api/auth/signin', {})
      ).rejects.toMatchObject({
        status: 400,
        message: expect.stringContaining('Wallet address is required'),
      });
    });

    it('should reject requests with invalid wallet address format', async () => {
      await expect(
        testSetup.apiClient.post('/api/auth/signin', { walletAddress: '' })
      ).rejects.toMatchObject({
        status: 400,
      });
    });
  });

  describe('POST /api/auth/signout', () => {
    it('should successfully sign out authenticated user', async () => {
      const walletAddress = 'signout_test_' + Date.now();
      
      // Sign in first
      await testSetup.apiClient.signin(walletAddress);
      
      // Then sign out
      const response = await testSetup.apiClient.signout();
      expect(response).toBeUndefined(); // No return data expected
    });

    it('should require authentication', async () => {
      await expect(
        testSetup.apiClient.post('/api/auth/signout')
      ).rejects.toMatchObject({
        status: 401,
      });
    });
  });

  describe('GET /api/auth/test', () => {
    it('should return test message', async () => {
      const result = await testSetup.apiClient.testAuth();
      
      expect(result).toHaveProperty('message');
      expect(typeof result.message).toBe('string');
    });
  });
});
