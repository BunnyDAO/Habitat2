import express from 'express';
import { Pool } from 'pg';
import { createTradingWalletsRouter } from './routes/trading-wallets.routes';

const app = express();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

app.use(express.json());

// Register routes
app.use('/api/trading-wallets', createTradingWalletsRouter(pool));

// ... existing code ... 