import { Router } from 'express';
import { Pool } from 'pg';
import { authMiddleware } from '../middleware/auth.middleware';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from the correct path
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// Check for required environment variables
if (!process.env.JWT_SECRET || !process.env.DATABASE_URL) {
  throw new Error('Missing required environment variables. Please check your .env file.');
}

const JWT_SECRET = process.env.JWT_SECRET;

console.log('Initializing auth routes...');

const router = Router();

// Initialize database pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Debug middleware to log all requests
router.use((req, res, next) => {
  console.log('Auth Route Request:', {
    method: req.method,
    path: req.path,
    body: req.body,
    headers: req.headers
  });
  next();
});

// Test endpoint
router.get('/test', (req, res) => {
  console.log('Test endpoint hit');
  res.json({ message: 'Auth router is working' });
});

// Sign in with wallet address
router.post('/signin', async (req, res) => {
  try {
    console.log('Received signin request:', req.body);
    const { walletAddress } = req.body;
    
    if (!walletAddress) {
      console.log('No wallet address provided');
      return res.status(400).json({ error: 'Wallet address is required' });
    }

    console.log('Processing wallet authentication for:', walletAddress);

    const client = await pool.connect();
    try {
      // Check if user exists in our database
      const userResult = await client.query(`
        SELECT main_wallet_pubkey
        FROM users
        WHERE main_wallet_pubkey = $1
      `, [walletAddress]);

      if (userResult.rows.length === 0) {
        // Create new user
        console.log('Creating new user for wallet:', walletAddress);
        const newUserResult = await client.query(`
          INSERT INTO users (main_wallet_pubkey, created_at)
          VALUES ($1, CURRENT_TIMESTAMP)
          RETURNING main_wallet_pubkey
        `, [walletAddress]);

        if (newUserResult.rows.length === 0) {
          throw new Error('Failed to create user');
        }
      }

      console.log('Creating JWT token for wallet:', walletAddress);
      // Create JWT token
      const token = jwt.sign(
        { 
          walletAddress,
          userId: walletAddress // Use wallet address as userId for simplicity
        },
        JWT_SECRET
      );

      console.log('JWT token created successfully');
      res.json({ access_token: token });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Sign in error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Sign out
router.post('/signout', authMiddleware, async (req, res) => {
  try {
    console.log('Received signout request');
    res.json({ message: 'Signed out successfully' });
  } catch (error) {
    console.error('Sign out error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

console.log('Auth routes initialized');

export default router; 