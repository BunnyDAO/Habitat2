import { jest } from '@jest/globals';
import { Connection, PublicKey, Transaction, Keypair } from '@solana/web3.js';

// Mock Solana Connection
export class MockConnection {
  private static instance: MockConnection;
  
  static getInstance(): MockConnection {
    if (!MockConnection.instance) {
      MockConnection.instance = new MockConnection();
    }
    return MockConnection.instance;
  }

  // Mock methods
  getBalance = jest.fn().mockResolvedValue(1000000000); // 1 SOL in lamports
  getTokenAccountBalance = jest.fn().mockResolvedValue({
    value: { amount: '1000000', decimals: 6, uiAmount: 1.0 }
  });
  
  getAccountInfo = jest.fn().mockResolvedValue({
    data: Buffer.from('mock-account-data'),
    lamports: 1000000000,
    owner: new PublicKey('11111111111111111111111111111111'),
    executable: false,
    rentEpoch: 0
  });

  onLogs = jest.fn().mockImplementation((address: PublicKey, callback: Function) => {
    // Mock subscription - returns mock subscription ID
    const subscriptionId = Math.floor(Math.random() * 1000000);
    
    // Simulate log events for testing
    setTimeout(() => {
      callback({
        signature: 'mock-signature-' + Date.now(),
        logs: ['Program log: Mock trade executed'],
        err: null
      });
    }, 100);

    return subscriptionId;
  });

  removeOnLogsListener = jest.fn().mockResolvedValue(true);
  
  sendTransaction = jest.fn().mockResolvedValue('mock-transaction-signature');
  confirmTransaction = jest.fn().mockResolvedValue({ value: { err: null } });
  
  getLatestBlockhash = jest.fn().mockResolvedValue({
    blockhash: 'mock-blockhash-' + Date.now(),
    lastValidBlockHeight: 1000000
  });

  getTransaction = jest.fn().mockResolvedValue(null);
  getParsedTokenAccountsByOwner = jest.fn().mockResolvedValue({ value: [] });

  // Reset all mocks
  reset() {
    Object.values(this).forEach(method => {
      if (typeof method === 'function' && method.mockReset) {
        method.mockReset();
      }
    });
  }
}

// Export mock factory
export const createMockConnection = (): MockConnection => {
  return MockConnection.getInstance();
};

// Mock PublicKey operations
export const mockPublicKey = (address?: string): PublicKey => {
  return new PublicKey(address || '11111111111111111111111111111111');
};

// Mock Keypair operations  
export const mockKeypair = (): Keypair => {
  return Keypair.generate();
};