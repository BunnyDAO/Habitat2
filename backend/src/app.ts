import express from 'express';
import cors from 'cors';
import { Pool } from 'pg';
import { Connection } from '@solana/web3.js';
import { createClient } from 'redis';
import { createJupiterRouter } from './api/v1/routes/jupiter.routes';
import { createSwapRouter } from './api/v1/routes/swap.routes';

const app = express();
const port = process.env.PORT || 3001;

// Initialize services
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

const connection = new Connection(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com');
const redisClient = process.env.REDIS_URL ? createClient({ url: process.env.REDIS_URL }) : null;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/v1/jupiter', createJupiterRouter(redisClient));
app.use('/api/v1/swap', createSwapRouter(pool, connection));

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

// Error handling
app.use((err: Error, req: express.Request, res: express.Response) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something broke!' });
});

// Start server
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
}); 