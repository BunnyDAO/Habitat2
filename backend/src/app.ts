import express from 'express';
import { Pool } from 'pg';
import { createTradingWalletsRouter } from './routes/trading-wallets.routes';
import { createWalletBalancesRouter } from './routes/wallet-balances.routes';
import { router as whaleTrackingRouter, wss } from './routes/whale-tracking.routes';
import { createServer } from 'http';
import { WebSocket } from 'ws';
import { createClient } from 'redis';
import { createJupiterRouter } from './api/v1/routes/jupiter.routes';
import { createHeliusRouter } from './api/v1/routes/helius.routes';

const app = express();
const server = createServer(app);
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Initialize Redis client if REDIS_URL is provided
const redisClient = process.env.REDIS_URL 
  ? createClient({ url: process.env.REDIS_URL })
  : null;

if (redisClient) {
  redisClient.on('error', (err) => console.error('Redis Client Error', err));
  redisClient.connect();
}

app.use(express.json());

// API Routes
app.use('/api/v1/trading-wallets', createTradingWalletsRouter(pool));
app.use('/api/v1/wallet-balances', createWalletBalancesRouter(pool));
app.use('/api/v1/whale-tracking', whaleTrackingRouter);
app.use('/api/v1/jupiter', createJupiterRouter(redisClient));
app.use('/api/v1/helius', createHeliusRouter(redisClient, process.env.HELIUS_API_KEY || ''));

// Handle WebSocket connections
server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url || '', `http://${request.headers.host}`).pathname;

  if (pathname === '/api/v1/whale-tracking/ws') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

export { app, server }; 