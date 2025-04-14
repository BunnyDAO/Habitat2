import express from 'express';
import cors from 'cors';
import { createClient } from 'redis';
import { HeliusService } from './services/helius.service';
import { TokenBalance } from './types';
import dotenv from 'dotenv';
import { Pool } from 'pg';
import { createTradingWalletsRouter } from './routes/trading-wallets.routes';
import { createWalletBalancesRouter } from './routes/wallet-balances.routes';
import { createTokenRouter } from './routes/token.routes';
import { WalletBalancesService } from './services/wallet-balances.service';
import { TokenService } from './services/token.service';
import healthRoutes from './api/v1/routes/health.routes';
import { createPriceFeedRouter } from './api/v1/routes/price-feed.routes';

// Load environment variables
dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

// Initialize database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Add error handler for database connection
pool.on('error', (err) => {
  console.error('Unexpected error on idle database client', err);
});

// Add connection test
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('Error testing database connection:', err);
  } else {
    console.log('Successfully connected to database at:', res.rows[0].now);
  }
});

// Initialize Redis client with fallback
let redisClient: ReturnType<typeof createClient> | null = null;

const initializeRedis = async () => {
  try {
    const client = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
      socket: {
        reconnectStrategy: (retries) => {
          if (retries > 3) {
            console.log('Redis connection failed after 3 retries, continuing without Redis');
            return false;
          }
          return Math.min(retries * 100, 3000);
        }
      }
    });

    client.on('error', (err) => {
      console.error('Redis Client Error:', err);
      redisClient = null;
    });

    await client.connect();
    console.log('Connected to Redis successfully');
    redisClient = client;
  } catch (error) {
    console.error('Failed to connect to Redis, continuing without Redis:', error);
    redisClient = null;
  }
};

// Initialize Redis
initializeRedis().catch(console.error);

// Initialize services after Redis is connected
const heliusService = new HeliusService(process.env.HELIUS_API_KEY || '');
const walletBalancesService = new WalletBalancesService(pool, redisClient);
const tokenService = new TokenService(pool);

// Configure CORS
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3000'],
  methods: ['GET', 'POST', 'OPTIONS', 'DELETE'],
  allowedHeaders: ['Content-Type', 'solana-client'],
  credentials: true
}));

app.use(express.json());

// Register routes
app.use('/api/trading-wallets', createTradingWalletsRouter(pool));
app.use('/api/wallet-balances', createWalletBalancesRouter(walletBalancesService));
app.use('/api/tokens', createTokenRouter(tokenService));

// Register v1 API routes
app.use('/api/v1', healthRoutes);
app.use('/api/v1', createPriceFeedRouter(redisClient, heliusService));

// Wallet balances endpoint
app.get('/api/wallet/:address/balances', async (req, res) => {
  try {
    const { address } = req.params;
    console.log('Fetching balances for address:', address);
    const balances = await heliusService.getWalletBalances(address);
    console.log('Retrieved balances:', JSON.stringify(balances, null, 2));
    res.json(balances);
  } catch (error) {
    console.error('Error fetching wallet balances:', error);
    res.status(500).json({ error: 'Failed to fetch wallet balances' });
  }
});

// Add RPC endpoint to handle web3.js requests
app.post('/', async (req, res) => {
  try {
    const { method, params } = req.body;
    console.log('Received RPC request:', { method, params });
    
    if (method === 'getBalance') {
      const [address] = params;
      console.log('Fetching balance for address:', address);
      const balances = await heliusService.getWalletBalances(address);
      const solBalance = balances.find((b: TokenBalance) => b.mint === 'So11111111111111111111111111111111111111112');
      
      console.log('Retrieved balances:', JSON.stringify(balances, null, 2));
      console.log('SOL balance:', solBalance);
      
      if (solBalance) {
        res.json({
          jsonrpc: '2.0',
          result: solBalance.balance,
          id: req.body.id
        });
      } else {
        res.json({
          jsonrpc: '2.0',
          result: 0,
          id: req.body.id
        });
      }
    } else {
      res.status(400).json({
        jsonrpc: '2.0',
        error: {
          code: -32601,
          message: 'Method not found'
        },
        id: req.body.id
      });
    }
  } catch (error) {
    console.error('Error handling RPC request:', error);
    res.status(500).json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Internal error'
      },
      id: req.body.id
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    redis: redisClient ? 'connected' : 'not connected'
  });
});

// Start the server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
}); 