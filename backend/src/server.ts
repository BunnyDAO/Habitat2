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
import { TokenService as PairTradeTokenService } from './services/TokenService';
import healthRoutes from './api/v1/routes/health.routes';
import { createPriceFeedRouter } from './api/v1/routes/price-feed.routes';
import { createChartDataRouter } from './api/v1/routes/chart-data.routes';
import { createWhaleTrackingRouter } from './api/v1/routes/whale-tracking.routes';
import { createProxyRouter } from './api/v1/routes/proxy.routes';
import { createTokenMetadataRouter } from './api/v1/routes/token-metadata.routes';
import { createSwapRouter } from './api/v1/routes/swap.routes';
import { createJupiterRouter } from './api/v1/routes/jupiter.routes';
import { createStrategiesRouter } from './routes/strategies.routes';
import authRouter from './routes/auth.routes';
import walletTransactionRouter from './routes/wallet-transaction.routes';
import savedWalletsRouter from './routes/saved-wallets.routes';
import rpcRouter from './routes/rpc.routes';
import strategyPublishingRouter from './routes/strategy-publishing.routes';
import strategyMarketplaceRouter from './routes/strategy-marketplace.routes';
import strategyReviewsRouter from './routes/strategy-reviews.routes';
import { createValuationRoutes } from './routes/valuation.routes';
import { createTriggersRoutes } from './routes/triggers.routes';
import driftRouter from './routes/drift.routes';
import { config, getEnvironmentName, getLogLevel } from './config/environment';

// Load environment variables from the correct path
dotenv.config({ path: path.resolve(__dirname, '../.env') });

export function createApp() {
  const app = express();

  // Log environment information
  console.log(`🚀 Starting Lackey backend in ${getEnvironmentName()} mode`);
  console.log(`📊 Log level: ${getLogLevel()}`);
  console.log(`🌐 CORS origins: ${config.corsOrigins.join(', ')}`);

  // Initialize Solana connection
  const connection = new Connection(
    process.env.RPC_URL || 'https://api.mainnet-beta.solana.com',
    'confirmed'
  );

  // Initialize database connection using the new pool
  const pool = require('./database/pool').default;

  // Initialize Redis client with environment-specific configuration
  let redisClient: ReturnType<typeof createClient> | null = null;
  
  if (config.redisEnabled) {
    try {
      redisClient = createClient({
        url: config.redisUrl,
        socket: {
          connectTimeout: 10000,
        },
      });

      redisClient.on('error', (err) => {
        console.error('❌ Redis Client Error:', err);
      });

      redisClient.on('connect', () => {
        console.log('✅ Redis Client Connected');
      });

      redisClient.on('ready', () => {
        console.log('✅ Redis Client Ready');
      });

      // Connect to Redis
      redisClient.connect().catch(console.error);
    } catch (error) {
      console.warn('⚠️ Redis not available, continuing without Redis');
      redisClient = null;
    }
  } else {
    console.log('⚠️ Redis disabled for this environment');
  }

  // Initialize services
  const heliusService = new HeliusService(config.heliusApiKey);
  const tokenService = new TokenService(pool);
  const pairTradeTokenService = new PairTradeTokenService(pool, redisClient);

  // Initialize supported tokens for pair trading on startup
  setTimeout(async () => {
    try {
      console.log('🪙 Pair trade token service ready');
      console.log('💡 To initialize tokens, run: npm run update-xstock-tokens');
      console.log('✅ Token service initialized successfully');
    } catch (error) {
      console.error('❌ Error initializing token service:', error);
    }
  }, 2000); // Wait 2 seconds for database connection to be ready

  // Configure CORS based on environment
  app.use(cors({
    origin: config.corsOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH','OPTIONS', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'solana-client'],
    credentials: true
  }));

  app.use(express.json());

  // Register routes with /api prefix for compatibility
  app.use('/api/auth', authRouter);
  app.use('/api/rpc', rpcRouter);
  app.use('/api/trading-wallets', createTradingWalletsRouter());
  app.use('/api/strategies', createStrategiesRouter(pool, redisClient));
  app.use('/api/saved-wallets', savedWalletsRouter);
  app.use('/api/wallet-transactions', walletTransactionRouter);
  app.use('/api/drift', driftRouter);

  // Also register with /api/v1 prefix 
  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/rpc', rpcRouter);
  app.use('/api/v1/trading-wallets', createTradingWalletsRouter());
  app.use('/api/v1/wallet-balances', createWalletBalancesRouter(pool));
  app.use('/api/v1/tokens', createTokenRouter(tokenService));
  app.use('/api/v1/swap', createSwapRouter(pool, connection));
  app.use('/api/v1/jupiter', createJupiterRouter(pool, redisClient));
  app.use('/api/v1', healthRoutes);
  app.use('/api/v1', createPriceFeedRouter(redisClient, heliusService));
  app.use('/api/v1/strategies', createStrategiesRouter(pool, redisClient));
  app.use('/api/v1/saved-wallets', savedWalletsRouter);
  app.use('/api/v1/wallet-transactions', walletTransactionRouter);
  app.use('/api/v1/valuation', createValuationRoutes(pool));
  app.use('/api/v1/triggers', createTriggersRoutes(pool));
  app.use('/api/v1/drift', driftRouter);
  
  // Strategy Publishing and Marketplace routes
  app.use('/api/strategies', strategyPublishingRouter);
  app.use('/api/shop', strategyMarketplaceRouter);
  app.use('/api/shop', strategyReviewsRouter);

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({ 
      status: 'ok',
      environment: getEnvironmentName(),
      redis: redisClient ? 'connected' : 'not connected',
      database: 'connected', // Pool handles this
      timestamp: new Date().toISOString()
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
