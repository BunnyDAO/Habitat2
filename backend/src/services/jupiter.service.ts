import { Pool } from 'pg';
import { createClient } from 'redis';

interface JupiterToken {
    address: string;
    symbol: string;
    name: string;
    decimals: number;
    logoURI?: string;
    price?: number;
}

interface JupiterQuoteResponse {
    inAmount: string;
    outAmount: string;
    priceImpactPct: number;
    marketInfos: any[];
    amount: string;
    slippageBps: number;
    otherAmountThreshold: string;
    swapMode: string;
    fees: {
        signatureFee: number;
        openOrdersDeposits: number[];
        ataDeposits: number[];
        totalFeeAndDeposits: number;
        minimumSOLForTransaction: number;
    };
}

export class JupiterService {
    private pool: Pool;
    private redisClient: ReturnType<typeof createClient> | null;
    private JUPITER_API_URL = 'https://token.jup.ag/all';
    private CACHE_KEY = 'jupiter:tokens';
    private CACHE_DURATION = 300; // 5 minutes in seconds
    private CACHE_TTL = 300; // 5 minutes in seconds

    constructor(pool: Pool, redisClient: ReturnType<typeof createClient> | null = null) {
        this.pool = pool;
        this.redisClient = redisClient;
    }

    async updateTokenData() {
        let client;
        try {
            console.log('Fetching token data from Jupiter...');
            const response = await fetch(this.JUPITER_API_URL);
            if (!response.ok) {
                throw new Error(`Jupiter API error: ${response.status} - ${response.statusText}`);
            }

            const data = await response.json();
            if (!Array.isArray(data)) {
                throw new Error(`Invalid response format from Jupiter API: ${JSON.stringify(data).slice(0, 100)}...`);
            }

            const tokens: JupiterToken[] = data;
            console.log(`Fetched ${tokens.length} tokens from Jupiter`);

            // Process tokens in batches
            const batchSize = 100;
            let totalSuccessCount = 0;
            let totalErrorCount = 0;

            for (let i = 0; i < tokens.length; i += batchSize) {
                client = await this.pool.connect();
                let batchSuccessCount = 0;
                let batchErrorCount = 0;

                try {
                    const batch = tokens.slice(i, i + batchSize);
                    const batchNumber = Math.floor(i / batchSize) + 1;
                    const totalBatches = Math.ceil(tokens.length / batchSize);
                    console.log(`Processing batch ${batchNumber} of ${totalBatches} (${batch.length} tokens)`);

                    await client.query('BEGIN');

                    for (const token of batch) {
                        try {
                            if (!token.address || !token.symbol || !token.name || token.decimals === undefined) {
                                console.warn('Skipping invalid token:', token);
                                continue;
                            }

                            const tokenResult = await client.query(`
                                INSERT INTO tokens (mint_address, name, symbol, decimals, logo_uri, last_updated)
                                VALUES ($1, $2, $3, $4, $5, NOW())
                                ON CONFLICT (mint_address) DO UPDATE
                                SET name = EXCLUDED.name,
                                    symbol = EXCLUDED.symbol,
                                    decimals = EXCLUDED.decimals,
                                    logo_uri = EXCLUDED.logo_uri,
                                    last_updated = NOW()
                                RETURNING mint_address
                            `, [token.address, token.name, token.symbol, token.decimals, token.logoURI]);

                            if (tokenResult?.rowCount && tokenResult.rowCount > 0) {
                                batchSuccessCount++;
                            }

                            if (token.price !== undefined && token.price !== null) {
                                await client.query(`
                                    INSERT INTO token_prices (mint_address, current_price_usd, last_updated)
                                    VALUES ($1, $2, NOW())
                                    ON CONFLICT (mint_address) DO UPDATE
                                    SET current_price_usd = EXCLUDED.current_price_usd,
                                        last_updated = NOW()
                                `, [token.address, token.price]);
                            }
                        } catch (tokenError) {
                            batchErrorCount++;
                            console.error(`Error processing token ${token.address}:`, tokenError);
                        }
                    }

                    await client.query('COMMIT');
                    totalSuccessCount += batchSuccessCount;
                    totalErrorCount += batchErrorCount;
                    console.log(`Batch ${batchNumber} committed - Success: ${batchSuccessCount}, Errors: ${batchErrorCount}`);

                } catch (batchError) {
                    await client.query('ROLLBACK');
                    const currentBatch = tokens.slice(i, i + batchSize);
                    console.error(`Batch ${Math.floor(i / batchSize) + 1} rolled back:`, batchError);
                    totalErrorCount += currentBatch.length;
                } finally {
                    client.release();
                }
            }

            console.log(`Update completed - Total Success: ${totalSuccessCount}, Total Errors: ${totalErrorCount}`);

            if (this.redisClient?.isOpen) {
                await this.redisClient.setEx(
                    this.CACHE_KEY,
                    this.CACHE_DURATION,
                    JSON.stringify(tokens)
                );
                console.log('Token data cached in Redis');
            }

        } catch (error) {
            console.error('Fatal error during token update:', error);
            throw error;
        }
    }

