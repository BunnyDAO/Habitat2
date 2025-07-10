import { Pool } from 'pg';
import dotenv from 'dotenv';
import path from 'path';

// Load test environment variables
const envPath = path.resolve(__dirname, '../../backend/.env.test');
dotenv.config({ path: envPath });

export class TestDatabaseManager {
  private pool: Pool | null = null;

  async setupTestDatabase(): Promise<Pool> {
    if (this.pool) {
      return this.pool;
    }

    const dbUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
    if (!dbUrl) {
      throw new Error('TEST_DATABASE_URL or DATABASE_URL environment variable is not set');
    }

    this.pool = new Pool({
      connectionString: dbUrl,
      ssl: {
        rejectUnauthorized: false
      }
    });

    // Test the connection
    try {
      await this.pool.query('SELECT 1');
      console.log('✅ Test database connected successfully');
    } catch (error) {
      console.error('❌ Test database connection failed:', error);
      throw error;
    }

    return this.pool;
  }

  async seedTestData(): Promise<void> {
    if (!this.pool) {
      throw new Error('Database not initialized. Call setupTestDatabase() first.');
    }

    try {
      // Start transaction
      await this.pool.query('BEGIN');

      // Clean existing test data (use test_ prefix for safety)
      await this.pool.query(`
        DELETE FROM strategies WHERE id::text LIKE 'test_%' OR name LIKE 'test_%';
        DELETE FROM trading_wallets WHERE name LIKE 'test_%';
        DELETE FROM saved_wallets WHERE name LIKE 'test_%';
      `);

      // Get an existing user for testing (or create one)
      let testMainWallet = '5ZoNfqXXLinvGHKzsxDYkZge2MGpJT4NNnRCVQB8eqQj'; // Use existing user
      
      // Verify user exists, if not create one
      const userCheck = await this.pool.query(
        'SELECT main_wallet_pubkey FROM users WHERE main_wallet_pubkey = $1',
        [testMainWallet]
      );
      
      if (userCheck.rows.length === 0) {
        // Create test user if it doesn't exist
        await this.pool.query(`
          INSERT INTO users (main_wallet_pubkey, created_at, updated_at)
          VALUES ($1, NOW(), NOW())
          ON CONFLICT (main_wallet_pubkey) DO NOTHING
        `, [testMainWallet]);
      }

      // Insert test data
      const testWalletId = await this.createTestWallet({
        name: 'test_wallet_1',
        publicKey: '5ZoNfqXXLinvGHKj1DCd1YSVcrfEKBK8oFQ2ZJZfHk7g',
        mainWalletPubkey: testMainWallet
      });

      await this.createTestStrategy({
        name: 'test_strategy_1',
        tradingWalletId: testWalletId,
        strategyType: 'wallet-monitor',
        config: {
          walletAddress: '8CvKPRe6u7H4RBkmhfUbfZMKXuC2RSLE5oGYWWKEQw9T',
          percentage: 10
        }
      });

      // Commit transaction
      await this.pool.query('COMMIT');
      console.log('✅ Test data seeded successfully');
    } catch (error) {
      // Rollback on error
      await this.pool.query('ROLLBACK');
      console.error('❌ Error seeding test data:', error);
      throw error;
    }
  }

