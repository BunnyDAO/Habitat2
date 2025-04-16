import express from 'express';
import { Pool } from 'pg';
import { createTradingWalletsRouter } from './routes/trading-wallets.routes';
import { createWalletBalancesRouter } from './routes/wallet-balances.routes';
import { router as whaleTrackingRouter, wss } from './routes/whale-tracking.routes';
import { createServer } from 'http';
import { WebSocket } from 'ws';

const app = express();
const server = createServer(app);
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

app.use(express.json());

// API Routes
app.use('/api/v1/trading-wallets', createTradingWalletsRouter(pool));
app.use('/api/v1/wallet-balances', createWalletBalancesRouter(pool));
app.use('/api/v1/whale-tracking', whaleTrackingRouter);

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