    async getTokenData(mintAddress: string): Promise<JupiterToken | null> {
        try {
            if (this.redisClient?.isOpen) {
                const cachedData = await this.redisClient.get(this.CACHE_KEY);
                if (cachedData) {
                    const tokens: JupiterToken[] = JSON.parse(cachedData);
                    const token = tokens.find(t => t.address === mintAddress);
                    if (token) return token;
                }
            }

            const result = await this.pool.query(`
                SELECT t.*, tp.current_price_usd as price
                FROM tokens t
                LEFT JOIN token_prices tp ON t.mint_address = tp.mint_address
                WHERE t.mint_address = $1
            `, [mintAddress]);

            if (result.rows[0]) {
                return {
                    address: result.rows[0].mint_address,
                    name: result.rows[0].name,
                    symbol: result.rows[0].symbol,
                    decimals: result.rows[0].decimals,
                    logoURI: result.rows[0].logo_uri,
                    price: result.rows[0].price
                };
            }

            return null;
        } catch (error) {
            console.error('Error fetching token data:', error);
            throw error;
        }
    }

    async getQuote(
        inputMint: string,
        outputMint: string,
        amount: number,
        slippageBps: number = 50,
        platformFeeBps: number = 0
    ): Promise<JupiterQuoteResponse> {
        try {
            // Check cache first
            const cacheKey = `jupiter:quote:${inputMint}:${outputMint}:${amount}:${platformFeeBps}`;
            if (this.redisClient) {
                const cachedQuote = await this.redisClient.get(cacheKey);
                if (cachedQuote) {
                    return JSON.parse(cachedQuote);
                }
            }

            // Fetch from Jupiter API
            const response = await fetch(
                `https://lite-api.jup.ag/swap/v1/quote?` +
                `inputMint=${inputMint}&` +
                `outputMint=${outputMint}&` +
                `amount=${amount}&` +
                `slippageBps=${slippageBps}&` +
                `restrictIntermediateTokens=true&` +
                `platformFeeBps=${platformFeeBps}`
            );

            if (!response.ok) {
                throw new Error(`Failed to get quote: ${response.statusText}`);
            }

            const quote = await response.json();

            // Cache the result
            if (this.redisClient) {
                await this.redisClient.setex(cacheKey, this.CACHE_TTL, JSON.stringify(quote));
            }

            return quote;
        } catch (error) {
            console.error('Error fetching quote:', error);
            throw error;
        }
    }

    async executeSwap(
        quoteResponse: JupiterQuoteResponse,
        userPublicKey: string,
        feeAccount?: string
    ): Promise<any> {
        try {
            const response = await fetch('https://api.jup.ag/swap/v1/swap', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    quoteResponse,
                    userPublicKey,
                    ...(feeAccount && { feeAccount })
                })
            });

            if (!response.ok) {
                throw new Error(`Failed to execute swap: ${response.statusText}`);
            }

            return await response.json();
        } catch (error) {
            console.error('Error executing swap:', error);
            throw error;
        }
    }

    async getTokenPrice(tokenMint: string): Promise<number> {
        try {
            // Check cache first
            const cacheKey = `jupiter:price:${tokenMint}`;
            if (this.redisClient) {
                const cachedPrice = await this.redisClient.get(cacheKey);
                if (cachedPrice) {
                    return parseFloat(cachedPrice);
                }
            }

            // Fetch from Jupiter API
            const response = await fetch(`https://price.jup.ag/v4/price?ids=${tokenMint}`);
            
            if (!response.ok) {
                throw new Error(`Failed to fetch token price: ${response.statusText}`);
            }

            const data = await response.json();
            const price = data.data[tokenMint]?.price || 0;

            // Cache the result
            if (this.redisClient) {
                await this.redisClient.setEx(cacheKey, this.CACHE_TTL, price.toString());
            }

            return price;
        } catch (error) {
            console.error('Error fetching token price:', error);
            throw error;
        }
    }

    async getTokenPrices(tokenMints: string[]): Promise<Record<string, number>> {
        try {
            // Check cache first
            const cacheKey = `jupiter:prices:${tokenMints.join(',')}`;
            if (this.redisClient) {
                const cachedPrices = await this.redisClient.get(cacheKey);
                if (cachedPrices) {
                    return JSON.parse(cachedPrices);
                }
            }

            // Fetch from Jupiter API
            const response = await fetch(`https://price.jup.ag/v4/price?ids=${tokenMints.join(',')}`);
            
            if (!response.ok) {
                throw new Error(`Failed to fetch token prices: ${response.statusText}`);
            }

            const data = await response.json();
            const prices: Record<string, number> = {};

            tokenMints.forEach(mint => {
                prices[mint] = data.data[mint]?.price || 0;
            });

            // Cache the result
            if (this.redisClient) {
                await this.redisClient.setEx(cacheKey, this.CACHE_TTL, JSON.stringify(prices));
            }

            return prices;
        } catch (error) {
            console.error('Error fetching token prices:', error);
            throw error;
        }
    }

    async getAllTokens(): Promise<JupiterToken[]> {
        try {
            // Check cache first
            if (this.redisClient) {
                const cachedTokens = await this.redisClient.get(this.CACHE_KEY);
                if (cachedTokens) {
                    return JSON.parse(cachedTokens);
                }
            }

            // Fetch from Jupiter API
            const response = await fetch(this.JUPITER_API_URL);
            
            if (!response.ok) {
                throw new Error(`Failed to fetch tokens: ${response.statusText}`);
            }

            const tokens = await response.json();

            // Cache the result
            if (this.redisClient) {
                await this.redisClient.setEx(this.CACHE_KEY, this.CACHE_DURATION, JSON.stringify(tokens));
            }

            return tokens;
        } catch (error) {
            console.error('Error fetching tokens:', error);
            throw error;
        }
    }
} 