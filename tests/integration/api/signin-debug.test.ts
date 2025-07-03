/**
 * Debug Auth Signin Test
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestApi, teardownTestApi, TestApiSetup } from '../../helpers/api';
import { createApp } from '../../../backend/src/server';

describe('Auth Signin Debug', () => {
  let testSetup: TestApiSetup;
  let app: any;

  beforeAll(async () => {
    app = createApp();
    testSetup = await setupTestApi(app, {
      useTestDatabase: true,
      clientTimeout: 10000,
    });
  });

  afterAll(async () => {
    if (testSetup) {
      await teardownTestApi(testSetup);
    }
  });

  it('should handle signin with valid wallet address', async () => {
    const walletAddress = 'test_wallet_' + Date.now();
    
    try {
      const response = await testSetup.apiClient.post('/api/auth/signin', {
        walletAddress
      });
      
      console.log('Signin response:', response.data);
      
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('access_token');
      expect(typeof response.data.access_token).toBe('string');
    } catch (error: any) {
      console.error('Signin error details:', {
        status: error.status,
        message: error.message,
        details: error.details
      });
      throw error;
    }
  });
});
