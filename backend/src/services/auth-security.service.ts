import * as jwt from 'jsonwebtoken';
import { Pool } from 'pg';
import { PublicKey } from '@solana/web3.js';
import * as nacl from 'tweetnacl';
import * as bs58 from 'bs58';

export interface WalletSignatureVerification {
  message: string;
  signature: string;
  publicKey: string;
}

export interface AuthToken {
  walletAddress: string;
  userId: string;
  issuedAt: number;
  expiresAt: number;
  sessionId: string;
}

export class AuthSecurityService {
  private db?: Pool;
  private jwtSecret: string;
  private tokenExpiration: number = 24 * 60 * 60 * 1000; // 24 hours

  constructor(db?: Pool, jwtSecret?: string) {
    this.db = db;
    this.jwtSecret = jwtSecret || process.env.JWT_SECRET || '';
  }

  /**
   * Verify wallet signature for authentication (overloaded method)
   */
  async verifyWalletSignature(publicKey: string, message: string, signature: string): Promise<boolean>;
  async verifyWalletSignature(verification: WalletSignatureVerification): Promise<boolean>;
  async verifyWalletSignature(
    publicKeyOrVerification: string | WalletSignatureVerification, 
    message?: string, 
    signature?: string
  ): Promise<boolean> {
    // Handle overloaded calls
    let verification: WalletSignatureVerification;
    
    if (typeof publicKeyOrVerification === 'string' && message && signature) {
      verification = {
        publicKey: publicKeyOrVerification,
        message: message,
        signature: signature
      };
    } else if (typeof publicKeyOrVerification === 'object') {
      verification = publicKeyOrVerification;
    } else {
      console.error('Invalid arguments for verifyWalletSignature');
      return false;
    }

    return this.verifyWalletSignatureInternal(verification);
  }

