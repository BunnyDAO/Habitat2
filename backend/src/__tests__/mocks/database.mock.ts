import { jest } from '@jest/globals';
import { Pool, PoolClient } from 'pg';

// Mock database responses
export const mockStrategy = {
  id: 1,
  main_wallet_pubkey: 'test-main-wallet',
  trading_wallet_id: 1,
  strategy_type: 'wallet-monitor',
  config: {
    walletAddress: 'target-wallet-address',
    percentage: 50,
    minTradeSize: 1000000
  },
  name: 'Test Strategy',
  is_active: true,
  created_at: new Date('2024-01-01'),
  updated_at: new Date('2024-01-01')
};

export const mockTradingWallet = {
  id: 1,
  main_wallet_pubkey: 'test-main-wallet',
  wallet_pubkey: 'test-trading-wallet',
  name: 'Test Trading Wallet',
  is_active: true,
  created_at: new Date('2024-01-01')
};

export const mockEncryptedKey = {
  id: 1,
  trading_wallet_id: 1,
  encrypted_private_key: 'encrypted-key-data',
  session_key_encrypted: 'encrypted-session-key',
  created_at: new Date('2024-01-01'),
  last_accessed: new Date('2024-01-01')
};

// Mock database pool
export class MockPool {
  private static instance: MockPool;
  
  static getInstance(): MockPool {
    if (!MockPool.instance) {
      MockPool.instance = new MockPool();
    }
    return MockPool.instance;
  }

  // Mock query method
  query = jest.fn<any, [string, any[]?]>().mockImplementation((text: string, params?: any[]) => {
    // Simulate different queries based on SQL text
    if (text.includes('SELECT * FROM strategies')) {
      return Promise.resolve({
        rows: [mockStrategy],
        rowCount: 1
      });
    }
    
    if (text.includes('SELECT * FROM trading_wallets')) {
      return Promise.resolve({
        rows: [mockTradingWallet],
        rowCount: 1
      });
    }
    
    if (text.includes('SELECT * FROM encrypted_wallet_keys')) {
      return Promise.resolve({
        rows: [mockEncryptedKey],
        rowCount: 1
      });
    }
    
    if (text.includes('INSERT INTO transactions')) {
      return Promise.resolve({
        rows: [{ id: Math.floor(Math.random() * 1000000) }],
        rowCount: 1
      });
    }
    
    if (text.includes('UPDATE strategies SET last_executed')) {
      return Promise.resolve({
        rows: [],
        rowCount: 1
      });
    }
    
    // Default response
    return Promise.resolve({
      rows: [],
      rowCount: 0
    });
  });

  // Mock connect method
  connect = jest.fn<any, []>().mockResolvedValue({
    query: this.query,
    release: jest.fn(),
    client: 'mock-client'
  });

  // Mock end method
  end = jest.fn<any, []>().mockResolvedValue(undefined);

  // Reset all mocks
  reset = () => {
    this.query.mockReset();
    this.connect.mockReset();
    this.end.mockReset();
  };

  // Helper methods for test scenarios
  simulateQueryError = (errorMessage: string = 'Database error') => {
    this.query.mockRejectedValueOnce(new Error(errorMessage));
  };

  simulateConnectionError = () => {
    this.connect.mockRejectedValueOnce(new Error('Connection failed'));
  };

  mockStrategyResult = (strategies: any[] = [mockStrategy]) => {
    this.query.mockResolvedValueOnce({
      rows: strategies,
      rowCount: strategies.length
    });
  };

  mockWalletResult = (wallets: any[] = [mockTradingWallet]) => {
    this.query.mockResolvedValueOnce({
      rows: wallets,
      rowCount: wallets.length
    });
  };

  mockEncryptedKeyResult = (keys: any[] = [mockEncryptedKey]) => {
    this.query.mockResolvedValueOnce({
      rows: keys,
      rowCount: keys.length
    });
  };
}

// Mock Supabase client
export class MockSupabaseClient {
  private static instance: MockSupabaseClient;
  
  static getInstance(): MockSupabaseClient {
    if (!MockSupabaseClient.instance) {
      MockSupabaseClient.instance = new MockSupabaseClient();
    }
    return MockSupabaseClient.instance;
  }

  from = jest.fn<any, any>().mockReturnThis();
  select = jest.fn<any, any>().mockReturnThis();
  insert = jest.fn<any, any>().mockReturnThis();
  update = jest.fn<any, any>().mockReturnThis();
  delete = jest.fn<any, any>().mockReturnThis();
  eq = jest.fn<any, any>().mockReturnThis();
  single = jest.fn<any, any>().mockResolvedValue({ data: mockStrategy, error: null });
  
  reset = () => {
    this.from.mockReset().mockReturnThis();
    this.select.mockReset().mockReturnThis();
    this.insert.mockReset().mockReturnThis();
    this.update.mockReset().mockReturnThis();
    this.delete.mockReset().mockReturnThis();
    this.eq.mockReset().mockReturnThis();
    this.single.mockReset().mockResolvedValue({ data: mockStrategy, error: null });
  };
}

// Export mock factories
export const createMockPool = (): MockPool => {
  return MockPool.getInstance();
};

export const createMockSupabaseClient = (): MockSupabaseClient => {
  return MockSupabaseClient.getInstance();
};