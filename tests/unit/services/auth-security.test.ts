import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AuthSecurityService } from '../../../backend/src/services/auth-security.service';
import { TestDatabaseManager } from '../../helpers/db-setup';
import * as nacl from 'tweetnacl';
import * as bs58 from 'bs58';

// Mock nacl for testing
vi.mock('tweetnacl', () => ({
  default: {
    sign: {
      detached: {
        verify: vi.fn()
      }
    }
  }
}));

describe('AuthSecurityService', () => {
  let service: AuthSecurityService;
  let testDb: TestDatabaseManager;
  let testUser: string;

  beforeEach(async () => {
    testDb = new TestDatabaseManager();
    const pool = await testDb.getPool();
    service = new AuthSecurityService(pool, 'test-jwt-secret');
    
    testUser = 'test_user_auth';
    
    // Create test user
    await pool.query('INSERT INTO users (main_wallet_pubkey) VALUES ($1) ON CONFLICT DO NOTHING', [testUser]);
  });

  describe('verifyWalletSignature', () => {
    it('should verify valid signature', async () => {
      // Mock successful verification
      vi.mocked(nacl.sign.detached.verify).mockReturnValue(true);
      
      const verification = {
        message: 'Sign in to Habitat2 Trading Platform\nTimestamp: ' + Date.now() + '\nNonce: test123',
        signature: 'valid_signature_base58',
        publicKey: testUser
      };

      const isValid = await service.verifyWalletSignature(verification);
      
      expect(isValid).toBe(true);
      expect(nacl.sign.detached.verify).toHaveBeenCalled();
    });

    it('should reject invalid signature', async () => {
      // Mock failed verification
      vi.mocked(nacl.sign.detached.verify).mockReturnValue(false);
      
      const verification = {
        message: 'Sign in to Habitat2 Trading Platform\nTimestamp: ' + Date.now() + '\nNonce: test123',
        signature: 'invalid_signature_base58',
        publicKey: testUser
      };

      const isValid = await service.verifyWalletSignature(verification);
      
      expect(isValid).toBe(false);
    });

    it('should reject message with invalid format', async () => {
      const verification = {
        message: 'Invalid message format',
        signature: 'signature_base58',
        publicKey: testUser
      };

      const isValid = await service.verifyWalletSignature(verification);
      
      expect(isValid).toBe(false);
    });

    it('should reject message with old timestamp', async () => {
      // Timestamp from 10 minutes ago
      const oldTimestamp = Date.now() - (10 * 60 * 1000);
      
      const verification = {
        message: `Sign in to Habitat2 Trading Platform\nTimestamp: ${oldTimestamp}\nNonce: test123`,
        signature: 'signature_base58',
        publicKey: testUser
      };

      const isValid = await service.verifyWalletSignature(verification);
      
      expect(isValid).toBe(false);
    });
  });

  describe('createSecureToken', () => {
    it('should create JWT token with session', async () => {
      const token = await service.createSecureToken(testUser);
      
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3); // JWT has 3 parts
    });

    it('should store session in database', async () => {
      await service.createSecureToken(testUser);
      
      const pool = await testDb.getPool();
      const sessions = await pool.query('SELECT * FROM auth_sessions WHERE wallet_address = $1', [testUser]);
      
      expect(sessions.rows.length).toBeGreaterThan(0);
      expect(sessions.rows[0].wallet_address).toBe(testUser);
    });
  });

  describe('verifyToken', () => {
    let validToken: string;

    beforeEach(async () => {
      validToken = await service.createSecureToken(testUser);
    });

    it('should verify valid token', async () => {
      const authToken = await service.verifyToken(validToken);
      
      expect(authToken).not.toBeNull();
      expect(authToken?.walletAddress).toBe(testUser);
      expect(authToken?.sessionId).toBeDefined();
    });

    it('should reject invalid token', async () => {
      const authToken = await service.verifyToken('invalid.jwt.token');
      
      expect(authToken).toBeNull();
    });

    it('should reject token with invalid session', async () => {
      // Invalidate session
      const pool = await testDb.getPool();
      await pool.query('DELETE FROM auth_sessions WHERE wallet_address = $1', [testUser]);
      
      const authToken = await service.verifyToken(validToken);
      
      expect(authToken).toBeNull();
    });
  });

  describe('invalidateSession', () => {
    it('should invalidate specific session', async () => {
      const token = await service.createSecureToken(testUser);
      const authToken = await service.verifyToken(token);
      
      expect(authToken).not.toBeNull();
      
      await service.invalidateSession(authToken!.sessionId);
      
      const invalidatedToken = await service.verifyToken(token);
      expect(invalidatedToken).toBeNull();
    });
  });

  describe('invalidateAllSessions', () => {
    it('should invalidate all user sessions', async () => {
      // Create multiple sessions
      const token1 = await service.createSecureToken(testUser);
      const token2 = await service.createSecureToken(testUser);
      
      // Both should be valid initially
      expect(await service.verifyToken(token1)).not.toBeNull();
      expect(await service.verifyToken(token2)).not.toBeNull();
      
      // Invalidate all sessions
      await service.invalidateAllSessions(testUser);
      
      // Both should be invalid now
      expect(await service.verifyToken(token1)).toBeNull();
      expect(await service.verifyToken(token2)).toBeNull();
    });
  });

  describe('checkAuthRateLimit', () => {
    it('should allow requests within rate limit', async () => {
      const isAllowed = await service.checkAuthRateLimit(testUser, 5, 15);
      
      expect(isAllowed).toBe(true);
    });

    it('should block requests exceeding rate limit', async () => {
      // Record multiple failed attempts
      for (let i = 0; i < 6; i++) {
        await service.recordAuthAttempt(testUser, false);
      }
      
      const isAllowed = await service.checkAuthRateLimit(testUser, 5, 15);
      
      expect(isAllowed).toBe(false);
    });

    it('should reset rate limit after time window', async () => {
      // Record failed attempts
      for (let i = 0; i < 6; i++) {
        await service.recordAuthAttempt(testUser, false);
      }
      
      // Simulate time passing by deleting old attempts
      const pool = await testDb.getPool();
      await pool.query(`
        UPDATE auth_attempts 
        SET created_at = created_at - INTERVAL '20 minutes' 
        WHERE wallet_address = $1
      `, [testUser]);
      
      const isAllowed = await service.checkAuthRateLimit(testUser, 5, 15);
      
      expect(isAllowed).toBe(true);
    });
  });

  describe('recordAuthAttempt', () => {
    it('should record successful auth attempt', async () => {
      await service.recordAuthAttempt(testUser, true);
      
      const pool = await testDb.getPool();
      const attempts = await pool.query(
        'SELECT * FROM auth_attempts WHERE wallet_address = $1 AND success = true',
        [testUser]
      );
      
      expect(attempts.rows.length).toBeGreaterThan(0);
    });

    it('should record failed auth attempt', async () => {
      await service.recordAuthAttempt(testUser, false);
      
      const pool = await testDb.getPool();
      const attempts = await pool.query(
        'SELECT * FROM auth_attempts WHERE wallet_address = $1 AND success = false',
        [testUser]
      );
      
      expect(attempts.rows.length).toBeGreaterThan(0);
    });
  });

  describe('generateAuthChallenge', () => {
    it('should generate valid challenge message', () => {
      const challenge = service.generateAuthChallenge();
      
      expect(challenge).toContain('Sign in to Habitat2 Trading Platform');
      expect(challenge).toContain('Timestamp:');
      expect(challenge).toContain('Nonce:');
      
      const lines = challenge.split('\n');
      expect(lines).toHaveLength(3);
    });

    it('should generate unique challenges', () => {
      const challenge1 = service.generateAuthChallenge();
      const challenge2 = service.generateAuthChallenge();
      
      expect(challenge1).not.toBe(challenge2);
    });
  });

  describe('validateResourceAccess', () => {
    let testStrategy: any;
    let testWallet: any;

    beforeEach(async () => {
      const pool = await testDb.getPool();
      
      // Create test trading wallet
      const walletResult = await pool.query(`
        INSERT INTO trading_wallets (main_wallet_pubkey, wallet_pubkey, name)
        VALUES ($1, $2, $3)
        RETURNING *
      `, [testUser, 'test_trading_wallet_auth', 'Test Trading Wallet']);
      testWallet = walletResult.rows[0];
      
      // Create test strategy
      const strategyResult = await pool.query(`
        INSERT INTO strategies (trading_wallet_id, main_wallet_pubkey, strategy_type, config, name)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      `, [testWallet.id, testUser, 'wallet-monitor', JSON.stringify({ test: true }), 'test_strategy_auth']);
      testStrategy = strategyResult.rows[0];
    });

    it('should allow access to owned strategy', async () => {
      const hasAccess = await service.validateResourceAccess(
        testUser,
        'strategy',
        testStrategy.id.toString()
      );
      
      expect(hasAccess).toBe(true);
    });

    it('should deny access to non-owned strategy', async () => {
      const hasAccess = await service.validateResourceAccess(
        'different_user',
        'strategy',
        testStrategy.id.toString()
      );
      
      expect(hasAccess).toBe(false);
    });

    it('should allow access to owned trading wallet', async () => {
      const hasAccess = await service.validateResourceAccess(
        testUser,
        'trading_wallet',
        testWallet.id.toString()
      );
      
      expect(hasAccess).toBe(true);
    });

    it('should deny access to non-owned trading wallet', async () => {
      const hasAccess = await service.validateResourceAccess(
        'different_user',
        'trading_wallet',
        testWallet.id.toString()
      );
      
      expect(hasAccess).toBe(false);
    });

    it('should handle unknown resource type', async () => {
      const hasAccess = await service.validateResourceAccess(
        testUser,
        'unknown_resource',
        '123'
      );
      
      expect(hasAccess).toBe(false);
    });
  });

  describe('cleanupExpiredSessions', () => {
    it('should remove expired sessions', async () => {
      const pool = await testDb.getPool();
      
      // Create expired session
      await pool.query(`
        INSERT INTO auth_sessions (session_id, wallet_address, expires_at)
        VALUES ($1, $2, $3)
      `, ['expired_session', testUser, new Date(Date.now() - 60000)]); // 1 minute ago
      
      // Create valid session
      await pool.query(`
        INSERT INTO auth_sessions (session_id, wallet_address, expires_at)
        VALUES ($1, $2, $3)
      `, ['valid_session', testUser, new Date(Date.now() + 60000)]); // 1 minute from now
      
      await service.cleanupExpiredSessions();
      
      const sessions = await pool.query('SELECT * FROM auth_sessions WHERE wallet_address = $1', [testUser]);
      
      expect(sessions.rows).toHaveLength(1);
      expect(sessions.rows[0].session_id).toBe('valid_session');
    });
  });
});