import express from 'express';
import cors from 'cors';
import { Pool } from 'pg';
import { createClient } from 'redis';
import { StrategyExecutorService } from './services/strategy-executor.service';
import { HeliusService } from './services/helius.service';

const app = express();
const port = process.env.PORT || 3001;

// Initialize dependencies
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

const redisClient = process.env.REDIS_URL ? createClient({ url: process.env.REDIS_URL }) : null;
if (redisClient) {
  redisClient.connect().catch(console.error);
}

const heliusService = new HeliusService(process.env.HELIUS_API_KEY || '', redisClient);

// Middleware
app.use(cors());
app.use(express.json());

// Start automation service
const strategyExecutor = StrategyExecutorService.getInstance(pool, redisClient, heliusService);
strategyExecutor.start().catch(error => {
  console.error('Failed to start strategy executor:', error);
  process.exit(1);
});

// Routes
// ... existing routes ...

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
}); 