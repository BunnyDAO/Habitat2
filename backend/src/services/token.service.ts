import { Pool } from 'pg';

export class TokenService {
    constructor(private pool: Pool) {}

    async getTokenMetadata(mintAddress: string) {
        try {
            const result = await this.pool.query(`
                SELECT mint_address, name, symbol, decimals, logo_uri
                FROM tokens
                WHERE mint_address = $1
            `, [mintAddress]);

            return result.rows[0] || null;
        } catch (error) {
            console.error('Error fetching token metadata:', error);
            throw error;
        }
    }

    async getTokensMetadata(mintAddresses: string[]) {
        try {
            console.log('Fetching metadata for mint addresses:', mintAddresses);
            const result = await this.pool.query(`
                SELECT mint_address, name, symbol, decimals, logo_uri
                FROM tokens
                WHERE mint_address = ANY($1)
            `, [mintAddresses]);

            // Create a map of existing metadata
            const metadataMap = new Map(result.rows.map(row => [row.mint_address, row]));

            // Ensure we return metadata for all requested addresses
            return mintAddresses.map(address => {
                const existingMetadata = metadataMap.get(address);
                if (existingMetadata) {
                    return existingMetadata;
                }

                // Return default metadata if not found
                return {
                    mint_address: address,
                    name: address.slice(0, 8) + '...',  // Use truncated address as name
                    symbol: 'UNKNOWN',
                    decimals: 9,  // Default to 9 decimals (common for SPL tokens)
                    logo_uri: null
                };
            });
        } catch (error) {
            console.error('Error fetching tokens metadata:', error);
            throw error;
        }
    }
} 