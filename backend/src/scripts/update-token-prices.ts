import { config } from 'dotenv';
import { Pool } from 'pg';

// Load environment variables
config();

interface TokenPrice {
    value: number;
    updateUnixTime: number;
    price5m: number;
    price1h: number;
    price6h: number;
    price24h: number;
}

async function main() {
    console.log('Starting token price update script...');
    
    // Validate environment variables
    const dbUrl = process.env.DATABASE_URL;
    const birdeyeApiKey = process.env.BIRDEYE_API_KEY;
    
    if (!dbUrl) {
        throw new Error('DATABASE_URL environment variable is not set');
    }
    if (!birdeyeApiKey) {
        throw new Error('BIRDEYE_API_KEY environment variable is not set');
    }
    
    console.log('Environment variables configured');

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

    try {
        // First, add has_market column if it doesn't exist
        await pool.query(`
            ALTER TABLE token_prices 
            ADD COLUMN IF NOT EXISTS has_market BOOLEAN DEFAULT false
        `);

        // Get tokens that either have a market or haven't been checked yet
        const tokensResult = await pool.query(`
            SELECT t.mint_address 
            FROM tokens t
            LEFT JOIN token_prices tp ON t.mint_address = tp.mint_address
            WHERE tp.has_market IS NULL OR tp.has_market = true
            ORDER BY tp.has_market DESC NULLS LAST
        `);
        
        const mintAddresses = tokensResult.rows.map(row => row.mint_address);
        console.log(`Found ${mintAddresses.length} tokens to check`);

        // Process tokens in batches of 100
        const batchSize = 100;
        let successCount = 0;
        let noMarketCount = 0;
        let errorCount = 0;

        for (let i = 0; i < mintAddresses.length; i += batchSize) {
            const batch = mintAddresses.slice(i, i + batchSize);
            const batchNumber = Math.floor(i / batchSize) + 1;
            const totalBatches = Math.ceil(mintAddresses.length / batchSize);
            
            console.log(`Processing batch ${batchNumber} of ${totalBatches} (${batch.length} tokens)`);

            // Process each token in the batch
            for (const mintAddress of batch) {
                try {
                    // Fetch price data from Birdeye
                    const response = await fetch(`https://public-api.birdeye.so/public/price?address=${mintAddress}`, {
                        headers: {
                            'X-API-KEY': birdeyeApiKey,
                            'Accept': 'application/json'
                        }
                    });

                    if (response.status === 404) {
                        // Token has no market data
                        await pool.query(`
                            INSERT INTO token_prices (mint_address, has_market, last_updated)
                            VALUES ($1, false, NOW())
                            ON CONFLICT (mint_address) DO UPDATE
                            SET has_market = false, last_updated = NOW()
                        `, [mintAddress]);
                        noMarketCount++;
                        continue;
                    }

                    if (!response.ok) {
                        throw new Error(`Birdeye API error: ${response.status} - ${response.statusText}`);
                    }

                    const data = await response.json();
                    
                    if (data.success && data.data) {
                        const priceData: TokenPrice = data.data;
                        
                        // Update token_prices table
                        await pool.query(`
                            INSERT INTO token_prices (
                                mint_address,
                                current_price_usd,
                                price_5m_usd,
                                price_1h_usd,
                                price_6h_usd,
                                price_24h_usd,
                                has_market,
                                last_updated
                            )
                            VALUES ($1, $2, $3, $4, $5, $6, true, NOW())
                            ON CONFLICT (mint_address) DO UPDATE
                            SET 
                                current_price_usd = EXCLUDED.current_price_usd,
                                price_5m_usd = EXCLUDED.price_5m_usd,
                                price_1h_usd = EXCLUDED.price_1h_usd,
                                price_6h_usd = EXCLUDED.price_6h_usd,
                                price_24h_usd = EXCLUDED.price_24h_usd,
                                has_market = true,
                                last_updated = NOW()
                        `, [
                            mintAddress,
                            priceData.value,
                            priceData.price5m,
                            priceData.price1h,
                            priceData.price6h,
                            priceData.price24h
                        ]);

                        successCount++;
                    } else {
                        console.warn(`No price data available for token: ${mintAddress}`);
                        errorCount++;
                    }

                    // Add a small delay to respect rate limits (5 requests per second)
                    await new Promise(resolve => setTimeout(resolve, 200));

                } catch (error) {
                    if (error instanceof Error && !error.message.includes('404')) {
                        console.error(`Error processing token ${mintAddress}:`, error);
                        errorCount++;
                    }
                }
            }

            console.log(`Batch ${batchNumber} complete - Success: ${successCount}, No Market: ${noMarketCount}, Errors: ${errorCount}`);
        }

        // Print final statistics
        const stats = await pool.query(`
            SELECT 
                COUNT(*) as total_tokens,
                COUNT(*) FILTER (WHERE has_market = true) as tokens_with_market,
                COUNT(*) FILTER (WHERE has_market = false) as tokens_without_market,
                COUNT(*) FILTER (WHERE current_price_usd IS NOT NULL) as tokens_with_price
            FROM token_prices
        `);
        
        console.log('\nFinal Statistics:');
        console.log(`Total tokens processed: ${successCount + noMarketCount + errorCount}`);
        console.log(`Tokens with price updates: ${successCount}`);
        console.log(`Tokens without markets: ${noMarketCount}`);
        console.log(`Errors: ${errorCount}`);
        console.log('\nDatabase Status:');
        console.log(`Total tokens: ${stats.rows[0].total_tokens}`);
        console.log(`Tokens with active markets: ${stats.rows[0].tokens_with_market}`);
        console.log(`Tokens without markets: ${stats.rows[0].tokens_without_market}`);
        console.log(`Tokens with current prices: ${stats.rows[0].tokens_with_price}`);

    } catch (error) {
        console.error('Fatal error during price update:', error);
        throw error;
    } finally {
        await pool.end();
        console.log('Database connection closed');
    }
}

// Run the script
main().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
}); 