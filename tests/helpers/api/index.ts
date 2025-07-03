/**
 * Test API Setup - Main entry point for API testing
 * 
 * Provides a unified interface for setting up API testing infrastructure
 */

import { Express } from 'express';
import { TestServer, createTestServer } from './test-server';
import { ApiClient, createApiClient } from './api-client';
import { StrategyApiClient } from './strategy-api-client';
import { TradingWalletApiClient } from './trading-wallet-api-client';
import { TestDatabaseManager } from '../db-setup';
import dotenv from 'dotenv';
import path from 'path';

// Load test environment variables
dotenv.config({ path: path.resolve(__dirname, '../../backend/.env.test') });

export interface TestApiSetup {
  server: TestServer;
  apiClient: ApiClient;
  strategies: StrategyApiClient;
  tradingWallets: TradingWalletApiClient;
  dbManager: TestDatabaseManager;
}

export interface TestApiOptions {
  useTestDatabase?: boolean;
  serverTimeout?: number;
  clientTimeout?: number;
}

/**
 * Set up complete API testing environment
 */
export async function setupTestApi(
  app: Express,
  options: TestApiOptions = {}
): Promise<TestApiSetup> {
  const {
    useTestDatabase = true,
    serverTimeout = 30000,
    clientTimeout = 10000,
  } = options;

  console.log('🧪 Setting up test API environment...');
  console.log('Environment variables loaded:', {
    NODE_ENV: process.env.NODE_ENV,
    DATABASE_URL: process.env.DATABASE_URL ? 'Set' : 'Not set',
    JWT_SECRET: process.env.JWT_SECRET ? 'Set' : 'Not set',
    SUPABASE_URL: process.env.SUPABASE_URL ? 'Set' : 'Not set',
  });

  // Initialize database manager
  const dbManager = new TestDatabaseManager();
  
  if (useTestDatabase) {
    await dbManager.setupTestDatabase();
    await dbManager.seedTestData();
  }

  // Start test server
  const server = createTestServer(app);
  const { url } = await server.start();

  // Create API client
  const apiClient = createApiClient({
    baseURL: url,
    timeout: clientTimeout,
  });

  // Create specialized API clients
  const strategies = new StrategyApiClient(apiClient);
  const tradingWallets = new TradingWalletApiClient(apiClient);

  console.log('✅ Test API setup complete');
  console.log(`   Server: ${url}`);
  console.log(`   Database: ${useTestDatabase ? 'Test DB' : 'No DB'}`);

  return {
    server,
    apiClient,
    strategies,
    tradingWallets,
    dbManager,
  };
}

/**
 * Clean up test API environment
 */
export async function teardownTestApi(setup: TestApiSetup): Promise<void> {
  try {
    // Stop server
    await setup.server.stop();
    
    // Clean up database
    await setup.dbManager.cleanupTestData();
    
    console.log('✅ Test API teardown complete');
  } catch (error) {
    console.error('❌ Error during test API teardown:', error);
    throw error;
  }
}

/**
 * Create a test user and authenticate
 */
export async function createTestUser(
  apiClient: ApiClient,
  walletAddress: string = 'test_wallet_' + Date.now()
): Promise<{ walletAddress: string; token: string }> {
  const tokens = await apiClient.signin(walletAddress);
  return {
    walletAddress,
    token: tokens.access_token,
  };
}

// Re-export for convenience
export { TestServer, ApiClient, StrategyApiClient, TradingWalletApiClient };
export * from './test-server';
export * from './api-client';
export * from './strategy-api-client';
export * from './trading-wallet-api-client';