  /**
   * Verify wallet signature for authentication
   */
  private async verifyWalletSignatureInternal(verification: WalletSignatureVerification): Promise<boolean> {
    try {
      // Validate public key format
      const publicKey = new PublicKey(verification.publicKey);
      
      // Decode signature and message
      const signature = bs58.decode(verification.signature);
      const message = new TextEncoder().encode(verification.message);
      
      // Verify signature
      const isValid = nacl.sign.detached.verify(
        message,
        signature,
        publicKey.toBytes()
      );

      if (!isValid) {
        console.log('Invalid signature for wallet:', verification.publicKey);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Signature verification error:', error);
      return false;
    }
  }

  /**
   * Validate private key request message format
   */
  validatePrivateKeyRequestMessage(message: string, walletPubkey: string): boolean {
    try {
      // Expected format: "Reveal private key for wallet {walletPubkey} at {timestamp}"
      const expectedPrefix = `Reveal private key for wallet ${walletPubkey} at `;
      
      if (!message.startsWith(expectedPrefix)) {
        console.log('Invalid private key request message format');
        return false;
      }

      // Extract timestamp
      const timestampStr = message.substring(expectedPrefix.length);
      const timestamp = parseInt(timestampStr);
      
      if (isNaN(timestamp)) {
        console.log('Invalid timestamp in private key request message');
        return false;
      }

      // Check timestamp (should be within last 5 minutes)
      const now = Date.now();
      const fiveMinutes = 5 * 60 * 1000;

      if (Math.abs(now - timestamp) > fiveMinutes) {
        console.log('Private key request message timestamp too old:', timestamp, 'vs', now);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Private key request message validation error:', error);
      return false;
    }
  }

  /**
   * Validate authentication message format and timestamp
   */
  private validateAuthMessage(message: string): boolean {
    try {
      // Expected format: "Sign in to Habitat2 Trading Platform\nTimestamp: {timestamp}\nNonce: {nonce}"
      const lines = message.split('\n');
      
      if (lines.length !== 3) return false;
      if (!lines[0].includes('Habitat2')) return false;
      if (!lines[1].startsWith('Timestamp:')) return false;
      if (!lines[2].startsWith('Nonce:')) return false;

      // Check timestamp (should be within last 5 minutes)
      const timestampMatch = lines[1].match(/Timestamp:\s*(\d+)/);
      if (!timestampMatch) return false;

      const timestamp = parseInt(timestampMatch[1]);
      const now = Date.now();
      const fiveMinutes = 5 * 60 * 1000;

      if (Math.abs(now - timestamp) > fiveMinutes) {
        console.log('Message timestamp too old:', timestamp, 'vs', now);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Message validation error:', error);
      return false;
    }
  }

  /**
   * Create secure JWT token with expiration
   */
  async createSecureToken(walletAddress: string): Promise<string> {
    const now = Date.now();
    const expiresAt = now + this.tokenExpiration;
    const sessionId = this.generateSessionId();

    const payload: AuthToken = {
      walletAddress,
      userId: walletAddress,
      issuedAt: now,
      expiresAt,
      sessionId
    };

    // Store session in database
    await this.storeSession(sessionId, walletAddress, expiresAt);

    const token = jwt.sign(payload, this.jwtSecret, {
      expiresIn: '24h'
    });

    return token;
  }

  /**
   * Verify JWT token and check session validity
   */
  async verifyToken(token: string): Promise<AuthToken | null> {
    try {
      const decoded = jwt.verify(token, this.jwtSecret) as AuthToken;
      
      // Check if session is still valid in database
      const isValidSession = await this.validateSession(decoded.sessionId, decoded.walletAddress);
      
      if (!isValidSession) {
        console.log('Invalid session for token:', decoded.sessionId);
        return null;
      }

      // Check expiration
      if (Date.now() > decoded.expiresAt) {
        console.log('Token expired:', decoded.expiresAt);
        await this.invalidateSession(decoded.sessionId);
        return null;
      }

      return decoded;
    } catch (error) {
      console.error('Token verification error:', error);
      return null;
    }
  }

  /**
   * Store session in database
   */
  private async storeSession(sessionId: string, walletAddress: string, expiresAt: number): Promise<void> {
    if (!this.db) {
      throw new Error('Database connection not available');
    }
    
    const query = `
      INSERT INTO auth_sessions (session_id, wallet_address, expires_at, created_at)
      VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
      ON CONFLICT (session_id) 
      DO UPDATE SET 
        expires_at = EXCLUDED.expires_at,
        created_at = CURRENT_TIMESTAMP
    `;

    await this.db.query(query, [sessionId, walletAddress, new Date(expiresAt)]);
  }

  /**
   * Validate session exists and is not expired
   */
  private async validateSession(sessionId: string, walletAddress: string): Promise<boolean> {
    if (!this.db) {
      return false;
    }
    
    const query = `
      SELECT expires_at 
      FROM auth_sessions 
      WHERE session_id = $1 AND wallet_address = $2 AND expires_at > CURRENT_TIMESTAMP
    `;

    const result = await this.db.query(query, [sessionId, walletAddress]);
    return result.rows.length > 0;
  }

  /**
   * Invalidate session
   */
  async invalidateSession(sessionId: string): Promise<void> {
    if (!this.db) {
      throw new Error('Database connection not available');
    }
    
    const query = `
      DELETE FROM auth_sessions 
      WHERE session_id = $1
    `;

    await this.db.query(query, [sessionId]);
  }

  /**
   * Invalidate all sessions for a wallet
   */
  async invalidateAllSessions(walletAddress: string): Promise<void> {
    if (!this.db) {
      throw new Error('Database connection not available');
    }
    
    const query = `
      DELETE FROM auth_sessions 
      WHERE wallet_address = $1
    `;

    await this.db.query(query, [walletAddress]);
  }

  /**
   * Generate secure session ID
   */
  private generateSessionId(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 32; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  /**
   * Clean up expired sessions
   */
  async cleanupExpiredSessions(): Promise<void> {
    if (!this.db) {
      console.log('Database connection not available for cleanup');
      return;
    }
    
    const query = `
      DELETE FROM auth_sessions 
      WHERE expires_at < CURRENT_TIMESTAMP
    `;

    const result = await this.db.query(query);
    console.log(`Cleaned up ${result.rowCount} expired sessions`);
  }

  /**
   * Rate limiting check for authentication attempts
   */
  async checkAuthRateLimit(walletAddress: string, maxAttempts: number = 5, windowMinutes: number = 15): Promise<boolean> {
    if (!this.db) {
      console.log('Database connection not available for rate limiting');
      return true; // Allow when DB not available
    }
    
    const query = `
      SELECT COUNT(*) as attempt_count
      FROM auth_attempts 
      WHERE wallet_address = $1 
      AND created_at > CURRENT_TIMESTAMP - INTERVAL '${windowMinutes} minutes'
    `;

    const result = await this.db.query(query, [walletAddress]);
    const attemptCount = parseInt(result.rows[0].attempt_count);

    if (attemptCount >= maxAttempts) {
      console.log(`Rate limit exceeded for wallet: ${walletAddress}`);
      return false;
    }

    return true;
  }

  /**
   * Record authentication attempt
   */
  async recordAuthAttempt(walletAddress: string, success: boolean): Promise<void> {
    if (!this.db) {
      console.log('Database connection not available for recording auth attempt');
      return;
    }
    
    const query = `
      INSERT INTO auth_attempts (wallet_address, success, created_at)
      VALUES ($1, $2, CURRENT_TIMESTAMP)
    `;

    await this.db.query(query, [walletAddress, success]);

    // Clean up old attempts (older than 1 day)
    const cleanupQuery = `
      DELETE FROM auth_attempts 
      WHERE created_at < CURRENT_TIMESTAMP - INTERVAL '1 day'
    `;

    await this.db.query(cleanupQuery);
  }

  /**
   * Generate authentication challenge message
   */
  generateAuthChallenge(): string {
    const timestamp = Date.now();
    const nonce = Math.random().toString(36).substring(2, 15);
    
    return `Sign in to Habitat2 Trading Platform\nTimestamp: ${timestamp}\nNonce: ${nonce}`;
  }

  /**
   * Validate user permissions for resource access
   */
  async validateResourceAccess(walletAddress: string, resourceType: string, resourceId: string): Promise<boolean> {
    try {
      switch (resourceType) {
        case 'strategy':
          return await this.validateStrategyAccess(walletAddress, resourceId);
        case 'trading_wallet':
          return await this.validateTradingWalletAccess(walletAddress, resourceId);
        case 'published_strategy':
          return await this.validatePublishedStrategyAccess(walletAddress, resourceId);
        default:
          console.log('Unknown resource type:', resourceType);
          return false;
      }
    } catch (error) {
      console.error('Resource access validation error:', error);
      return false;
    }
  }

  private async validateStrategyAccess(walletAddress: string, strategyId: string): Promise<boolean> {
    if (!this.db) {
      return false;
    }
    
    const query = `
      SELECT 1 FROM strategies s
      JOIN trading_wallets tw ON s.trading_wallet_id = tw.id
      WHERE s.id = $1 AND tw.main_wallet_pubkey = $2
    `;

    const result = await this.db.query(query, [strategyId, walletAddress]);
    return result.rows.length > 0;
  }

  private async validateTradingWalletAccess(walletAddress: string, walletId: string): Promise<boolean> {
    if (!this.db) {
      return false;
    }
    
    const query = `
      SELECT 1 FROM trading_wallets
      WHERE id = $1 AND main_wallet_pubkey = $2
    `;

    const result = await this.db.query(query, [walletId, walletAddress]);
    return result.rows.length > 0;
  }

  private async validatePublishedStrategyAccess(walletAddress: string, publishedStrategyId: string): Promise<boolean> {
    if (!this.db) {
      return false;
    }
    
    const query = `
      SELECT 1 FROM published_strategies
      WHERE id = $1 AND publisher_wallet = $2
    `;

    const result = await this.db.query(query, [publishedStrategyId, walletAddress]);
    return result.rows.length > 0;
  }
}