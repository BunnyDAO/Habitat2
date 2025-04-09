import { Pool } from 'pg';
import { createClient } from 'redis';
import dotenv from 'dotenv';
import { WalletMonitorService } from '../services/wallet-monitor.service';

dotenv.config();

async function main() {
    console.log('Starting wallet monitor script...');
    
    // Validate environment variables
    const dbUrl = process.env.DATABASE_URL;
    const heliusApiKey = process.env.HELIUS_API_KEY;
    const redisHost = process.env.REDIS_HOST;
    const redisPort = process.env.REDIS_PORT;
    const redisPassword = process.env.REDIS_PASSWORD;
    
    if (!dbUrl) {
        throw new Error('DATABASE_URL environment variable is not set');
    }
    if (!heliusApiKey) {
        throw new Error('HELIUS_API_KEY environment variable is not set');
    }

    // Initialize database connection
    const pool = new Pool({
        connectionString: dbUrl,
        ssl: {
            rejectUnauthorized: false
        }
    });

    // Test database connection
    try {
        const result = await pool.query('SELECT NOW()');
        console.log('Successfully connected to database at:', result.rows[0].now);
    } catch (error) {
        console.error('Failed to connect to database:', error);
        process.exit(1);
    }

    // Initialize Redis client if configured
    let redisClient = null;
    if (redisHost && redisPort && redisPassword) {
        try {
            redisClient = createClient({
                url: `redis://:${redisPassword}@${redisHost}:${redisPort}`
            });
            await redisClient.connect();
            console.log('Successfully connected to Redis');
        } catch (error) {
            console.warn('Failed to connect to Redis, continuing without caching:', error);
        }
    }

    // Initialize and start the wallet monitor service
    const service = new WalletMonitorService(
        pool,
        redisClient,
        heliusApiKey,
        5000 // Update every 5 seconds
    );

    // Add a test wallet to monitor (this is BunnyDAO's treasury wallet)
    console.log('Adding test wallet to monitor...');
    await service.addWallet('DaoSrx3wBdRM5oHzwC4synAe8GkMB46tXgBwQmxsgWqc');

    // Handle shutdown gracefully
    process.on('SIGINT', async () => {
        console.log('Received SIGINT. Shutting down...');
        service.stop();
        await pool.end();
        if (redisClient?.isOpen) {
            await redisClient.quit();
        }
        process.exit(0);
    });

    // Start the service
    await service.start();
}

// Run the script
main().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
}); 