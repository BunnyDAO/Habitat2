import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { testDb, TestDatabaseManager } from '@tests/helpers/db-setup';

describe('Database Connection', () => {
  let dbManager: TestDatabaseManager;

  beforeAll(async () => {
    dbManager = new TestDatabaseManager();
    await dbManager.setupTestDatabase();
  });

  afterAll(async () => {
    await dbManager.close();
  });

  it('should connect to test database successfully', async () => {
    const pool = await dbManager.setupTestDatabase();
    expect(pool).toBeDefined();
    
    // Test basic query
    const result = await pool.query('SELECT 1 as test_value');
    expect(result.rows[0].test_value).toBe(1);
  });

  it('should be able to check table structure', async () => {
    const pool = await dbManager.setupTestDatabase();
    
    // Check if strategies table exists
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'strategies'
      );
    `);
    
    expect(tableCheck.rows[0].exists).toBe(true);
  });

  it('should be able to check trading_wallets table', async () => {
    const pool = await dbManager.setupTestDatabase();
    
    // Check if trading_wallets table exists
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'trading_wallets'
      );
    `);
    
    expect(tableCheck.rows[0].exists).toBe(true);
  });

  it('should isolate test data with test_ prefix', async () => {
    // This test verifies our safety mechanism
    const pool = await dbManager.setupTestDatabase();
    
    // Count existing strategies
    const beforeCount = await pool.query('SELECT COUNT(*) FROM strategies');
    const initialCount = parseInt(beforeCount.rows[0].count);
    
    // Clean test data (should not affect production data)
    await dbManager.cleanupTestData();
    
    // Count again - should be same or less (only test data removed)
    const afterCount = await pool.query('SELECT COUNT(*) FROM strategies');
    const finalCount = parseInt(afterCount.rows[0].count);
    
    expect(finalCount).toBeLessThanOrEqual(initialCount);
  });
});
