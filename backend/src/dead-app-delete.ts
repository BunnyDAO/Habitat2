import express, { Request, Response, NextFunction } from 'express';
import { Pool } from 'pg';
import { Connection } from '@solana/web3.js';
import { createClient } from 'redis';
import { createJupiterRouter } from './api/v1/routes/jupiter.routes';
import { createSwapRouter } from './api/v1/routes/swap.routes';
import { createTradingWalletsRouter } from './routes/trading-wallets.routes';
import authRouter from './routes/auth.routes';
import cors from 'cors';
import { createHeliusRouter } from './api/v1/routes/helius.routes';
import savedWalletsRouter from './routes/saved-wallets.routes';

console.log('Starting server initialization...');

const app = express();
const port = process.env.PORT || 3001;

// Initialize services
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

// Test database connection
pool.query('SELECT NOW()', (err) => {
    if (err) {
        console.error('Error connecting to database:', err);
        process.exit(1);
    }
    console.log('Successfully connected to database');
});

const connection = new Connection(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com');
const redisClient = process.env.REDIS_URL ? createClient({ url: process.env.REDIS_URL }) : null;

// Configure CORS
app.use(cors({
  origin: 'http://localhost:5173',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'solana-client'],
  credentials: true
}));

// Debug middleware to log all requests
app.use((req, res, next) => {
  console.log('Incoming Request:', {
    method: req.method,
    path: req.path,
    body: req.body,
    headers: req.headers,
    origin: req.headers.origin
  });
  next();
});

app.use(express.json());

// Routes
console.log('Registering routes...');
app.use('/api/v1/auth', authRouter);
console.log('Auth routes registered');
app.use('/api/v1/trading-wallets', createTradingWalletsRouter());
console.log('Trading wallets routes registered');
app.use('/api/v1/saved-wallets', savedWalletsRouter);
console.log('Saved wallets routes registered');
app.use('/api/v1/swap', createSwapRouter(pool, connection));
console.log('Swap routes registered');
app.use('/api/v1/jupiter', createJupiterRouter(pool, redisClient));
console.log('Jupiter routes registered');

const heliusApiKey = process.env.HELIUS_API_KEY;
if (!heliusApiKey) {
  throw new Error('HELIUS_API_KEY is not set in environment variables');
}
app.use('/api/v1/helius', createHeliusRouter(heliusApiKey, redisClient));
console.log('Helius routes registered');

// Add a catch-all route for debugging
app.use('*', (req, res) => {
  console.log('404 - Route not found:', req.method, req.originalUrl);
  res.status(404).json({ 
    error: 'Route not found',
    method: req.method,
    path: req.originalUrl,
    headers: req.headers
  });
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', redis: redisClient ? 'connected' : 'not connected' });
});

// Debug route to list all registered paths
app.get('/debug/routes', (req, res) => {
    const routes: string[] = [];
    app._router.stack.forEach((middleware: { route?: { methods: Record<string, boolean>; path: string }; name?: string; handle?: { stack: Array<{ route?: { methods: Record<string, boolean>; path: string } }> }; regexp?: RegExp }) => {
        if (middleware.route) {
            // Routes registered directly on the app
            routes.push(`${Object.keys(middleware.route.methods).join(',')} ${middleware.route.path}`);
        } else if (middleware.name === 'router') {
            // Router middleware
            middleware.handle?.stack.forEach((handler) => {
                if (handler.route) {
                    routes.push(`${Object.keys(handler.route.methods).join(',')} ${middleware.regexp} ${handler.route.path}`);
                }
            });
        }
    });
    res.json({ routes });
});

// Error handling
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    console.error('Error:', err);
    res.status(500).json({ 
        error: 'Internal server error',
        message: err.message,
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
});

// Start server
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});

export default app; 