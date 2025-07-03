import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { testDb } from '@tests/helpers/db-setup';
import { TestDataFactory } from '@tests/helpers/test-data-factory';

describe('Database Wallets Integration', () => {
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

  it('should create and retrieve a test wallet', async () => {
    const testWallet = TestDataFactory.createTestWallet({
      name: 'test_wallet_creation',
      publicKey: TestDataFactory.generateTestPublicKey() // Generate unique key
    });

    const walletId = await testDb.createTestWallet(testWallet);
    expect(walletId).toBeGreaterThan(0);

    // Verify wallet was created
    const pool = await testDb.setupTestDatabase();
    const result = await pool.query(
      'SELECT * FROM trading_wallets WHERE id = $1',
      [walletId]
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].name).toBe(testWallet.name);
    expect(result.rows[0].wallet_pubkey).toBe(testWallet.publicKey);
    expect(result.rows[0].main_wallet_pubkey).toBe(testWallet.mainWalletPubkey);
  });

  it('should create multiple wallets for the same main wallet', async () => {
    const mainWalletPubkey = '5ZoNfqXXLinvGHKzsxDYkZge2MGpJT4NNnRCVQB8eqQj'; // Use existing user
    
    const testWallets = TestDataFactory.createTestWallets(3, {
      mainWalletPubkey
    });

    const walletIds = [];
    for (const wallet of testWallets) {
      const id = await testDb.createTestWallet(wallet);
      walletIds.push(id);
    }

    expect(walletIds).toHaveLength(3);
    expect(walletIds.every(id => id > 0)).toBe(true);

    // Verify all wallets exist for the main wallet
    const pool = await testDb.setupTestDatabase();
    const result = await pool.query(
      'SELECT COUNT(*) FROM trading_wallets WHERE main_wallet_pubkey = $1 AND name LIKE $2',
      [mainWalletPubkey, 'test_%']
    );

    expect(parseInt(result.rows[0].count)).toBe(3);
  });

  it('should enforce unique public keys', async () => {
    const publicKey = TestDataFactory.generateTestPublicKey();
    
    // Create first wallet
    const wallet1 = TestDataFactory.createTestWallet({
      name: 'test_wallet_1',
      publicKey
    });
    
    const wallet1Id = await testDb.createTestWallet(wallet1);
    expect(wallet1Id).toBeGreaterThan(0);

    // Try to create second wallet with same public key
    const wallet2 = TestDataFactory.createTestWallet({
      name: 'test_wallet_2',
      publicKey
    });

    // This should fail due to unique constraint
    await expect(testDb.createTestWallet(wallet2)).rejects.toThrow();
  });

  it('should allow wallets from different main wallets', async () => {
    const mainWallet1 = '5ZoNfqXXLinvGHKzsxDYkZge2MGpJT4NNnRCVQB8eqQj'; // Use existing user
    const mainWallet2 = 'Rov8offRt6Ygg9spEfkXNBFsoSVfSVjRj2SuHTsKNdw'; // Use existing user

    const wallet1 = TestDataFactory.createTestWallet({
      name: 'test_wallet_main1',
      publicKey: TestDataFactory.generateTestPublicKey(), // Generate unique key
      mainWalletPubkey: mainWallet1
    });

    const wallet2 = TestDataFactory.createTestWallet({
      name: 'test_wallet_main2',
      publicKey: TestDataFactory.generateTestPublicKey(), // Generate unique key
      mainWalletPubkey: mainWallet2
    });

    const wallet1Id = await testDb.createTestWallet(wallet1);
    const wallet2Id = await testDb.createTestWallet(wallet2);

    expect(wallet1Id).toBeGreaterThan(0);
    expect(wallet2Id).toBeGreaterThan(0);
    expect(wallet1Id).not.toBe(wallet2Id);

    // Verify isolation between main wallets
    const pool = await testDb.setupTestDatabase();
    
    const result1 = await pool.query(
      'SELECT COUNT(*) FROM trading_wallets WHERE main_wallet_pubkey = $1 AND name LIKE $2',
      [mainWallet1, 'test_%']
    );
    
    const result2 = await pool.query(
      'SELECT COUNT(*) FROM trading_wallets WHERE main_wallet_pubkey = $1 AND name LIKE $2',
      [mainWallet2, 'test_%']
    );

    expect(parseInt(result1.rows[0].count)).toBe(1);
    expect(parseInt(result2.rows[0].count)).toBe(1);
  });

  it('should handle wallet creation timestamps correctly', async () => {
    const beforeTime = new Date();
    beforeTime.setSeconds(beforeTime.getSeconds() - 1); // Give 1 second buffer
    
    const testWallet = TestDataFactory.createTestWallet();
    const walletId = await testDb.createTestWallet(testWallet);

    const afterTime = new Date();
    afterTime.setSeconds(afterTime.getSeconds() + 1); // Give 1 second buffer

    // Verify timestamp is within expected range
    const pool = await testDb.setupTestDatabase();
    const result = await pool.query(
      'SELECT created_at FROM trading_wallets WHERE id = $1',
      [walletId]
    );

    const createdAt = new Date(result.rows[0].created_at);
    expect(createdAt.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
    expect(createdAt.getTime()).toBeLessThanOrEqual(afterTime.getTime());
  });
});
