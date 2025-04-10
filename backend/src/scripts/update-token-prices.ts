import { config } from 'dotenv';
import { Pool } from 'pg';

// Load environment variables
config();

// API constants
const BIRDEYE_API_BASE = 'https://public-api.birdeye.so';

// Interface definitions
interface TokenListData {
    address: string;
    symbol: string;
    name: string;
    decimals: number;
    logoURI?: string;
    liquidity: number;
    mc: number;
    price: number;
    v24hUSD: number;
    v24hChangePercent: number;
}

interface TokenListResponse {
    success: boolean;
    message?: string;
    data: {
        updateUnixTime: number;
        updateTime: string;
        tokens: TokenListData[];
    };
}

interface TokenPriceResponse {
    success: boolean;
    message?: string;
    data: {
        value: number;
        updateUnixTime: number;
        updateHumanTime: string;
        priceChange24h: number;
        priceInNative: number;
    };
}

interface PriceHistoryResponse {
    success: boolean;
    data: {
        items: Array<{
            unixTime: number;
            value: number;
        }>;
    };
}

interface RequestOptions {
    headers: {
        'X-API-KEY': string;
        'X-CHAIN': string;
        'Accept': string;
    };
}

// Helper function to add delay between requests
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Helper function to fetch data with retries and exponential backoff
async function fetchWithRetry<T>(url: string, options: RequestOptions, retries = 3): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options);
      const data = await response.json();
      
      console.log('Raw API Response:', JSON.stringify(data, null, 2));
      
      if (!data.success) {
        if (data.message === 'Too many requests') {
          // Exponential backoff for rate limiting
          const backoffTime = Math.pow(2, i + 1) * 1000; // 2s, 4s, 8s
          console.log(`Rate limited. Waiting ${backoffTime/1000}s before retry...`);
          await delay(backoffTime);
          continue;
        }
        throw new Error(`API request failed: ${data.message || 'Unknown error'} - Raw response: ${JSON.stringify(data)}`);
      }
      
      return data;
    } catch (error) {
      if (i === retries - 1) throw error;
      console.log(`Retry ${i + 1} failed:`, error);
      const backoffTime = Math.pow(2, i + 1) * 1000;
      await delay(backoffTime);
    }
  }
  throw new Error('Max retries reached');
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
    console.log('Using Birdeye API Key:', birdeyeApiKey.substring(0, 8) + '...');

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
        // First, add new columns if they don't exist
        await pool.query(`
            ALTER TABLE token_prices 
            ADD COLUMN IF NOT EXISTS has_market BOOLEAN DEFAULT false,
            ADD COLUMN IF NOT EXISTS volume_24h_usd NUMERIC,
            ADD COLUMN IF NOT EXISTS liquidity_usd NUMERIC,
            ADD COLUMN IF NOT EXISTS market_cap_usd NUMERIC,
            ADD COLUMN IF NOT EXISTS price_change_24h_percent NUMERIC,
            ADD COLUMN IF NOT EXISTS total_supply NUMERIC,
            ADD COLUMN IF NOT EXISTS circulating_supply NUMERIC
        `);

        // Get a few well-known tokens first as a test
        const testTokens = [
            'So11111111111111111111111111111111111111112', // SOL
            'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
            'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', // BONK
        ];

        console.log('\nTesting with known tokens first:');
        
        // First get the token list to get market data
        const tokenListResponse = await fetchWithRetry<TokenListResponse>(
            `${BIRDEYE_API_BASE}/defi/tokenlist`,
            {
                headers: {
                    'X-API-KEY': birdeyeApiKey,
                    'X-CHAIN': 'solana',
                    'Accept': 'application/json'
                }
            }
        );

        const tokenList = tokenListResponse.data.tokens;
        console.log('Token list fetched, processing test tokens...');

        for (const testToken of testTokens) {
            try {
                console.log(`\nFetching data for ${testToken}...`);
                
                // Fetch price data
                const priceResponse = await fetchWithRetry<TokenPriceResponse>(
                    `${BIRDEYE_API_BASE}/defi/price?address=${testToken}`,
                    {
                        headers: {
                            'X-API-KEY': birdeyeApiKey,
                            'X-CHAIN': 'solana',
                            'Accept': 'application/json'
                        }
                    }
                );

                const priceData = priceResponse.data;
                console.log('Price data response:', JSON.stringify(priceData, null, 2));

                // Find token in token list for market data
                const marketData = tokenList.find(t => t.address === testToken);
                if (!marketData) {
                    console.log(`No market data found for token ${testToken}`);
                    continue;
                }

                console.log('Market data found:', JSON.stringify(marketData, null, 2));

                // Fetch price history data
                const timeframes = [
                    { type: '1h', column: 'price_1h_usd' },
                    { type: '24h', column: 'price_24h_usd' }
                ];

                const historicalPrices: Record<string, number> = {};
                
                for (const timeframe of timeframes) {
                    try {
                        // Ensure we wait at least 1 second between requests
                        await delay(1100); // 1.1s to be safe
                        
                        const timeFromValue = Math.floor(Date.now() / 1000) - (timeframe.type === '1h' ? 3600 : 86400);
                        const queryParams = new URLSearchParams({
                            address: testToken,
                            address_type: 'token',
                            type: timeframe.type,
                            time_from: timeFromValue.toString()
                        });

                        const historyResponse = await fetchWithRetry<PriceHistoryResponse>(
                            `${BIRDEYE_API_BASE}/defi/history_price?${queryParams}`,
                            {
                                headers: {
                                    'X-API-KEY': birdeyeApiKey,
                                    'X-CHAIN': 'solana',
                                    'Accept': 'application/json'
                                }
                            }
                        );
                        
                        if (historyResponse.success && historyResponse.data.items.length > 0) {
                            // Get the oldest price in the timeframe
                            const oldestPrice = historyResponse.data.items[0]?.value;
                            if (oldestPrice) {
                                historicalPrices[timeframe.column] = oldestPrice;
                                console.log(`Got ${timeframe.type} historical price for ${testToken}:`, oldestPrice);
                            }
                        } else {
                            console.log(`No historical price data available for ${timeframe.type} timeframe`);
                        }
                    } catch (error) {
                        console.log(`Failed to fetch ${timeframe.type} historical price:`, error);
                    }
                }

                // Skip metadata for now since we have market cap from token list
                // We can add it back if you need the supply information specifically

                // Update token in database with available data
                const updateResult = await pool.query(`
                    INSERT INTO token_prices (
                        mint_address,
                        current_price_usd,
                        price_1h_usd,
                        price_24h_usd,
                        volume_24h_usd,
                        liquidity_usd,
                        market_cap_usd,
                        price_change_24h_percent,
                        has_market,
                        last_updated
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, NOW())
                    ON CONFLICT (mint_address) DO UPDATE
                    SET 
                        current_price_usd = EXCLUDED.current_price_usd,
                        price_1h_usd = EXCLUDED.price_1h_usd,
                        price_24h_usd = EXCLUDED.price_24h_usd,
                        volume_24h_usd = EXCLUDED.volume_24h_usd,
                        liquidity_usd = EXCLUDED.liquidity_usd,
                        market_cap_usd = EXCLUDED.market_cap_usd,
                        price_change_24h_percent = EXCLUDED.price_change_24h_percent,
                        has_market = true,
                        last_updated = NOW()
                    RETURNING *
                `, [
                    testToken,
                    priceData.value,
                    historicalPrices['price_1h_usd'],
                    historicalPrices['price_24h_usd'],
                    marketData.v24hUSD,
                    marketData.liquidity,
                    marketData.mc,
                    priceData.priceChange24h
                ]);

                console.log('Database update result:', updateResult.rows[0]);
            } catch (error) {
                console.error(`Error testing token ${testToken}:`, error);
            }
            // Add delay between test requests
            await delay(1000);
        }

        // Check the database state for test tokens
        console.log('\nVerifying database state for test tokens:');
        const verifyResult = await pool.query(`
            SELECT 
                mint_address, 
                current_price_usd, 
                price_1h_usd,
                price_24h_usd,
                volume_24h_usd,
                liquidity_usd,
                market_cap_usd,
                price_change_24h_percent,
                has_market,
                last_updated
            FROM token_prices
            WHERE mint_address = ANY($1)
        `, [testTokens]);

        console.log('Current database state for test tokens:');
        console.table(verifyResult.rows);

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