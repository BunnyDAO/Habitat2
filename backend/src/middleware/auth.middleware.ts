import { Request, Response, NextFunction } from 'express';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import jwt, { JwtPayload } from 'jsonwebtoken';
import path from 'path';

// Load environment variables from the correct path
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Check for required environment variables
if (!process.env.JWT_SECRET || !process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
  throw new Error('Missing required environment variables. Please check your .env file.');
}

const JWT_SECRET = process.env.JWT_SECRET;

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

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

    // 4. Get the user's main wallet from Supabase
    console.log('Auth middleware - Checking user in database:', decoded.walletAddress);
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('main_wallet_pubkey')
      .eq('main_wallet_pubkey', decoded.walletAddress)
      .single();

    console.log('Auth middleware - Database result:', user);

    if (userError && userError.code !== 'PGRST116') { // PGRST116 is "no rows returned"
      console.error('Auth middleware - Error checking user:', userError);
      throw userError;
    }

    if (!user) {
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
      main_wallet_pubkey: user.main_wallet_pubkey
    };
    console.log('Auth middleware - Added user to request:', req.user);

    // 6. If trading_wallet_id is provided in the request, verify ownership
    if (req.body.trading_wallet_id) {
      console.log('Auth middleware - Verifying trading wallet ownership:', req.body.trading_wallet_id);
      const { data: wallet, error: walletError } = await supabase
        .from('trading_wallets')
        .select('id')
        .eq('main_wallet_pubkey', decoded.walletAddress)
        .eq('id', req.body.trading_wallet_id)
        .single();

      console.log('Auth middleware - Trading wallet result:', wallet);

      if (walletError || !wallet) {
        console.log('Auth middleware - Trading wallet not found or access denied');
        return res.status(403).json({ error: 'Trading wallet not found or access denied' });
      }

      req.user.trading_wallet_id = wallet.id;
      console.log('Auth middleware - Added trading wallet ID to request:', req.user);
    }

    next();
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