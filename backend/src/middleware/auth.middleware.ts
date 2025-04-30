import { Request, Response, NextFunction } from 'express';
import { Pool } from 'pg';
import dotenv from 'dotenv';
import jwt, { JwtPayload } from 'jsonwebtoken';
import path from 'path';

// Load environment variables from the correct path
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Check for required environment variables
if (!process.env.JWT_SECRET || !process.env.DATABASE_URL) {
  console.error('Missing environment variables:');
  console.error('JWT_SECRET:', process.env.JWT_SECRET ? 'Present' : 'Missing');
  console.error('DATABASE_URL:', process.env.DATABASE_URL ? 'Present' : 'Missing');
  throw new Error('Missing required environment variables. Please check your .env file.');
}

// Validate JWT_SECRET format
const JWT_SECRET = process.env.JWT_SECRET.trim();
if (JWT_SECRET.length < 32) {
  console.error('JWT_SECRET is too short. It should be at least 32 characters long.');
  throw new Error('Invalid JWT_SECRET format');
}

console.log('Auth middleware - JWT_SECRET length:', JWT_SECRET.length);

// Initialize database pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export interface AuthenticatedRequest extends Request {
  user?: {
    main_wallet_pubkey: string;
    trading_wallet_id?: number;
  };
}

interface TokenPayload extends JwtPayload {
  walletAddress: string;
  userId: string;
}

export const authMiddleware = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    console.log('Auth middleware - Request headers:', req.headers);
    console.log('Auth middleware - Request method:', req.method);
    console.log('Auth middleware - Request path:', req.path);
    console.log('Auth middleware - Request originalUrl:', req.originalUrl);
    
    // 1. Get the authorization header
    const authHeader = req.headers.authorization;
    console.log('Auth middleware - Authorization header:', authHeader);
    
    if (!authHeader?.startsWith('Bearer ')) {
      console.log('Auth middleware - No Bearer token found');
      return res.status(401).json({ error: 'No authorization token provided' });
    }

    // 2. Extract the JWT token
    const token = authHeader.split(' ')[1];
    console.log('Auth middleware - Extracted token:', token);

    // 3. Verify our JWT token
    console.log('Auth middleware - Verifying token with secret length:', JWT_SECRET.length);
    const decoded = jwt.verify(token, JWT_SECRET) as unknown as TokenPayload;
    console.log('Auth middleware - Decoded token:', decoded);

    if (!decoded.walletAddress) {
      console.log('Auth middleware - Invalid token payload: missing walletAddress');
      return res.status(401).json({ error: 'Invalid token payload: missing walletAddress' });
    }

    // 4. Get the user's main wallet from the database
    const client = await pool.connect();
    try {
      console.log('Auth middleware - Checking user in database:', decoded.walletAddress);
      const result = await client.query(`
        SELECT main_wallet_pubkey
        FROM users
        WHERE main_wallet_pubkey = $1
      `, [decoded.walletAddress]);

      console.log('Auth middleware - Database result:', result.rows);

      if (result.rows.length === 0) {
        // For POST requests to /trading-wallets, allow the request to proceed
        // The route handler will create the user if needed
        if (req.method === 'POST' && req.originalUrl.endsWith('/trading-wallets')) {
          console.log('Auth middleware - Allowing POST to /trading-wallets for new user');
          req.user = {
            main_wallet_pubkey: decoded.walletAddress
          };
          return next();
        }
        
        console.log('Auth middleware - User not found in database');
        return res.status(401).json({ error: 'User not found' });
      }

      // 5. Add user info to request object
      req.user = {
        main_wallet_pubkey: result.rows[0].main_wallet_pubkey
      };
      console.log('Auth middleware - Added user to request:', req.user);

      // 6. If trading_wallet_id is provided in the request, verify ownership
      if (req.body.trading_wallet_id) {
        console.log('Auth middleware - Verifying trading wallet ownership:', req.body.trading_wallet_id);
        const walletResult = await client.query(`
          SELECT id
          FROM trading_wallets
          WHERE main_wallet_pubkey = $1 AND id = $2
        `, [decoded.walletAddress, req.body.trading_wallet_id]);

        console.log('Auth middleware - Trading wallet result:', walletResult.rows);

        if (walletResult.rows.length === 0) {
          console.log('Auth middleware - Trading wallet not found or access denied');
          return res.status(403).json({ error: 'Trading wallet not found or access denied' });
        }

        req.user.trading_wallet_id = walletResult.rows[0].id;
        console.log('Auth middleware - Added trading wallet ID to request:', req.user);
      }

      next();
    } finally {
      client.release();
    }
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      console.log('Auth middleware - JWT error:', error.message);
      return res.status(401).json({ error: 'Invalid token' });
    }
    if (error instanceof jwt.TokenExpiredError) {
      console.log('Auth middleware - Token expired:', error.message);
      return res.status(401).json({ error: 'Token expired' });
    }
    console.error('Auth middleware - Unexpected error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}; 