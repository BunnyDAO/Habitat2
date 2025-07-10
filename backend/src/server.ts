import express from 'express';
import cors from 'cors';
import { createClient } from 'redis';
import { HeliusService } from './services/helius.service';
import dotenv from 'dotenv';
import path from 'path';
import { Pool } from 'pg';
import { Connection } from '@solana/web3.js';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { createTradingWalletsRouter } from './routes/trading-wallets.routes';
import { createWalletBalancesRouter } from './api/v1/routes/wallet-balances.routes';
import { createTokenRouter } from './routes/token.routes';
import { TokenService } from './services/token.service';
import healthRoutes from './api/v1/routes/health.routes';
import { createPriceFeedRouter } from './api/v1/routes/price-feed.routes';
import { createChartDataRouter } from './api/v1/routes/chart-data.routes';
import { createWhaleTrackingRouter } from './api/v1/routes/whale-tracking.routes';
import { createProxyRouter } from './api/v1/routes/proxy.routes';
import { createTokenMetadataRouter } from './api/v1/routes/token-metadata.routes';
import { createSwapRouter } from './api/v1/routes/swap.routes';
import strategiesRouter from './routes/strategies.routes';
import authRouter from './routes/auth.routes';
import walletTransactionRouter from './routes/wallet-transaction.routes';
import savedWalletsRouter from './routes/saved-wallets.routes';
import rpcRouter from './routes/rpc.routes';
import strategyPublishingRouter from './routes/strategy-publishing.routes';
import strategyMarketplaceRouter from './routes/strategy-marketplace.routes';
import strategyReviewsRouter from './routes/strategy-reviews.routes';

// Load environment variables from the correct path
dotenv.config({ path: path.resolve(__dirname, '../.env') });

export function createApp() {
  const app = express();

  // Initialize Solana connection
  const connection = new Connection(
    process.env.RPC_URL || 'https://api.mainnet-beta.solana.com',
    'confirmed'
  );

  // Initialize database connection
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });

  // Initialize Redis client with fallback (simplified for testing)
  let redisClient: ReturnType<typeof createClient> | null = null;

  // Initialize services
  const heliusService = new HeliusService(process.env.HELIUS_API_KEY || '');
  const tokenService = new TokenService(pool);

  // Configure CORS
  app.use(cors({
    origin: ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:3000'],
    methods: ['GET', 'POST', 'PUT', 'PATCH','OPTIONS', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'solana-client'],
    credentials: true
  }));

  app.use(express.json());

  // Register routes with /api prefix for compatibility
  app.use('/api/auth', authRouter);
  app.use('/api/rpc', rpcRouter);
  app.use('/api/trading-wallets', createTradingWalletsRouter());
  app.use('/api/strategies', strategiesRouter);
  app.use('/api/saved-wallets', savedWalletsRouter);
  app.use('/api/wallet-transactions', walletTransactionRouter);

  // Also register with /api/v1 prefix 
  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/rpc', rpcRouter);
  app.use('/api/v1/trading-wallets', createTradingWalletsRouter());
  app.use('/api/v1/wallet-balances', createWalletBalancesRouter(pool));
  app.use('/api/v1/tokens', createTokenRouter(tokenService));
  app.use('/api/v1', healthRoutes);
  app.use('/api/v1', createPriceFeedRouter(redisClient, heliusService));
  app.use('/api/v1/strategies', strategiesRouter);
  app.use('/api/v1/saved-wallets', savedWalletsRouter);
  app.use('/api/v1/wallet-transactions', walletTransactionRouter);
  
  // Strategy Publishing and Marketplace routes
  app.use('/api/strategies', strategyPublishingRouter);
  app.use('/api/shop', strategyMarketplaceRouter);
  app.use('/api/shop', strategyReviewsRouter);

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({ 
      status: 'ok',
      redis: redisClient ? 'connected' : 'not connected'
    });
  });

  return app;
}

// Only start server if this file is run directly (not in tests)
if (require.main === module) {
  console.log('Starting server in production mode...');
  const app = createApp();
  const port = parseInt(process.env.PORT || '3001', 10);
  
  // Create HTTP server
  const server = createServer(app);
  
  // Add basic WebSocket server support
  try {
    const { WebSocketServer } = require('ws');
    const wss = new WebSocketServer({ 
      server, 
      path: '/api/v1/ws',
      perMessageDeflate: false
    });
    
    wss.on('connection', (ws: any) => {
      console.log('🔌 WebSocket client connected');
      
      ws.on('close', () => {
        console.log('🔌 WebSocket client disconnected');
      });
      
      ws.on('error', (err: any) => {
        console.log('🔌 WebSocket error:', err.message);
      });
    });
    
    console.log('🔌 WebSocket server enabled on /api/v1/ws');
  } catch (error) {
    console.log('⚠️  WebSocket support not available (ws package not installed)');
  }
  
  server.listen(port, () => {
    console.log(`🚀 Server is running on port ${port}`);
    console.log(`📍 Health check: http://localhost:${port}/health`);
    console.log(`🔗 API base: http://localhost:${port}/api/v1`);
    console.log(`🔌 WebSocket: ws://localhost:${port}/api/v1/ws`);
  });
}
