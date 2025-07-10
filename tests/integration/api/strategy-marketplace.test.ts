import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../../backend/src/server';
import { TestDatabaseManager } from '../../helpers/db-setup';
import { AuthSecurityService } from '../../../backend/src/services/auth-security.service';

describe('Strategy Marketplace API', () => {
  let app: any;
  let testDb: TestDatabaseManager;
  let authService: AuthSecurityService;
  let testUser1: string;
  let testUser2: string;
  let user1Token: string;
  let user2Token: string;
  let publishedStrategy: any;

  beforeEach(async () => {
    app = createApp();
    testDb = new TestDatabaseManager();
    const pool = await testDb.getPool();
    authService = new AuthSecurityService(pool, process.env.JWT_SECRET || 'test-secret');
    
    testUser1 = 'test_user_marketplace_1';
    testUser2 = 'test_user_marketplace_2';
    
    // Create test users
    await pool.query('INSERT INTO users (main_wallet_pubkey) VALUES ($1) ON CONFLICT DO NOTHING', [testUser1]);
    await pool.query('INSERT INTO users (main_wallet_pubkey) VALUES ($1) ON CONFLICT DO NOTHING', [testUser2]);
    
    // Create auth tokens
    user1Token = await authService.createSecureToken(testUser1);
    user2Token = await authService.createSecureToken(testUser2);
    
    // Setup test data
    await setupTestData();
  });

  afterEach(async () => {
    await testDb.cleanupTestData();
  });

  async function setupTestData() {
    const pool = await testDb.getPool();
    
    // Create trading wallet for user1
    const walletResult = await pool.query(`
      INSERT INTO trading_wallets (main_wallet_pubkey, wallet_pubkey, name)
      VALUES ($1, $2, $3)
      RETURNING *
    `, [testUser1, 'test_trading_wallet_market', 'Test Market Wallet']);
    
    const testWallet = walletResult.rows[0];
    
    // Create strategy for user1
    const strategyResult = await pool.query(`
      INSERT INTO strategies (trading_wallet_id, main_wallet_pubkey, strategy_type, config, name)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [testWallet.id, testUser1, 'wallet-monitor', JSON.stringify({ test: true }), 'test_strategy_market']);
    
    const testStrategy = strategyResult.rows[0];
    
    // Add performance data
    const today = new Date().toISOString().split('T')[0];
    await pool.query(`
      INSERT INTO strategy_performance_history (
        strategy_id, date, starting_balance_sol, ending_balance_sol,
        daily_return_sol, daily_return_percentage, trades_executed,
        successful_trades, failed_trades
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [testStrategy.id, today, 100, 110, 10, 10.0, 5, 4, 1]);
    
    // Publish the strategy
    const publishResult = await pool.query(`
      INSERT INTO published_strategies (
        strategy_id, publisher_wallet, title, description, category,
        tags, required_wallets, min_balance_sol, is_free,
        total_roi_percentage, avg_daily_return, total_trades, win_rate
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *
    `, [
      testStrategy.id, testUser1, 'test_published_strategy', 'Test strategy for marketplace',
      'Wallet Monitor', ['test', 'wallet-monitor'], 1, 1.0, true,
      15.5, 0.5, 50, 80.0
    ]);
    
    publishedStrategy = publishResult.rows[0];
    
    // Add wallet requirements
    await pool.query(`
      INSERT INTO strategy_wallet_requirements (
        published_strategy_id, wallet_position, wallet_role, min_balance_sol, description
      ) VALUES ($1, $2, $3, $4, $5)
    `, [publishedStrategy.id, 1, 'primary', 1.0, 'Primary trading wallet']);
  }

  describe('GET /api/shop/strategies', () => {
    it('should return published strategies', async () => {
      const response = await request(app)
        .get('/api/shop/strategies')
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(200);

      expect(response.body.strategies).toHaveLength(1);
      expect(response.body.strategies[0]).toMatchObject({
        id: publishedStrategy.id,
        title: 'test_published_strategy',
        publisher_wallet: testUser1,
        is_active: true
      });
      
      expect(response.body.pagination).toMatchObject({
        currentPage: 1,
        totalItems: 1,
        hasNext: false,
        hasPrev: false
      });
    });

    it('should filter strategies by category', async () => {
      const response = await request(app)
        .get('/api/shop/strategies?category=Wallet Monitor')
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(200);

      expect(response.body.strategies).toHaveLength(1);
      expect(response.body.strategies[0].category).toBe('Wallet Monitor');
    });

    it('should filter strategies by tags', async () => {
      const response = await request(app)
        .get('/api/shop/strategies?tags=test,wallet-monitor')
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(200);

      expect(response.body.strategies).toHaveLength(1);
    });

    it('should filter strategies by minimum rating', async () => {
      const response = await request(app)
        .get('/api/shop/strategies?minRating=1')
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(200);

      expect(response.body.strategies).toHaveLength(1);
    });

    it('should return empty result for high minimum rating', async () => {
      const response = await request(app)
        .get('/api/shop/strategies?minRating=5')
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(200);

      expect(response.body.strategies).toHaveLength(0);
    });

    it('should sort strategies correctly', async () => {
      const response = await request(app)
        .get('/api/shop/strategies?sortBy=rating&sortOrder=desc')
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(200);

      expect(response.body.strategies).toBeDefined();
    });

    it('should paginate results', async () => {
      const response = await request(app)
        .get('/api/shop/strategies?page=1&limit=10')
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(200);

      expect(response.body.pagination.currentPage).toBe(1);
      expect(response.body.strategies.length).toBeLessThanOrEqual(10);
    });
  });

  describe('GET /api/shop/strategies/:id', () => {
    it('should return strategy details', async () => {
      const response = await request(app)
        .get(`/api/shop/strategies/${publishedStrategy.id}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(200);

      expect(response.body.strategy).toMatchObject({
        id: publishedStrategy.id,
        title: 'test_published_strategy',
        publisher_wallet: testUser1
      });
      
      expect(response.body.performance).toMatchObject({
        totalROI: expect.any(Number),
        avgDailyReturn: expect.any(Number),
        totalTrades: expect.any(Number),
        winRate: expect.any(Number)
      });
      
      expect(response.body.walletRequirements).toHaveLength(1);
      expect(response.body.walletRequirements[0]).toMatchObject({
        wallet_position: 1,
        wallet_role: 'primary',
        min_balance_sol: 1.0
      });
      
      expect(response.body.publisher).toMatchObject({
        wallet: testUser1,
        publishedStrategies: expect.any(Number),
        totalDownloads: expect.any(Number)
      });
    });

    it('should return 404 for non-existent strategy', async () => {
      const response = await request(app)
        .get('/api/shop/strategies/99999')
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(404);

      expect(response.body.error).toBe('Strategy not found');
    });

    it('should return 400 for invalid strategy ID', async () => {
      const response = await request(app)
        .get('/api/shop/strategies/invalid')
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(400);

      expect(response.body.error).toBe('Invalid strategy ID');
    });
  });

  describe('POST /api/shop/strategies/:id/adopt', () => {
    let user2Wallet: any;

    beforeEach(async () => {
      // Create trading wallet for user2
      const pool = await testDb.getPool();
      const walletResult = await pool.query(`
        INSERT INTO trading_wallets (main_wallet_pubkey, wallet_pubkey, name)
        VALUES ($1, $2, $3)
        RETURNING *
      `, [testUser2, 'test_adopter_wallet', 'Test Adopter Wallet']);
      
      user2Wallet = walletResult.rows[0];
    });

    it('should adopt strategy successfully', async () => {
      const adoptionData = {
        walletMapping: {
          1: user2Wallet.id
        },
        customizations: {
          name: 'My Adopted Strategy'
        }
      };

      const response = await request(app)
        .post(`/api/shop/strategies/${publishedStrategy.id}/adopt`)
        .set('Authorization', `Bearer ${user2Token}`)
        .send(adoptionData)
        .expect(201);

      expect(response.body).toMatchObject({
        adoptionId: expect.any(Number),
        createdStrategies: expect.arrayContaining([
          expect.objectContaining({
            strategyId: expect.any(Number),
            walletId: user2Wallet.id,
            walletName: expect.any(String)
          })
        ]),
        message: expect.stringContaining('Successfully adopted strategy')
      });

      // Verify adoption was recorded
      const pool = await testDb.getPool();
      const adoptions = await pool.query(
        'SELECT * FROM strategy_adoptions WHERE adopter_wallet = $1',
        [testUser2]
      );
      expect(adoptions.rows).toHaveLength(1);
    });

    it('should fail to adopt with invalid wallet mapping', async () => {
      const adoptionData = {
        walletMapping: {
          1: 99999 // Non-existent wallet
        }
      };

      const response = await request(app)
        .post(`/api/shop/strategies/${publishedStrategy.id}/adopt`)
        .set('Authorization', `Bearer ${user2Token}`)
        .send(adoptionData)
        .expect(400);

      expect(response.body.error).toContain('not found or not owned by user');
    });

    it('should fail to adopt already adopted strategy', async () => {
      const adoptionData = {
        walletMapping: {
          1: user2Wallet.id
        }
      };

      // First adoption
      await request(app)
        .post(`/api/shop/strategies/${publishedStrategy.id}/adopt`)
        .set('Authorization', `Bearer ${user2Token}`)
        .send(adoptionData)
        .expect(201);

      // Second adoption should fail
      const response = await request(app)
        .post(`/api/shop/strategies/${publishedStrategy.id}/adopt`)
        .set('Authorization', `Bearer ${user2Token}`)
        .send(adoptionData)
        .expect(400);

      expect(response.body.error).toBe('You have already adopted this strategy');
    });

    it('should validate adoption request data', async () => {
      const invalidAdoptionData = {
        walletMapping: {} // Empty mapping
      };

      const response = await request(app)
        .post(`/api/shop/strategies/${publishedStrategy.id}/adopt`)
        .set('Authorization', `Bearer ${user2Token}`)
        .send(invalidAdoptionData)
        .expect(400);

      expect(response.body.errors).toContain('Wallet mapping is required');
    });
  });

  describe('GET /api/shop/strategies/:id/check-adoption', () => {
    it('should return false for non-adopted strategy', async () => {
      const response = await request(app)
        .get(`/api/shop/strategies/${publishedStrategy.id}/check-adoption`)
        .set('Authorization', `Bearer ${user2Token}`)
        .expect(200);

      expect(response.body.hasAdopted).toBe(false);
    });

    it('should return true for adopted strategy', async () => {
      // First adopt the strategy
      const pool = await testDb.getPool();
      const walletResult = await pool.query(`
        INSERT INTO trading_wallets (main_wallet_pubkey, wallet_pubkey, name)
        VALUES ($1, $2, $3)
        RETURNING *
      `, [testUser2, 'test_adopter_wallet_check', 'Test Adopter Wallet']);
      
      const user2Wallet = walletResult.rows[0];
      
      await pool.query(`
        INSERT INTO strategy_adoptions (
          published_strategy_id, adopter_wallet, adopted_strategy_id, wallet_mapping
        ) VALUES ($1, $2, $3, $4)
      `, [publishedStrategy.id, testUser2, 1, JSON.stringify({ 1: user2Wallet.id })]);

      const response = await request(app)
        .get(`/api/shop/strategies/${publishedStrategy.id}/check-adoption`)
        .set('Authorization', `Bearer ${user2Token}`)
        .expect(200);

      expect(response.body.hasAdopted).toBe(true);
    });
  });

  describe('GET /api/shop/my-adoptions', () => {
    it('should return user adoptions', async () => {
      // Create adoption first
      const pool = await testDb.getPool();
      const walletResult = await pool.query(`
        INSERT INTO trading_wallets (main_wallet_pubkey, wallet_pubkey, name)
        VALUES ($1, $2, $3)
        RETURNING *
      `, [testUser2, 'test_adopter_wallet_my', 'Test Adopter Wallet']);
      
      const user2Wallet = walletResult.rows[0];
      
      await pool.query(`
        INSERT INTO strategy_adoptions (
          published_strategy_id, adopter_wallet, adopted_strategy_id, wallet_mapping
        ) VALUES ($1, $2, $3, $4)
      `, [publishedStrategy.id, testUser2, 1, JSON.stringify({ 1: user2Wallet.id })]);

      const response = await request(app)
        .get('/api/shop/my-adoptions')
        .set('Authorization', `Bearer ${user2Token}`)
        .expect(200);

      expect(response.body).toHaveLength(1);
      expect(response.body[0]).toMatchObject({
        published_strategy_id: publishedStrategy.id,
        adopter_wallet: testUser2,
        strategy_title: 'test_published_strategy'
      });
    });

    it('should return empty array for user with no adoptions', async () => {
      const response = await request(app)
        .get('/api/shop/my-adoptions')
        .set('Authorization', `Bearer ${user2Token}`)
        .expect(200);

      expect(response.body).toHaveLength(0);
    });
  });

  describe('GET /api/shop/strategies/search', () => {
    it('should search strategies by title', async () => {
      const response = await request(app)
        .get('/api/shop/strategies/search?q=test_published')
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(200);

      expect(response.body.strategies).toHaveLength(1);
      expect(response.body.strategies[0].title).toContain('test_published');
    });

    it('should search strategies by description', async () => {
      const response = await request(app)
        .get('/api/shop/strategies/search?q=marketplace')
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(200);

      expect(response.body.strategies).toHaveLength(1);
    });

    it('should return empty results for non-matching search', async () => {
      const response = await request(app)
        .get('/api/shop/strategies/search?q=nonexistent')
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(200);

      expect(response.body.strategies).toHaveLength(0);
    });

    it('should require search term', async () => {
      const response = await request(app)
        .get('/api/shop/strategies/search')
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(400);

      expect(response.body.error).toBe('Search term is required');
    });
  });

  describe('GET /api/shop/categories', () => {
    it('should return strategy categories', async () => {
      const response = await request(app)
        .get('/api/shop/categories')
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(200);

      expect(response.body.categories).toContain('Wallet Monitor');
      expect(response.body.categories).toContain('Price Monitor');
      expect(response.body.categories).toContain('DCA');
    });
  });

  describe('GET /api/shop/featured', () => {
    it('should return featured strategies', async () => {
      const response = await request(app)
        .get('/api/shop/featured')
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(200);

      expect(response.body.strategies).toBeDefined();
      expect(Array.isArray(response.body.strategies)).toBe(true);
    });
  });

  describe('Authentication', () => {
    it('should require authentication for all endpoints', async () => {
      const endpoints = [
        '/api/shop/strategies',
        `/api/shop/strategies/${publishedStrategy.id}`,
        '/api/shop/my-adoptions',
        '/api/shop/categories'
      ];

      for (const endpoint of endpoints) {
        const response = await request(app)
          .get(endpoint)
          .expect(401);

        expect(response.body.error).toBe('No token provided');
      }
    });

    it('should reject invalid tokens', async () => {
      const response = await request(app)
        .get('/api/shop/strategies')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);

      expect(response.body.error).toBe('Invalid or expired token');
    });
  });
});