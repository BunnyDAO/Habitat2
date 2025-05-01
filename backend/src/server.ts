import express from 'express';
import cors from 'cors';
import { createClient } from 'redis';
import { HeliusService } from './services/helius.service';
import dotenv from 'dotenv';
import path from 'path';
import { Pool } from 'pg';
import { Connection } from '@solana/web3.js';
import { createTradingWalletsRouter } from './routes/trading-wallets.routes';
import { createWalletBalancesRouter } from './routes/wallet-balances.routes';
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
import WebSocket from 'ws';
import { createServer, Server as HttpServer } from 'http';
import { Server as WebSocketServer } from 'ws';
import { Socket } from 'net';

// Load environment variables from the correct path
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const app = express();
const port = process.env.PORT || 3001;

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

// Add error handler for database connection
pool.on('error', (err) => {
  console.error('Unexpected error on idle database client', err);
  process.exit(-1);
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
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/trading-wallets', createTradingWalletsRouter(pool));
app.use('/api/v1/wallet-balances', createWalletBalancesRouter(pool));
app.use('/api/v1/tokens', createTokenRouter(tokenService));

// Register v1 API routes
app.use('/api/v1', healthRoutes);
app.use('/api/v1', createPriceFeedRouter(redisClient, heliusService));

// After other route initializations
const chartDataRouter = createChartDataRouter(redisClient, tokenService);
app.use('/api/v1/chart-data', chartDataRouter);

const whaleTrackingRouter = createWhaleTrackingRouter(redisClient, heliusService);
app.use('/api/v1/whale-tracking', whaleTrackingRouter);

// Add proxy routes
app.use('/api/v1/proxy', createProxyRouter());

// Add token metadata routes
const tokenMetadataRouter = createTokenMetadataRouter(pool, redisClient);
app.use('/api/v1/token-metadata', tokenMetadataRouter);

// Add wallet balances routes
const walletBalancesRouter = createWalletBalancesRouter(pool);
app.use('/api/v1/wallet-balances', walletBalancesRouter);

// Add swap routes
const swapRouter = createSwapRouter(pool, connection);
app.use('/api/v1/swap', swapRouter);

// Add strategies routes
app.use('/api/v1/strategies', strategiesRouter);

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
app.post('/api/rpc', async (req, res) => {
  try {
    const { method, params } = req.body;
    console.log('Received RPC request:', { method, params });
    
    // Check if Helius API key is available
    const heliusApiKey = process.env.HELIUS_API_KEY;
    if (!heliusApiKey) {
      console.error('Helius API key not found');
      return res.status(500).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Helius API key not configured'
        },
        id: req.body.id
      });
    }

    // Forward the request to Helius
    const response = await fetch(`https://mainnet.helius-rpc.com/?api-key=${heliusApiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: req.body.id || Date.now(),
        method: req.body.method,
        params: req.body.params
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Helius API error:', errorText);
      return res.status(response.status).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: `Helius API error: ${response.statusText}`,
          data: errorText
        },
        id: req.body.id
      });
    }

    const data = await response.json();
    if (data.error) {
      console.error('Helius RPC error:', data.error);
      return res.status(500).json(data);
    }

    res.json(data);
  } catch (error) {
    console.error('Error handling RPC request:', error);
    res.status(500).json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: error instanceof Error ? error.message : 'Internal error',
        data: error instanceof Error ? error.stack : undefined
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

// Create HTTP server and WebSocket server
const server: HttpServer = createServer(app);
const wss = new WebSocketServer({ noServer: true });

// Start the server
server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

// Handle WebSocket upgrade requests
server.on('upgrade', (request, socket: Socket, head) => {
  const url = request.url || '/';
  const pathname = new URL(url, `http://${request.headers.host || 'localhost'}`).pathname;

  // Handle both /api/v1/ws and /api/rpc paths
  if (pathname === '/api/v1/ws' || pathname === '/api/rpc') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws);
    });
  } else {
    socket.destroy();
  }
});

// Create a single persistent Helius WebSocket connection
let heliusWs: WebSocket | null = null;
let reconnectTimeout: NodeJS.Timeout | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const INITIAL_RECONNECT_DELAY = 1000; // 1 second
let isConnecting = false;

// Track subscriptions
interface Subscription {
  id: number;
  method: string;
  params: unknown[];
  clientWs: WebSocket;
}

const subscriptions = new Map<number, Subscription>();
let nextSubscriptionId = 1;

