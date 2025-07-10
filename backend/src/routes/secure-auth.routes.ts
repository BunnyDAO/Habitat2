import { Router, Request, Response } from 'express';
import { AuthSecurityService, WalletSignatureVerification } from '../services/auth-security.service';
import pool from '../database/pool';
import { rateLimitMiddleware, inputValidationMiddleware, secureAuthMiddleware } from '../middleware/secure-auth.middleware';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required');
}

const authSecurityService = new AuthSecurityService(pool, JWT_SECRET);

// Apply security middleware to all routes
router.use(inputValidationMiddleware);

/**
 * @route GET /api/auth/challenge
 * @desc Get authentication challenge message
 * @access Public
 */
router.get('/challenge', rateLimitMiddleware(10, 5), async (req: Request, res: Response) => {
  try {
    const challenge = authSecurityService.generateAuthChallenge();
    res.json({ challenge });
  } catch (error) {
    console.error('Challenge generation error:', error);
    res.status(500).json({ error: 'Failed to generate challenge' });
  }
});

/**
 * @route POST /api/auth/signin
 * @desc Authenticate user with wallet signature
 * @access Public
 */
router.post('/signin', rateLimitMiddleware(5, 15), async (req: Request, res: Response) => {
  try {
    const { message, signature, publicKey } = req.body as WalletSignatureVerification;

    // Validate input
    if (!message || !signature || !publicKey) {
      return res.status(400).json({ error: 'Message, signature, and publicKey are required' });
    }

    // Check rate limiting for this wallet
    const rateLimitOk = await authSecurityService.checkAuthRateLimit(publicKey);
    if (!rateLimitOk) {
      return res.status(429).json({ error: 'Too many authentication attempts. Please try again later.' });
    }

    // Verify wallet signature
    const isValidSignature = await authSecurityService.verifyWalletSignature({
      message,
      signature,
      publicKey
    });

    if (!isValidSignature) {
      await authSecurityService.recordAuthAttempt(publicKey, false);
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // Check if user exists, create if not
    const userQuery = 'SELECT main_wallet_pubkey FROM users WHERE main_wallet_pubkey = $1';
    const userResult = await pool.query(userQuery, [publicKey]);

    if (userResult.rows.length === 0) {
      // Create new user
      const createUserQuery = 'INSERT INTO users (main_wallet_pubkey) VALUES ($1)';
      await pool.query(createUserQuery, [publicKey]);
      console.log('Created new user:', publicKey);
    }

    // Create secure token
    const token = await authSecurityService.createSecureToken(publicKey);

    // Record successful authentication
    await authSecurityService.recordAuthAttempt(publicKey, true);

    res.json({ 
      access_token: token,
      expires_in: 24 * 60 * 60, // 24 hours in seconds
      token_type: 'Bearer'
    });

  } catch (error) {
    console.error('Sign in error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

/**
 * @route POST /api/auth/signout
 * @desc Sign out user and invalidate token
 * @access Private
 */
router.post('/signout', secureAuthMiddleware, async (req: Request, res: Response) => {
  try {
    if (req.user?.sessionId) {
      await authSecurityService.invalidateSession(req.user.sessionId);
    }
    
    res.json({ message: 'Signed out successfully' });
  } catch (error) {
    console.error('Sign out error:', error);
    res.status(500).json({ error: 'Sign out failed' });
  }
});

/**
 * @route POST /api/auth/signout-all
 * @desc Sign out from all devices/sessions
 * @access Private
 */
router.post('/signout-all', secureAuthMiddleware, async (req: Request, res: Response) => {
  try {
    if (req.user?.main_wallet_pubkey) {
      await authSecurityService.invalidateAllSessions(req.user.main_wallet_pubkey);
    }
    
    res.json({ message: 'Signed out from all devices successfully' });
  } catch (error) {
    console.error('Sign out all error:', error);
    res.status(500).json({ error: 'Sign out failed' });
  }
});

/**
 * @route GET /api/auth/me
 * @desc Get current user info
 * @access Private
 */
router.get('/me', secureAuthMiddleware, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    res.json({
      walletAddress: req.user.main_wallet_pubkey,
      userId: req.user.userId,
      issuedAt: req.user.issuedAt,
      expiresAt: req.user.expiresAt
    });
  } catch (error) {
    console.error('Get user info error:', error);
    res.status(500).json({ error: 'Failed to get user info' });
  }
});

/**
 * @route GET /api/auth/sessions
 * @desc Get active sessions for current user
 * @access Private
 */
router.get('/sessions', secureAuthMiddleware, async (req: Request, res: Response) => {
  try {
    if (!req.user?.main_wallet_pubkey) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const query = `
      SELECT 
        session_id,
        created_at,
        expires_at,
        last_accessed,
        CASE WHEN session_id = $2 THEN true ELSE false END as is_current
      FROM auth_sessions 
      WHERE wallet_address = $1 
      AND expires_at > CURRENT_TIMESTAMP
      ORDER BY last_accessed DESC
    `;

    const result = await pool.query(query, [req.user.main_wallet_pubkey, req.user.sessionId]);
    res.json({ sessions: result.rows });

  } catch (error) {
    console.error('Get sessions error:', error);
    res.status(500).json({ error: 'Failed to get sessions' });
  }
});

/**
 * @route DELETE /api/auth/sessions/:sessionId
 * @desc Revoke a specific session
 * @access Private
 */
router.delete('/sessions/:sessionId', secureAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;

    if (!req.user?.main_wallet_pubkey) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Verify session belongs to user
    const checkQuery = `
      SELECT session_id FROM auth_sessions 
      WHERE session_id = $1 AND wallet_address = $2
    `;

    const checkResult = await pool.query(checkQuery, [sessionId, req.user.main_wallet_pubkey]);
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Invalidate session
    await authSecurityService.invalidateSession(sessionId);
    
    res.json({ message: 'Session revoked successfully' });

  } catch (error) {
    console.error('Revoke session error:', error);
    res.status(500).json({ error: 'Failed to revoke session' });
  }
});

/**
 * @route GET /api/auth/security-events
 * @desc Get recent security events for current user
 * @access Private
 */
router.get('/security-events', secureAuthMiddleware, rateLimitMiddleware(50, 60), async (req: Request, res: Response) => {
  try {
    if (!req.user?.main_wallet_pubkey) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = parseInt(req.query.offset as string) || 0;

    const query = `
      SELECT 
        action,
        resource_type,
        resource_id,
        success,
        ip_address,
        created_at
      FROM audit_logs 
      WHERE wallet_address = $1 
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
    `;

    const result = await pool.query(query, [req.user.main_wallet_pubkey, limit, offset]);
    res.json({ events: result.rows });

  } catch (error) {
    console.error('Get security events error:', error);
    res.status(500).json({ error: 'Failed to get security events' });
  }
});

/**
 * @route GET /api/auth/verify
 * @desc Verify token validity (for client-side checks)
 * @access Private
 */
router.get('/verify', secureAuthMiddleware, async (req: Request, res: Response) => {
  try {
    res.json({ 
      valid: true,
      expiresAt: req.user?.expiresAt
    });
  } catch (error) {
    console.error('Token verification error:', error);
    res.status(500).json({ error: 'Verification failed' });
  }
});

export default router;