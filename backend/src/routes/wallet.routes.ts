import express from 'express';
import { HeliusService } from '../services/helius.service';
import { Pool } from 'pg';
import { createClient } from 'redis';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const router = express.Router();

// Initialize services
const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

// Redis connection (optional)
let redisClient: ReturnType<typeof createClient> | null = null;
if (process.env.REDIS_HOST && process.env.REDIS_PORT) {
  redisClient = createClient({
    url: `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`,
    password: process.env.REDIS_PASSWORD,
  });

  redisClient.connect().catch(err => {
    console.error('Failed to connect to Redis in wallet routes:', err);
    redisClient = null;
  });
}

// Verify Helius API key
if (!process.env.HELIUS_API_KEY) {
  console.error('HELIUS_API_KEY is not set in environment variables');
  process.exit(1);
}

const heliusService = new HeliusService(
  process.env.HELIUS_API_KEY,
  redisClient
);

// Get wallet balances
router.get('/balances/:walletAddress', async (req, res) => {
  console.log(`Received request for wallet balances: ${req.params.walletAddress}`);
  
  try {
    const { walletAddress } = req.params;

    if (!walletAddress) {
      return res.status(400).json({ error: 'Wallet address is required' });
    }

    console.log('Fetching balances from HeliusService...');
    const balances = await heliusService.getWalletBalances(walletAddress);
    console.log(`Successfully fetched ${balances.length} balances`);
    
    res.json(balances);
  } catch (error) {
    console.error('Error in /balances route:', error);
    
    // Handle specific error types
    if (error instanceof Error) {
      if (error.message === 'Invalid wallet address') {
        return res.status(400).json({ 
          error: 'Invalid wallet address format',
          details: error.message
        });
      }
      if (error.message.includes('Helius API error')) {
        return res.status(502).json({ 
          error: 'Error fetching data from Helius API',
          details: error.message
        });
      }
      if (error.message.includes('Helius RPC error')) {
        return res.status(502).json({ 
          error: 'Error from Helius RPC',
          details: error.message
        });
      }
    }
    
    // Generic error response
    res.status(500).json({ 
      error: 'Failed to fetch wallet balances',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router; 