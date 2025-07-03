/**
 * Simple Auth Debug Test
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestApi, teardownTestApi, TestApiSetup } from '../../helpers/api';
import { createApp } from '../../../backend/src/server';

describe('Auth Debug', () => {
  let testSetup: TestApiSetup;
  let app: any;

  beforeAll(async () => {
    // Create Express app
    app = createApp();
    
    // Setup test environment
    testSetup = await setupTestApi(app, {
      useTestDatabase: false, // Skip DB for now
      clientTimeout: 5000,
    });
  });

  afterAll(async () => {
    if (testSetup) {
      await teardownTestApi(testSetup);
    }
  });

  it('should respond to basic health check', async () => {
    const response = await testSetup.apiClient.get('/health');
    expect(response.status).toBe(200);
    expect(response.data).toHaveProperty('status', 'ok');
  });

  it('should respond to auth test endpoint', async () => {
    const response = await testSetup.apiClient.get('/api/auth/test');
    expect(response.status).toBe(200);
    expect(response.data).toHaveProperty('message');
  });

  it('should provide error details for signin without body', async () => {
    try {
      await testSetup.apiClient.post('/api/auth/signin', {});
    } catch (error: any) {
      console.log('Auth signin error:', {
        status: error.status,
        message: error.message,
        details: error.details
      });
      expect(error.status).toBe(400);
    }
  });
});
