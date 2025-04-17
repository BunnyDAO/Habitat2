import { Pool } from 'pg';

interface TokenMetadata {
    mint_address: string;
    name: string;
    symbol: string;
    decimals: number;
    logo_uri: string | null;
}

interface JupiterTokenInfo {
    address: string;
    name: string;
    symbol: string;
    decimals: number;
    logoURI?: string;
    tags?: string[];
    daily_volume?: number;
    created_at?: string;
    freeze_authority?: string | null;
    mint_authority?: string | null;
    permanent_delegate?: string | null;
    minted_at?: string;
    extensions?: {
        coingeckoId?: string;
    };
}

export class TokenService {
    constructor(private pool: Pool) {}

    private async fetchFromJupiter(mintAddress: string): Promise<JupiterTokenInfo | null> {
        try {
            console.log('Fetching from Jupiter lite API:', mintAddress);
            const response = await fetch(`https://lite-api.jup.ag/tokens/v1/token/${mintAddress}`);
            
            if (!response.ok) {
                console.log(`Jupiter lite API returned ${response.status} for ${mintAddress}`);
                return null;
            }

            const tokenInfo = await response.json();
            console.log('Jupiter lite API response:', tokenInfo);
            return tokenInfo;
        } catch (error) {
            console.error('Error fetching from Jupiter lite API:', error);
            return null;
        }
    }

    async getTokenMetadata(mintAddress: string): Promise<TokenMetadata | null> {
        try {
            // Special case for SOL
            if (mintAddress === 'So11111111111111111111111111111111111111112') {
                return {
                    mint_address: mintAddress,
                    name: 'Solana',
                    symbol: 'SOL',
                    decimals: 9,
                    logo_uri: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png'
                };
            }

            // First try to get from our database
            const result = await this.pool.query(`
                SELECT mint_address, name, symbol, decimals, logo_uri
                FROM tokens
                WHERE mint_address = $1
            `, [mintAddress]);

            if (result.rows[0]) {
                console.log(`Found token ${mintAddress} in database:`, result.rows[0]);
                return result.rows[0];
            }

            // If not in database, try Jupiter API
            console.log('Token not found in database, fetching from Jupiter:', mintAddress);
            const jupiterToken = await this.fetchFromJupiter(mintAddress);
            
            if (jupiterToken) {
                // Create metadata from Jupiter response
                const metadata: TokenMetadata = {
                    mint_address: jupiterToken.address,
                    name: jupiterToken.name,
                    symbol: jupiterToken.symbol,
                    decimals: jupiterToken.decimals,
                    logo_uri: jupiterToken.logoURI || null
                };

                console.log(`Saving token ${mintAddress} to database:`, metadata);

                // Save to database
                await this.pool.query(`
                    INSERT INTO tokens (mint_address, name, symbol, decimals, logo_uri)
                    VALUES ($1, $2, $3, $4, $5)
                    ON CONFLICT (mint_address) DO UPDATE SET
                        name = EXCLUDED.name,
                        symbol = EXCLUDED.symbol,
                        decimals = EXCLUDED.decimals,
                        logo_uri = EXCLUDED.logo_uri
                `, [
                    metadata.mint_address,
                    metadata.name,
                    metadata.symbol,
                    metadata.decimals,
                    metadata.logo_uri
                ]);

                return metadata;
            }

            // If not found in Jupiter, return null instead of default metadata
            console.log(`Token ${mintAddress} not found in Jupiter, skipping`);
            return null;
        } catch (error) {
            console.error('Error fetching token metadata:', error);
            throw error;
        }
    }

    async getTokensMetadata(mintAddresses: string[]): Promise<(TokenMetadata | null)[]> {
        try {
            console.log('Fetching metadata for mint addresses:', mintAddresses);
            
            // First get all existing tokens from database
            const result = await this.pool.query(`
                SELECT mint_address, name, symbol, decimals, logo_uri
                FROM tokens
                WHERE mint_address = ANY($1)
            `, [mintAddresses]);

            // Create a map of existing metadata
            const metadataMap = new Map<string, TokenMetadata>();
            result.rows.forEach(row => metadataMap.set(row.mint_address, row));

            // For tokens not in database, fetch from Jupiter in parallel
            const missingAddresses = mintAddresses.filter(addr => !metadataMap.has(addr));
            
            if (missingAddresses.length > 0) {
                console.log('Fetching missing tokens from Jupiter:', missingAddresses);
                const jupiterPromises = missingAddresses.map(async (address) => {
                    const jupiterToken = await this.fetchFromJupiter(address);
                    if (jupiterToken) {
                        const metadata: TokenMetadata = {
                            mint_address: jupiterToken.address,
                            name: jupiterToken.name,
                            symbol: jupiterToken.symbol,
                            decimals: jupiterToken.decimals,
                            logo_uri: jupiterToken.logoURI || null
                        };

                        // Save to database
                        await this.pool.query(`
                            INSERT INTO tokens (mint_address, name, symbol, decimals, logo_uri)
                            VALUES ($1, $2, $3, $4, $5)
                            ON CONFLICT (mint_address) DO UPDATE SET
                                name = EXCLUDED.name,
                                symbol = EXCLUDED.symbol,
                                decimals = EXCLUDED.decimals,
                                logo_uri = EXCLUDED.logo_uri
                        `, [
                            metadata.mint_address,
                            metadata.name,
                            metadata.symbol,
                            metadata.decimals,
                            metadata.logo_uri
                        ]);

                        metadataMap.set(address, metadata);
                    }
                });

                await Promise.all(jupiterPromises);
            }

            // Return metadata for all requested addresses, null for unknown tokens
            return mintAddresses.map(address => {
                if (address === 'So11111111111111111111111111111111111111112') {
                    return {
                        mint_address: address,
                        name: 'Solana',
                        symbol: 'SOL',
                        decimals: 9,
                        logo_uri: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png'
                    };
                }
                return metadataMap.get(address) || null;
            });
        } catch (error) {
            console.error('Error fetching tokens metadata:', error);
            throw error;
        }
    }
} 