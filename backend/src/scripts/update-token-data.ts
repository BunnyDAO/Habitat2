import { config } from 'dotenv';
import { Pool } from 'pg';
import { createClient } from 'redis';
import { JupiterService } from '../services/jupiter.service';

// Load environment variables
config();

async function main() {
    console.log('Starting token data update script...');
    
    // Validate environment variables
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
        throw new Error('DATABASE_URL environment variable is not set');
    }
    console.log('Database URL is configured');

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
    if (process.env.REDIS_URL) {
        try {
            redisClient = createClient({
                url: process.env.REDIS_URL
            });
            await redisClient.connect();
            console.log('Successfully connected to Redis');
        } catch (error) {
            console.warn('Failed to connect to Redis, continuing without caching:', error);
        }
    }

    // Initialize Jupiter service
    const jupiterService = new JupiterService(pool, redisClient);

    try {
        // Update token data
        await jupiterService.updateTokenData();

        // Verify the update
        const tokenCount = await pool.query('SELECT COUNT(*) FROM tokens');
        const priceCount = await pool.query('SELECT COUNT(*) FROM token_prices');
        console.log('Final database state:');
        console.log(`- Total tokens: ${tokenCount.rows[0].count}`);
        console.log(`- Total prices: ${priceCount.rows[0].count}`);

        // Sample some recent tokens
        const recentTokens = await pool.query(`
            SELECT t.mint_address, t.name, t.symbol, tp.current_price_usd, t.last_updated
            FROM tokens t
            LEFT JOIN token_prices tp ON t.mint_address = tp.mint_address
            ORDER BY t.last_updated DESC
            LIMIT 5
        `);
        console.log('\nRecent token updates:');
        recentTokens.rows.forEach(token => {
            console.log(`- ${token.name} (${token.symbol}): $${token.current_price_usd || 'N/A'}`);
        });

    } catch (error) {
        console.error('Error updating token data:', error);
        process.exit(1);
    } finally {
        // Cleanup
        await pool.end();
        if (redisClient?.isOpen) {
            await redisClient.quit();
        }
        console.log('Connections closed');
    }
}

// Run the script
main().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
}); 