import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { testDb } from '@tests/helpers/db-setup';
import { TestDataFactory } from '@tests/helpers/test-data-factory';

describe('Database Strategies Integration', () => {
  beforeAll(async () => {
    await testDb.setupTestDatabase();
  });

  afterAll(async () => {
    await testDb.cleanupTestData();
    await testDb.close();
  });

  beforeEach(async () => {
    await testDb.cleanupTestData();
  });

  it('should create and retrieve a test strategy', async () => {
    // Create test wallet first
    const testWallet = TestDataFactory.createTestWallet();
    const walletId = await testDb.createTestWallet(testWallet);

    // Create test strategy
    const testStrategy = TestDataFactory.createTestStrategy({
      tradingWalletId: walletId,
      strategyType: 'wallet-monitor',
      config: TestDataFactory.createWalletMonitorConfig()
    });

    const strategyId = await testDb.createTestStrategy(testStrategy);
    expect(strategyId).toBeGreaterThan(0);

    // Verify strategy was created
    const pool = await testDb.setupTestDatabase();
    const result = await pool.query(
      'SELECT * FROM strategies WHERE id = $1',
      [strategyId]
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].name).toBe(testStrategy.name);
    expect(result.rows[0].strategy_type).toBe(testStrategy.strategyType);
    expect(result.rows[0].is_active).toBe(true);
  });

  it('should create multiple strategies for the same wallet', async () => {
    // Create test wallet
    const testWallet = TestDataFactory.createTestWallet();
    const walletId = await testDb.createTestWallet(testWallet);

    // Create multiple strategies
    const strategies = TestDataFactory.createTestStrategies(3, {
      tradingWalletId: walletId
    });

    const strategyIds = [];
    for (const strategy of strategies) {
      const id = await testDb.createTestStrategy(strategy);
      strategyIds.push(id);
    }

    expect(strategyIds).toHaveLength(3);
    expect(strategyIds.every(id => id > 0)).toBe(true);

    // Verify all strategies exist
    const pool = await testDb.setupTestDatabase();
    const result = await pool.query(
      'SELECT COUNT(*) FROM strategies WHERE trading_wallet_id = $1 AND name LIKE $2',
      [walletId, 'test_%']
    );

    expect(parseInt(result.rows[0].count)).toBe(3);
  });

  it('should handle different strategy types correctly', async () => {
    // Create test wallet
    const testWallet = TestDataFactory.createTestWallet();
    const walletId = await testDb.createTestWallet(testWallet);

    // Create different strategy types
    const strategies = [
      TestDataFactory.createTestStrategy({
        tradingWalletId: walletId,
        strategyType: 'wallet-monitor',
        config: TestDataFactory.createWalletMonitorConfig()
      }),
      TestDataFactory.createTestStrategy({
        tradingWalletId: walletId,
        strategyType: 'price-monitor',
        config: TestDataFactory.createPriceMonitorConfig()
      }),
      TestDataFactory.createTestStrategy({
        tradingWalletId: walletId,
        strategyType: 'vault',
        config: TestDataFactory.createVaultConfig()
      }),
      TestDataFactory.createTestStrategy({
        tradingWalletId: walletId,
        strategyType: 'levels',
        config: TestDataFactory.createLevelsConfig()
      })
    ];

    // Create all strategies
    for (const strategy of strategies) {
      const id = await testDb.createTestStrategy(strategy);
      expect(id).toBeGreaterThan(0);
    }

    // Verify different types exist
    const pool = await testDb.setupTestDatabase();
    const result = await pool.query(
      'SELECT strategy_type, COUNT(*) FROM strategies WHERE trading_wallet_id = $1 AND name LIKE $2 GROUP BY strategy_type',
      [walletId, 'test_%']
    );

    expect(result.rows).toHaveLength(4);
    const strategyTypes = result.rows.map(row => row.strategy_type);
    expect(strategyTypes).toContain('wallet-monitor');
    expect(strategyTypes).toContain('price-monitor');
    expect(strategyTypes).toContain('vault');
    expect(strategyTypes).toContain('levels');
  });

  it('should clean up test data without affecting other data', async () => {
    const pool = await testDb.setupTestDatabase();
    
    // Count existing strategies
    const beforeCount = await pool.query('SELECT COUNT(*) FROM strategies');
    const initialCount = parseInt(beforeCount.rows[0].count);

    // Create test data
    const testWallet = TestDataFactory.createTestWallet();
    const walletId = await testDb.createTestWallet(testWallet);
    await testDb.createTestStrategy(TestDataFactory.createTestStrategy({
      tradingWalletId: walletId
    }));

    // Verify test data was created
    const withTestCount = await pool.query('SELECT COUNT(*) FROM strategies');
    expect(parseInt(withTestCount.rows[0].count)).toBe(initialCount + 1);

    // Clean up test data
    await testDb.cleanupTestData();

    // Verify only test data was removed
    const afterCount = await pool.query('SELECT COUNT(*) FROM strategies');
    expect(parseInt(afterCount.rows[0].count)).toBe(initialCount);
  });
});
