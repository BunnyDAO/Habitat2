import { vi } from 'vitest';

export interface TestStrategy {
  id?: number;
  name: string;
  tradingWalletId: number;
  strategyType: string;
  config: any;
  isActive?: boolean;
  createdAt?: string;
}

export interface TestWallet {
  id?: number;
  name: string;
  publicKey: string;
  mainWalletPubkey: string;
  createdAt?: string;
}

export interface TestTransaction {
  signature: string;
  blockTime: number;
  slot: number;
  meta: {
    err: null | any;
    fee: number;
    preBalances: number[];
    postBalances: number[];
  };
}

export interface TestPriceData {
  symbol: string;
  price: number;
  timestamp: number;
  change24h: number;
}

export interface CreateStrategyRequest {
  trading_wallet_id: string;
  strategy_type: string;
  config: any;
  name: string;
}

export class TestDataFactory {
  static createTestStrategy(overrides: Partial<TestStrategy> = {}): TestStrategy {
    return {
      name: `test_strategy_${Date.now()}`,
      tradingWalletId: 1,
      strategyType: 'wallet-monitor',
      config: {
        walletAddress: '8CvKPRe6u7H4RBkmhfUbfZMKXuC2RSLE5oGYWWKEQw9T',
        percentage: 10
      },
      isActive: true,
      createdAt: new Date().toISOString(),
      ...overrides
    };
  }

  static createStrategyRequest(overrides: Partial<CreateStrategyRequest> = {}): CreateStrategyRequest {
    return {
      trading_wallet_id: '1',
      strategy_type: 'wallet-monitor',
      name: `test_strategy_${Date.now()}`,
      config: {
        walletAddress: this.generateTestPublicKey(),
        percentage: 10
      },
      ...overrides
    };
  }

  static createTestWallet(overrides: Partial<TestWallet> = {}): TestWallet {
    return {
      name: `test_wallet_${Date.now()}`,
      publicKey: this.generateTestPublicKey(), // Generate unique key by default
      mainWalletPubkey: '5ZoNfqXXLinvGHKzsxDYkZge2MGpJT4NNnRCVQB8eqQj', // Use existing user
      createdAt: new Date().toISOString(),
      ...overrides
    };
  }

  static createTestTransaction(overrides: Partial<TestTransaction> = {}): TestTransaction {
    return {
      signature: `test_signature_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      blockTime: Math.floor(Date.now() / 1000),
      slot: Math.floor(Math.random() * 1000000),
      meta: {
        err: null,
        fee: 5000,
        preBalances: [1000000000, 0], // 1 SOL, 0 SOL
        postBalances: [995000000, 0]  // 0.995 SOL, 0 SOL (after fee)
      },
      ...overrides
    };
  }

  static createPriceData(symbol: string, price: number, overrides: Partial<TestPriceData> = {}): TestPriceData {
    return {
      symbol,
      price,
      timestamp: Date.now(),
      change24h: (Math.random() - 0.5) * 20, // Random change between -10% and +10%
      ...overrides
    };
  }

  // Create multiple test strategies
  static createTestStrategies(count: number, baseOverrides: Partial<TestStrategy> = {}): TestStrategy[] {
    return Array.from({ length: count }, (_, index) => 
      this.createTestStrategy({
        name: `test_strategy_${index}_${Date.now()}`,
        ...baseOverrides
      })
    );
  }

  // Create multiple test wallets
  static createTestWallets(count: number, baseOverrides: Partial<TestWallet> = {}): TestWallet[] {
    return Array.from({ length: count }, (_, index) => 
      this.createTestWallet({
        name: `test_wallet_${index}_${Date.now()}`,
        publicKey: this.generateTestPublicKey(), // Ensure each has unique key
        ...baseOverrides
      })
    );
  }

  // Generate a valid-looking Solana public key for testing
  static generateTestPublicKey(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz123456789';
    let result = '';
    for (let i = 0; i < 44; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  // Create test job configurations for different strategy types
  static createWalletMonitorConfig(overrides: any = {}) {
    return {
      walletAddress: this.generateTestPublicKey(),
      percentage: 10,
      ...overrides
    };
  }

  static createPriceMonitorConfig(overrides: any = {}) {
    return {
      targetPrice: 100,
      direction: 'above' as const,
      percentageToSell: 25,
      ...overrides
    };
  }

  static createVaultConfig(overrides: any = {}) {
    return {
      vaultPercentage: 50,
      ...overrides
    };
  }

  static createLevelsConfig(overrides: any = {}) {
    return {
      levels: [
        { price: 90, percentage: 20 },
        { price: 80, percentage: 30 },
        { price: 70, percentage: 50 }
      ],
      ...overrides
    };
  }

  // Mock API responses
  static createMockAPIResponse(data: any, status = 200) {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: vi.fn().mockResolvedValue(data),
      text: vi.fn().mockResolvedValue(JSON.stringify(data))
    };
  }

  // Clean up test data helper
  static getTestDataCleanupQuery() {
    return `
      DELETE FROM strategies WHERE name LIKE 'test_%';
      DELETE FROM trading_wallets WHERE name LIKE 'test_%';
      DELETE FROM saved_wallets WHERE name LIKE 'test_%';
    `;
  }
}
