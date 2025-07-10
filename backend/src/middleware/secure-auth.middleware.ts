import { Request, Response, NextFunction } from 'express';
import { AuthSecurityService } from '../services/auth-security.service';
import pool from '../database/pool';

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required');
}

const authSecurityService = new AuthSecurityService(pool, JWT_SECRET);

// Extend Request interface to include user and security info
declare global {
  namespace Express {
    interface Request {
      user?: {
        main_wallet_pubkey: string;
        trading_wallet_id?: number;
        userId?: string;
        sessionId?: string;
        issuedAt?: number;
        expiresAt?: number;
      };
      security?: {
        ipAddress: string;
        userAgent: string;
      };
    }
  }
}

/**
 * Enhanced authentication middleware with security features
 */
export const secureAuthMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Extract IP and User Agent for security logging
    const ipAddress = req.ip || req.connection.remoteAddress || 'unknown';
    const userAgent = req.get('User-Agent') || 'unknown';
    
    req.security = { ipAddress, userAgent };

    // Get token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      await logFailedAuth(null, 'missing_token', ipAddress, userAgent);
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Verify token using security service
    const authToken = await authSecurityService.verifyToken(token);
    if (!authToken) {
      await logFailedAuth(null, 'invalid_token', ipAddress, userAgent);
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // Check rate limiting for this user
    const rateLimitOk = await authSecurityService.checkAuthRateLimit(authToken.walletAddress);
    if (!rateLimitOk) {
      await logFailedAuth(authToken.walletAddress, 'rate_limit_exceeded', ipAddress, userAgent);
      return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    }

    // Set user info on request
    req.user = {
      main_wallet_pubkey: authToken.walletAddress,
      userId: authToken.userId,
      sessionId: authToken.sessionId,
      issuedAt: authToken.issuedAt,
      expiresAt: authToken.expiresAt
    };

    // Log successful authentication
    await logAuditEvent(
      authToken.walletAddress,
      'auth_success',
      null,
      null,
      { sessionId: authToken.sessionId },
      ipAddress,
      userAgent,
      true
    );

    next();

  } catch (error) {
    console.error('Authentication middleware error:', error);
    await logFailedAuth(null, 'middleware_error', req.security?.ipAddress, req.security?.userAgent);
    res.status(500).json({ error: 'Authentication error' });
  }
};

/**
 * Middleware for endpoints that require resource ownership validation
 */
export const resourceOwnershipMiddleware = (resourceType: string, paramName: string = 'id') => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const resourceId = req.params[paramName];
      if (!resourceId) {
        return res.status(400).json({ error: `Missing ${paramName} parameter` });
      }

      // Validate resource access
      const hasAccess = await authSecurityService.validateResourceAccess(
        req.user.main_wallet_pubkey,
        resourceType,
        resourceId
      );

      if (!hasAccess) {
        await logAuditEvent(
          req.user.main_wallet_pubkey,
          'unauthorized_access_attempt',
          resourceType,
          resourceId,
          { paramName },
          req.security?.ipAddress,
          req.security?.userAgent,
          false
        );
        return res.status(403).json({ error: 'Access denied' });
      }

      // Log successful access
      await logAuditEvent(
        req.user.main_wallet_pubkey,
        'resource_access',
        resourceType,
        resourceId,
        null,
        req.security?.ipAddress,
        req.security?.userAgent,
        true
      );

      next();

    } catch (error) {
      console.error('Resource ownership middleware error:', error);
      res.status(500).json({ error: 'Authorization error' });
    }
  };
};

/**
 * Rate limiting middleware
 */
export const rateLimitMiddleware = (maxRequests: number = 100, windowMinutes: number = 60) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const identifier = req.user?.main_wallet_pubkey || req.security?.ipAddress || 'anonymous';
      const endpoint = `${req.method} ${req.route?.path || req.path}`;

      // Check rate limit using database function
      const query = 'SELECT check_rate_limit($1, $2, $3, $4) as allowed';
      const result = await pool.query(query, [identifier, endpoint, maxRequests, windowMinutes]);

      if (!result.rows[0].allowed) {
        await logAuditEvent(
          req.user?.main_wallet_pubkey ?? null,
          'rate_limit_exceeded',
          'endpoint',
          endpoint,
          { maxRequests, windowMinutes },
          req.security?.ipAddress,
          req.security?.userAgent,
          false
        );
        return res.status(429).json({ 
          error: 'Rate limit exceeded',
          retryAfter: windowMinutes * 60 
        });
      }

      next();

    } catch (error) {
      console.error('Rate limit middleware error:', error);
      // Continue on error to avoid blocking legitimate requests
      next();
    }
  };
};

/**
 * Input validation and sanitization middleware
 */
export const inputValidationMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Sanitize common injection patterns
    const sanitizeValue = (value: any): any => {
      if (typeof value === 'string') {
        // Remove potential SQL injection patterns
        const dangerous = /(\b(union|select|insert|delete|update|drop|create|alter|exec|execute)\b)|(-{2,})|(\*\/)|\/\*/gi;
        if (dangerous.test(value)) {
          throw new Error('Invalid input detected');
        }
        
        // Limit string length
        if (value.length > 10000) {
          throw new Error('Input too long');
        }
        
        return value.trim();
      } else if (typeof value === 'object' && value !== null) {
        const sanitized: any = Array.isArray(value) ? [] : {};
        for (const key in value) {
          sanitized[key] = sanitizeValue(value[key]);
        }
        return sanitized;
      }
      
      return value;
    };

    // Sanitize request body
    if (req.body && typeof req.body === 'object') {
      req.body = sanitizeValue(req.body);
    }

    // Sanitize query parameters
    if (req.query && typeof req.query === 'object') {
      req.query = sanitizeValue(req.query);
    }

    next();

  } catch (error) {
    console.error('Input validation error:', error);
    await logAuditEvent(
      req.user?.main_wallet_pubkey ?? null,
      'malicious_input_detected',
      'request',
      req.path,
      { body: req.body, query: req.query },
      req.security?.ipAddress,
      req.security?.userAgent,
      false
    );
    res.status(400).json({ error: 'Invalid input' });
  }
};

// Helper functions for logging
async function logFailedAuth(walletAddress: string | null, reason: string, ipAddress?: string, userAgent?: string) {
  try {
    if (walletAddress) {
      await authSecurityService.recordAuthAttempt(walletAddress, false);
    }
    
    await logAuditEvent(
      walletAddress,
      'auth_failed',
      'authentication',
      null,
      { reason },
      ipAddress,
      userAgent,
      false
    );
  } catch (error) {
    console.error('Failed to log authentication failure:', error);
  }
}

async function logAuditEvent(
  walletAddress: string | null,
  action: string,
  resourceType: string | null,
  resourceId: string | null,
  details: any = null,
  ipAddress?: string,
  userAgent?: string,
  success: boolean = true
) {
  try {
    const query = 'SELECT log_audit_event($1, $2, $3, $4, $5, $6, $7, $8)';
    await pool.query(query, [
      walletAddress,
      action,
      resourceType,
      resourceId,
      details ? JSON.stringify(details) : null,
      ipAddress || null,
      userAgent || null,
      success
    ]);
  } catch (error) {
    console.error('Failed to log audit event:', error);
  }
}

export { authSecurityService };