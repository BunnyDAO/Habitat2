import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

async function checkData() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: {
            rejectUnauthorized: false
        }
    });

    try {
        // Check tokens table
        const tokenCount = await pool.query('SELECT COUNT(*) FROM tokens');
        console.log('\nTokens table count:', tokenCount.rows[0].count);

        // Sample some well-known tokens
        const tokens = await pool.query(`
            SELECT mint_address, name, symbol, decimals, logo_uri 
            FROM tokens 
            WHERE symbol IN ('SOL', 'USDC', 'BONK')
            LIMIT 3
        `);
        console.log('\nSample tokens:', JSON.stringify(tokens.rows, null, 2));

        // Check token_prices table
        const priceCount = await pool.query('SELECT COUNT(*) FROM token_prices');
        console.log('\nToken prices count:', priceCount.rows[0].count);

        // Sample some prices
        const prices = await pool.query(`
            SELECT t.symbol, tp.mint_address, tp.current_price_usd, tp.last_updated
            FROM token_prices tp
            JOIN tokens t ON t.mint_address = tp.mint_address
            WHERE t.symbol IN ('SOL', 'USDC', 'BONK')
            LIMIT 3
        `);
        console.log('\nSample prices:', JSON.stringify(prices.rows, null, 2));

    } catch (error) {
        console.error('Error checking data:', error);
    } finally {
        await pool.end();
    }
}

checkData(); 