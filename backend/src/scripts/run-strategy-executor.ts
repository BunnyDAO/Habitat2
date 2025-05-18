import { Pool } from 'pg';
import { createClient } from 'redis';
import { HeliusService } from '../services/helius.service';
import { StrategyExecutorService } from '../services/strategy-executor.service';
import dotenv from 'dotenv';

async function main() {
  // Load environment variables
  dotenv.config();

  // Initialize database connection
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  // Initialize Redis client (optional)
  let redisClient = null;
  if (process.env.REDIS_URL) {
    try {
      redisClient = createClient({
        url: process.env.REDIS_URL,
      });
      await redisClient.connect();
      console.log('Successfully connected to Redis');
    } catch (error) {
      console.warn('Failed to connect to Redis, continuing without Redis support:', error);
      redisClient = null;
    }
  } else {
    console.log('No Redis URL provided, running without Redis support');
  }

  // Initialize Helius service
  const heliusService = new HeliusService(process.env.HELIUS_API_KEY || '');

  // Initialize strategy executor service
  const strategyExecutor = StrategyExecutorService.getInstance(pool, redisClient, heliusService);

  // Start the strategy executor service
  await strategyExecutor.start();

  // Handle process termination
  process.on('SIGINT', async () => {
    console.log('Received SIGINT. Stopping strategy executor...');
    strategyExecutor.stop();
    if (redisClient) {
      await redisClient.quit();
    }
    await pool.end();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('Received SIGTERM. Stopping strategy executor...');
    strategyExecutor.stop();
    if (redisClient) {
      await redisClient.quit();
    }
    await pool.end();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('Error in strategy executor:', error);
  process.exit(1);
}); 