import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import { authMiddleware } from '../middleware/auth.middleware';
import jwt from 'jsonwebtoken';

const router = Router();

// Initialize Supabase client with environment variables
const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_KEY || ''
);

// Sign in with wallet address
router.post('/signin', async (req, res) => {
  try {
    const { walletAddress } = req.body;
    
    if (!walletAddress) {
      return res.status(400).json({ error: 'Wallet address is required' });
    }

    // Sign in with Supabase using the wallet address
    const { data, error } = await supabase.auth.signInWithPassword({
      email: `${walletAddress}@solana.com`,
      password: walletAddress
    });

    if (error) {
      console.error('Supabase sign in error:', error);
      return res.status(401).json({ error: 'Authentication failed' });
    }

    if (!data.session) {
      return res.status(401).json({ error: 'No session created' });
    }

    // Create our own JWT token
    const token = jwt.sign(
      { 
        walletAddress,
        supabaseUserId: data.user.id
      },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '24h' }
    );

    // Return our JWT token
    res.json({ access_token: token });
  } catch (error) {
    console.error('Sign in error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Sign out
router.post('/signout', authMiddleware, async (req, res) => {
  try {
    const { error } = await supabase.auth.signOut();
    
    if (error) {
      console.error('Supabase sign out error:', error);
      return res.status(500).json({ error: 'Failed to sign out' });
    }

    res.json({ message: 'Signed out successfully' });
  } catch (error) {
    console.error('Sign out error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router; 