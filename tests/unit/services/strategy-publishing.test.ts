import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StrategyPublishingService } from '../../../backend/src/services/strategy-publishing.service';
import { TestDatabaseManager } from '../../helpers/db-setup';

describe('StrategyPublishingService', () => {
  let service: StrategyPublishingService;
  let testDb: TestDatabaseManager;
  let testUser: string;
  let testStrategy: any;
  let testWallet: any;

  beforeEach(async () => {
    testDb = new TestDatabaseManager();
    const pool = await testDb.setupTestDatabase();
    service = new StrategyPublishingService();
    
    // Create test data
    testUser = 'test_user_publishing';
    
    // Create test user
    await pool.query('INSERT INTO users (main_wallet_pubkey) VALUES ($1) ON CONFLICT DO NOTHING', [testUser]);
    
    // Create test trading wallet
    const walletResult = await pool.query(`
      INSERT INTO trading_wallets (main_wallet_pubkey, wallet_pubkey, name)
      VALUES ($1, $2, $3)
      RETURNING *
    `, [testUser, 'test_trading_wallet_pub', 'Test Trading Wallet']);
    testWallet = walletResult.rows[0];
    
    // Create test strategy
    const strategyResult = await pool.query(`
      INSERT INTO strategies (trading_wallet_id, main_wallet_pubkey, strategy_type, config, name)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [testWallet.id, testUser, 'wallet-monitor', JSON.stringify({ test: true }), 'test_strategy_publish']);
    testStrategy = strategyResult.rows[0];
    
    // Add test performance data
    const today = new Date().toISOString().split('T')[0];
    await pool.query(`
      INSERT INTO strategy_performance_history (
        strategy_id, date, starting_balance_sol, ending_balance_sol,
        daily_return_sol, daily_return_percentage, starting_balance_usd,
        ending_balance_usd, daily_return_usd, trades_executed,
        successful_trades, failed_trades, max_drawdown, volatility
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    `, [
      testStrategy.id, today, 100, 105, 5, 5.0, 10000, 10500, 500,
      10, 7, 3, 2.5, 1.8
    ]);
  });

  describe('calculatePerformanceMetrics', () => {
    it('should calculate performance metrics correctly', async () => {
      const metrics = await service.calculatePerformanceMetrics(testStrategy.id);
      
      expect(metrics).toMatchObject({
        totalROI: expect.any(Number),
        avgDailyReturn: expect.any(Number),
        maxDrawdown: expect.any(Number),
        totalTrades: expect.any(Number),
        winRate: expect.any(Number),
        volatility: expect.any(Number)
      });
      
      expect(metrics.totalTrades).toBeGreaterThan(0);
      expect(metrics.winRate).toBeGreaterThanOrEqual(0);
      expect(metrics.winRate).toBeLessThanOrEqual(100);
    });

    it('should handle strategy with no performance data', async () => {
      // Create strategy without performance data
      const pool = await testDb.getPool();
      const strategyResult = await pool.query(`
        INSERT INTO strategies (trading_wallet_id, main_wallet_pubkey, strategy_type, config, name)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      `, [testWallet.id, testUser, 'price-monitor', JSON.stringify({ test: true }), 'test_strategy_no_perf']);
      
      const noDataStrategy = strategyResult.rows[0];
      const metrics = await service.calculatePerformanceMetrics(noDataStrategy.id);
      
      expect(metrics.totalTrades).toBe(0);
      expect(metrics.totalROI).toBe(0);
      expect(metrics.avgDailyReturn).toBe(0);
    });
  });

  describe('validateForPublishing', () => {
    it('should validate strategy successfully', async () => {
      const validation = await service.validateForPublishing(testStrategy.id);
      
      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should fail validation for non-existent strategy', async () => {
      const validation = await service.validateForPublishing(99999);
      
      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('Strategy not found');
    });

    it('should fail validation for inactive strategy', async () => {
      const pool = await testDb.getPool();
      await pool.query('UPDATE strategies SET is_active = false WHERE id = $1', [testStrategy.id]);
      
      const validation = await service.validateForPublishing(testStrategy.id);
      
      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('Strategy must be active to publish');
    });

    it('should warn about insufficient performance history', async () => {
      const pool = await testDb.getPool();
      
      // Create strategy with minimal performance data
      const strategyResult = await pool.query(`
        INSERT INTO strategies (trading_wallet_id, main_wallet_pubkey, strategy_type, config, name)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      `, [testWallet.id, testUser, 'price-monitor', JSON.stringify({ test: true }), 'test_strategy_min_perf']);
      
      const minPerfStrategy = strategyResult.rows[0];
      
      // Add only 3 days of performance data
      for (let i = 0; i < 3; i++) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        await pool.query(`
          INSERT INTO strategy_performance_history (
            strategy_id, date, starting_balance_sol, ending_balance_sol,
            daily_return_sol, daily_return_percentage, trades_executed
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [minPerfStrategy.id, date.toISOString().split('T')[0], 100, 101, 1, 1.0, 1]);
      }
      
      const validation = await service.validateForPublishing(minPerfStrategy.id);
      
      expect(validation.isValid).toBe(true);
      expect(validation.warnings).toContain('Strategy has less than 7 days of performance history');
    });
  });

  describe('publishStrategy', () => {
    it('should publish strategy successfully', async () => {
      const publishData = {
        title: 'Test Published Strategy',
        description: 'A test strategy for unit testing',
        category: 'Wallet Monitor',
        tags: ['test', 'wallet-monitor'],
        requiredWallets: 1,
        walletRequirements: [{
          position: 1,
          role: 'primary',
          minBalance: 1.0,
          description: 'Primary trading wallet'
        }],
        minBalanceSol: 1.0,
        isFree: true,
        priceSol: 0
      };

      const publishedStrategy = await service.publishStrategy(testStrategy.id, publishData, testUser);
      
      expect(publishedStrategy).toMatchObject({
        strategy_id: testStrategy.id,
        publisher_wallet: testUser,
        title: publishData.title,
        description: publishData.description,
        category: publishData.category,
        required_wallets: publishData.requiredWallets,
        is_free: true,
        is_active: true
      });
      
      expect(publishedStrategy.id).toBeDefined();
      expect(publishedStrategy.total_roi_percentage).toBeDefined();
    });

    it('should fail to publish non-owned strategy', async () => {
      const publishData = {
        title: 'Test Published Strategy',
        description: 'A test strategy for unit testing',
        category: 'Wallet Monitor',
        tags: ['test'],
        requiredWallets: 1,
        walletRequirements: [{
          position: 1,
          role: 'primary',
          minBalance: 1.0,
          description: 'Primary trading wallet'
        }],
        minBalanceSol: 1.0,
        isFree: true
      };

      await expect(service.publishStrategy(testStrategy.id, publishData, 'different_user'))
        .rejects.toThrow('Strategy not found or not owned by user');
    });

    it('should create wallet requirements correctly', async () => {
      const publishData = {
        title: 'Multi-Wallet Strategy',
        description: 'Strategy requiring multiple wallets',
        category: 'Grid Trading',
        tags: ['multi-wallet'],
        requiredWallets: 2,
        walletRequirements: [
          {
            position: 1,
            role: 'primary',
            minBalance: 5.0,
            description: 'Primary trading wallet',
            requiredTokens: ['token1'],
            permissions: ['trade']
          },
          {
            position: 2,
            role: 'vault',
            minBalance: 10.0,
            description: 'Vault wallet for storage'
          }
        ],
        minBalanceSol: 15.0,
        isFree: true
      };

      const publishedStrategy = await service.publishStrategy(testStrategy.id, publishData, testUser);
      const requirements = await service.getWalletRequirements(publishedStrategy.id);
      
      expect(requirements).toHaveLength(2);
      expect(requirements[0]).toMatchObject({
        wallet_position: 1,
        wallet_role: 'primary',
        min_balance_sol: 5.0,
        description: 'Primary trading wallet'
      });
      expect(requirements[1]).toMatchObject({
        wallet_position: 2,
        wallet_role: 'vault',
        min_balance_sol: 10.0,
        description: 'Vault wallet for storage'
      });
    });
  });

  describe('updatePublishedStrategy', () => {
    let publishedStrategy: any;

    beforeEach(async () => {
      const publishData = {
        title: 'Original Title',
        description: 'Original description',
        category: 'Wallet Monitor',
        tags: ['original'],
        requiredWallets: 1,
        walletRequirements: [{
          position: 1,
          role: 'primary',
          minBalance: 1.0,
          description: 'Primary wallet'
        }],
        minBalanceSol: 1.0,
        isFree: true
      };

      publishedStrategy = await service.publishStrategy(testStrategy.id, publishData, testUser);
    });

    it('should update strategy title and description', async () => {
      const updateData = {
        title: 'Updated Title',
        description: 'Updated description'
      };

      const updated = await service.updatePublishedStrategy(publishedStrategy.id, updateData, testUser);
      
      expect(updated.title).toBe('Updated Title');
      expect(updated.description).toBe('Updated description');
      expect(updated.category).toBe('Wallet Monitor'); // Should remain unchanged
    });

    it('should update strategy status', async () => {
      const updateData = { isActive: false };

      const updated = await service.updatePublishedStrategy(publishedStrategy.id, updateData, testUser);
      
      expect(updated.is_active).toBe(false);
    });

    it('should fail to update non-owned strategy', async () => {
      const updateData = { title: 'Unauthorized Update' };

      await expect(service.updatePublishedStrategy(publishedStrategy.id, updateData, 'different_user'))
        .rejects.toThrow('Published strategy not found or not owned by user');
    });
  });

  describe('unpublishStrategy', () => {
    let publishedStrategy: any;

    beforeEach(async () => {
      const publishData = {
        title: 'Strategy to Unpublish',
        description: 'Will be unpublished',
        category: 'Test',
        tags: ['test'],
        requiredWallets: 1,
        walletRequirements: [{
          position: 1,
          role: 'primary',
          minBalance: 1.0,
          description: 'Primary wallet'
        }],
        minBalanceSol: 1.0,
        isFree: true
      };

      publishedStrategy = await service.publishStrategy(testStrategy.id, publishData, testUser);
    });

    it('should unpublish strategy successfully', async () => {
      await service.unpublishStrategy(publishedStrategy.id, testUser);
      
      const unpublished = await service.getPublishedStrategy(publishedStrategy.id);
      expect(unpublished?.is_active).toBe(false);
    });

    it('should fail to unpublish non-owned strategy', async () => {
      await expect(service.unpublishStrategy(publishedStrategy.id, 'different_user'))
        .rejects.toThrow('Published strategy not found or not owned by user');
    });
  });

  describe('recordPerformanceHistory', () => {
    it('should record performance data successfully', async () => {
      const performanceData = {
        strategy_id: testStrategy.id,
        date: '2024-01-01',
        starting_balance_sol: 100,
        ending_balance_sol: 105,
        daily_return_sol: 5,
        daily_return_percentage: 5.0,
        starting_balance_usd: 10000,
        ending_balance_usd: 10500,
        daily_return_usd: 500,
        trades_executed: 5,
        successful_trades: 4,
        failed_trades: 1,
        max_drawdown: 1.5,
        volatility: 2.3
      };

      const recorded = await service.recordPerformanceHistory(testStrategy.id, performanceData);
      
      expect(recorded).toMatchObject({
        strategy_id: testStrategy.id,
        date: '2024-01-01',
        daily_return_percentage: 5.0,
        trades_executed: 5
      });
    });

    it('should handle duplicate date records (upsert)', async () => {
      const performanceData = {
        strategy_id: testStrategy.id,
        date: '2024-01-01',
        starting_balance_sol: 100,
        ending_balance_sol: 102,
        daily_return_sol: 2,
        daily_return_percentage: 2.0,
        starting_balance_usd: 10000,
        ending_balance_usd: 10200,
        daily_return_usd: 200,
        trades_executed: 3,
        successful_trades: 3,
        failed_trades: 0,
        max_drawdown: 0,
        volatility: 1.0
      };

      // Record first time
      await service.recordPerformanceHistory(testStrategy.id, performanceData);
      
      // Update with different values
      performanceData.ending_balance_sol = 108;
      performanceData.daily_return_percentage = 8.0;
      
      const updated = await service.recordPerformanceHistory(testStrategy.id, performanceData);
      
      expect(updated.daily_return_percentage).toBe(8.0);
      expect(updated.ending_balance_sol).toBe(108);
    });
  });

  describe('getPerformanceHistory', () => {
    beforeEach(async () => {
      // Add multiple days of performance data
      const dates = ['2024-01-01', '2024-01-02', '2024-01-03'];
      
      for (const date of dates) {
        await service.recordPerformanceHistory(testStrategy.id, {
          strategy_id: testStrategy.id,
          date,
          starting_balance_sol: 100,
          ending_balance_sol: 101,
          daily_return_sol: 1,
          daily_return_percentage: 1.0,
          starting_balance_usd: 10000,
          ending_balance_usd: 10100,
          daily_return_usd: 100,
          trades_executed: 2,
          successful_trades: 2,
          failed_trades: 0,
          max_drawdown: 0,
          volatility: 0.5
        });
      }
    });

    it('should get all performance history', async () => {
      const history = await service.getPerformanceHistory(testStrategy.id);
      
      expect(history.length).toBeGreaterThanOrEqual(3);
      expect(history[0].date).toBeDefined();
      expect(history[0].daily_return_percentage).toBe(1.0);
    });

    it('should filter by date range', async () => {
      const history = await service.getPerformanceHistory(
        testStrategy.id,
        '2024-01-01',
        '2024-01-02'
      );
      
      expect(history.length).toBe(2);
      expect(history.every(h => h.date >= '2024-01-01' && h.date <= '2024-01-02')).toBe(true);
    });
  });
});