function connectToHelius() {
  if (isConnecting) {
    console.log('Already attempting to connect, skipping...');
    return;
  }

  isConnecting = true;
  console.log('Initiating Helius WebSocket connection...');

  // Only close existing connection if it's in a state that can be closed
  if (heliusWs && heliusWs.readyState === WebSocket.OPEN) {
    heliusWs.close();
  }

  const newWs = new WebSocket(`wss://mainnet.helius-rpc.com/ws?api-key=${process.env.HELIUS_API_KEY}`);

  newWs.on('open', () => {
    console.log('Successfully connected to Helius WebSocket');
    heliusWs = newWs;
    isConnecting = false;
    reconnectAttempts = 0;

    // Resubscribe to all active subscriptions
    for (const [id, sub] of subscriptions) {
      const request = {
        jsonrpc: '2.0',
        id,
        method: sub.method,
        params: sub.params
      };
      newWs.send(JSON.stringify(request));
    }
  });

  newWs.on('error', (error: Error) => {
    console.error('Helius WebSocket error:', error);
    isConnecting = false;
    if (newWs === heliusWs) {
      heliusWs = null;
    }
  });

  newWs.on('close', () => {
    console.log('Helius WebSocket connection closed');
    isConnecting = false;
    if (newWs === heliusWs) {
      heliusWs = null;
      attemptReconnect();
    }
  });

  // Handle messages from Helius
  newWs.on('message', (data: Buffer) => {
    try {
      const message = JSON.parse(data.toString());
      
      // If this is a subscription notification
      if (message.method && message.method.endsWith('Notification')) {
        // Forward to all relevant clients
        for (const sub of subscriptions.values()) {
          if (sub.clientWs.readyState === WebSocket.OPEN) {
            sub.clientWs.send(data);
          }
        }
      } 
      // If this is a subscription response
      else if (message.id && subscriptions.has(message.id)) {
        const sub = subscriptions.get(message.id)!;
        if (sub.clientWs.readyState === WebSocket.OPEN) {
          sub.clientWs.send(data);
        }
      }
    } catch (error) {
      console.error('Error handling Helius message:', error);
    }
  });
}

function attemptReconnect() {
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    console.error('Max reconnection attempts reached. Please check your Helius API key and rate limits.');
    return;
  }

  const delay = INITIAL_RECONNECT_DELAY * Math.pow(2, reconnectAttempts);
  console.log(`Attempting to reconnect in ${delay}ms (attempt ${reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS})`);

  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
  }

  reconnectTimeout = setTimeout(() => {
    reconnectAttempts++;
    connectToHelius();
  }, delay);
}

// Initialize Helius connection
connectToHelius();

wss.on('connection', (ws: WebSocket) => {
  console.log('New client WebSocket connection');

  ws.on('message', async (message: Buffer) => {
    try {
      if (!heliusWs || heliusWs.readyState !== WebSocket.OPEN) {
        console.log('Helius WebSocket not ready, attempting to reconnect...');
        connectToHelius();
        ws.send(JSON.stringify({ 
          jsonrpc: '2.0',
          error: { code: -32000, message: 'WebSocket temporarily unavailable, reconnecting...' },
          id: null
        }));
        return;
      }

      const request = JSON.parse(message.toString());
      
      // Handle subscription requests
      if (request.method && request.method.endsWith('Subscribe')) {
        const subscriptionId = nextSubscriptionId++;
        subscriptions.set(subscriptionId, {
          id: subscriptionId,
          method: request.method,
          params: request.params,
          clientWs: ws
        });
        
        // Modify the request to use our subscription ID
        request.id = subscriptionId;
      }

      heliusWs.send(JSON.stringify(request));
    } catch (error) {
      console.error('Error handling WebSocket message:', error);
      ws.send(JSON.stringify({ 
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Failed to process WebSocket message' },
        id: null
      }));
    }
  });

  ws.on('error', (error: Error) => {
    console.error('Client WebSocket error:', error);
  });

  ws.on('close', () => {
    console.log('Client WebSocket connection closed');
    // Remove all subscriptions for this client
    for (const [id, sub] of subscriptions) {
      if (sub.clientWs === ws) {
        subscriptions.delete(id);
      }
    }
  });
});

// Cleanup on server shutdown
process.on('SIGTERM', () => {
  if (heliusWs) {
    heliusWs.close();
  }
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
  }
  server.close();
}); 