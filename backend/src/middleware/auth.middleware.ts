import { Request, Response, NextFunction } from 'express';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';

// Load environment variables
dotenv.config();

// Check for required environment variables
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
  throw new Error('Missing required Supabase environment variables. Please check your .env file.');
}

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

export const authMiddleware = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    // 1. Get the authorization header
    const authHeader = req.headers.authorization;
    console.log('Auth header:', authHeader);
    
    if (!authHeader?.startsWith('Bearer ')) {
      console.log('No Bearer token found in auth header');
      return res.status(401).json({ error: 'No authorization token provided' });
    }

    // 2. Extract the JWT token
    const token = authHeader.split(' ')[1];
    console.log('Extracted token:', token ? 'Token exists' : 'No token');

    // 3. Verify our JWT token
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key') as {
      walletAddress: string;
      supabaseUserId: string;
    };

    if (!decoded.walletAddress) {
      console.log('Invalid token payload');
      return res.status(401).json({ error: 'Invalid token' });
    }

    console.log('Token verified for wallet:', decoded.walletAddress);

    // 4. Get the user's main wallet from the database
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('main_wallet_pubkey')
      .eq('id', decoded.supabaseUserId)
      .single();

    if (userError) {
      console.error('Error fetching user data:', userError);
      return res.status(401).json({ error: 'Error fetching user data' });
    }

    if (!userData) {
      console.log('No user data found for user:', decoded.supabaseUserId);
      return res.status(401).json({ error: 'User data not found' });
    }

    // 5. Add user info to request object
    req.user = {
      main_wallet_pubkey: userData.main_wallet_pubkey
    };

    // 6. If trading_wallet_id is provided in the request, verify ownership
    if (req.body.trading_wallet_id) {
      console.log('Verifying trading wallet ownership for ID:', req.body.trading_wallet_id);
      
      const { data: walletData, error: walletError } = await supabase
        .from('trading_wallets')
        .select('id')
        .eq('main_wallet_pubkey', userData.main_wallet_pubkey)
        .eq('id', req.body.trading_wallet_id)
        .single();

      if (walletError) {
        console.error('Error verifying wallet ownership:', walletError);
        return res.status(403).json({ error: 'Error verifying wallet ownership' });
      }

      if (!walletData) {
        console.log('Trading wallet not found or access denied');
        return res.status(403).json({ error: 'Trading wallet not found or access denied' });
      }

      req.user.trading_wallet_id = walletData.id;
      console.log('Trading wallet ownership verified');
    }

    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}; 