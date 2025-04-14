import { Pool } from 'pg';
import { createClient } from 'redis';

export interface TokenMetadata {
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

export class TokenMetadataService {
  private pool: Pool;
  private redis?: ReturnType<typeof createClient>;

  constructor(pool: Pool, redis?: ReturnType<typeof createClient> | null) {
    this.pool = pool;
    this.redis = redis || undefined;
  }

  async getTokenMetadata(address: string): Promise<TokenMetadata | null> {
    // Try to get from cache first
    if (this.redis) {
      const cached = await this.redis.get(`token:metadata:${address}`);
      if (cached) {
        return JSON.parse(cached);
      }
    }

    // Try to get from database
    const result = await this.pool.query(
      'SELECT * FROM tokens WHERE address = $1',
      [address]
    );

    if (result.rows.length > 0) {
      const token = result.rows[0];
      // Cache the result
      if (this.redis) {
        await this.redis.setEx(
          `token:metadata:${address}`,
          3600, // 1 hour cache
          JSON.stringify(token)
        );
      }
      return token;
    }

    // If not found, fetch from Jupiter API
    try {
      const response = await fetch(`https://lite-api.jup.ag/tokens/v1/token/${address}`);
      if (!response.ok) {
        return null;
      }

      const tokenInfo = await response.json();
      
      // Insert into database
      await this.pool.query(
        `INSERT INTO tokens (
          address, name, symbol, decimals, logo_uri, tags, 
          daily_volume, created_at, freeze_authority, mint_authority,
          permanent_delegate, minted_at, extensions
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (address) DO UPDATE SET
          name = EXCLUDED.name,
          symbol = EXCLUDED.symbol,
          decimals = EXCLUDED.decimals,
          logo_uri = EXCLUDED.logo_uri,
          tags = EXCLUDED.tags,
          daily_volume = EXCLUDED.daily_volume,
          created_at = EXCLUDED.created_at,
          freeze_authority = EXCLUDED.freeze_authority,
          mint_authority = EXCLUDED.mint_authority,
          permanent_delegate = EXCLUDED.permanent_delegate,
          minted_at = EXCLUDED.minted_at,
          extensions = EXCLUDED.extensions`,
        [
          tokenInfo.address,
          tokenInfo.name,
          tokenInfo.symbol,
          tokenInfo.decimals,
          tokenInfo.logoURI,
          tokenInfo.tags,
          tokenInfo.daily_volume,
          tokenInfo.created_at,
          tokenInfo.freeze_authority,
          tokenInfo.mint_authority,
          tokenInfo.permanent_delegate,
          tokenInfo.minted_at,
          tokenInfo.extensions
        ]
      );

      // Cache the result
      if (this.redis) {
        await this.redis.setEx(
          `token:metadata:${address}`,
          3600, // 1 hour cache
          JSON.stringify(tokenInfo)
        );
      }

      return tokenInfo;
    } catch (error) {
      console.error(`Error fetching token metadata for ${address}:`, error);
      return null;
    }
  }

  async hideToken(walletAddress: string, tokenAddress: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO hidden_tokens (wallet_address, token_address)
       VALUES ($1, $2)
       ON CONFLICT (wallet_address, token_address) DO NOTHING`,
      [walletAddress, tokenAddress]
    );
  }

  async showToken(walletAddress: string, tokenAddress: string): Promise<void> {
    await this.pool.query(
      'DELETE FROM hidden_tokens WHERE wallet_address = $1 AND token_address = $2',
      [walletAddress, tokenAddress]
    );
  }

  async getHiddenTokens(walletAddress: string): Promise<string[]> {
    const result = await this.pool.query(
      'SELECT token_address FROM hidden_tokens WHERE wallet_address = $1',
      [walletAddress]
    );
    return result.rows.map(row => row.token_address);
  }
} 