  async cleanupTestData(): Promise<void> {
    if (!this.pool) {
      return;
    }

    try {
      // Clean up test data in correct order (foreign key constraints)
      await this.pool.query(`BEGIN`);
      
      // Strategy publishing tables
      await this.pool.query(`DELETE FROM strategy_reviews WHERE published_strategy_id IN (SELECT id FROM published_strategies WHERE title LIKE 'test_%')`);
      await this.pool.query(`DELETE FROM strategy_adoptions WHERE published_strategy_id IN (SELECT id FROM published_strategies WHERE title LIKE 'test_%')`);
      await this.pool.query(`DELETE FROM published_strategies WHERE title LIKE 'test_%'`);
      await this.pool.query(`DELETE FROM strategy_performance_history WHERE strategy_id IN (SELECT id FROM strategies WHERE name LIKE 'test_%')`);
      await this.pool.query(`DELETE FROM strategy_wallet_requirements WHERE published_strategy_id IN (SELECT id FROM published_strategies WHERE title LIKE 'test_%')`);
      
      // Security tables
      await this.pool.query(`DELETE FROM auth_sessions WHERE wallet_address LIKE 'test_%'`);
      await this.pool.query(`DELETE FROM auth_attempts WHERE wallet_address LIKE 'test_%'`);
      await this.pool.query(`DELETE FROM audit_logs WHERE wallet_address LIKE 'test_%'`);
      await this.pool.query(`DELETE FROM api_rate_limits WHERE identifier LIKE 'test_%'`);
      await this.pool.query(`DELETE FROM security_incidents WHERE wallet_address LIKE 'test_%'`);
      
      // Core tables
      await this.pool.query(`DELETE FROM strategies WHERE name LIKE 'test_%'`);
      await this.pool.query(`DELETE FROM trading_wallets WHERE name LIKE 'test_%'`);
      await this.pool.query(`DELETE FROM saved_wallets WHERE name LIKE 'test_%'`);
      await this.pool.query(`DELETE FROM users WHERE main_wallet_pubkey LIKE 'test_%'`);
      
      await this.pool.query(`COMMIT`);
      console.log('✅ Test data cleaned up successfully');
    } catch (error) {
      await this.pool.query(`ROLLBACK`);
      console.error('❌ Error cleaning up test data:', error);
      throw error;
    }
  }

  async resetDatabase(): Promise<void> {
    await this.cleanupTestData();
    await this.seedTestData();
  }

  async createTestStrategy(params: CreateStrategyParams): Promise<number> {
    if (!this.pool) {
      throw new Error('Database not initialized');
    }

    // Get the main wallet pubkey from the trading wallet
    const walletResult = await this.pool.query(
      'SELECT main_wallet_pubkey FROM trading_wallets WHERE id = $1',
      [params.tradingWalletId]
    );

    if (walletResult.rows.length === 0) {
      throw new Error(`Trading wallet with id ${params.tradingWalletId} not found`);
    }

    const mainWalletPubkey = walletResult.rows[0].main_wallet_pubkey;

    const result = await this.pool.query(`
      INSERT INTO strategies (
        trading_wallet_id, 
        main_wallet_pubkey,
        strategy_type, 
        config, 
        is_active, 
        name,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
      RETURNING id
    `, [
      params.tradingWalletId,
      mainWalletPubkey,
      params.strategyType,
      JSON.stringify(params.config),
      params.isActive ?? true,
      params.name
    ]);

    return result.rows[0].id;
  }

  async createTestWallet(params: CreateWalletParams): Promise<number> {
    if (!this.pool) {
      throw new Error('Database not initialized');
    }

    const result = await this.pool.query(`
      INSERT INTO trading_wallets (
        name,
        wallet_pubkey,
        main_wallet_pubkey,
        created_at
      ) VALUES ($1, $2, $3, NOW())
      RETURNING id
    `, [
      params.name,
      params.publicKey,
      params.mainWalletPubkey
    ]);

    return result.rows[0].id;
  }

  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      console.log('✅ Test database connection closed');
    }
  }

  /**
   * Get the database pool for direct queries
   */
  async getPool(): Promise<Pool> {
    if (!this.pool) {
      await this.setupTestDatabase();
    }
    return this.pool!;
  }
}

export interface CreateStrategyParams {
  name: string;
  tradingWalletId: number;
  strategyType: string;
  config: any;
  isActive?: boolean;
}

export interface CreateWalletParams {
  name: string;
  publicKey: string;
  mainWalletPubkey: string;
}

// Singleton instance for tests
export const testDb = new TestDatabaseManager();
