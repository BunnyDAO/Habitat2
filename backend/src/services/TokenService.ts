import { createClient } from 'redis';
import { Pool } from 'pg';

export interface TokenInfo {
  mintAddress: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI?: string;
  category: 'xstock' | 'crypto' | 'stablecoin';
  isActive: boolean;
  lastUpdated: Date;
}

export class TokenService {
  private pool: Pool;
  private redisClient: ReturnType<typeof createClient> | null;
  private CACHE_KEY = 'pair-trade:tokens';
  private CACHE_DURATION = 3600; // 1 hour


  constructor(pool: Pool, redisClient: ReturnType<typeof createClient> | null = null) {
    this.pool = pool;
    this.redisClient = redisClient;
  }


  /**
   * Get all supported tokens for pair trading from database
   */
  async getSupportedTokens(): Promise<TokenInfo[]> {
    try {
      console.log('🔍 TokenService.getSupportedTokens() called');
      
      // Check cache first
      if (this.redisClient?.isOpen) {
        console.log('🔍 Checking Redis cache...');
        const cachedTokens = await this.redisClient.get(this.CACHE_KEY);
        if (cachedTokens) {
          console.log('✅ Found cached tokens, returning from cache');
          return JSON.parse(cachedTokens);
        }
        console.log('❌ No cached tokens found');
      } else {
        console.log('❌ Redis client not available');
      }

      // Query database for tokens suitable for pair trading
      console.log('🔍 Querying database for supported tokens...');
      
      const result = await this.pool.query(`
        SELECT mint_address, name, symbol, decimals, logo_uri, last_updated
        FROM tokens
        WHERE (
          -- xStocks (tokenized stocks)
          symbol LIKE '%x' AND (
            symbol = 'TSLAx' OR 
            symbol = 'AAPLx' OR 
            symbol = 'NVDAx' OR 
            symbol = 'METAx' OR 
            symbol = 'COINx' OR
            symbol = 'GOOGLx' OR
            symbol = 'MSFTx' OR
            symbol = 'AMZNx' OR
            symbol = 'SPYx' OR
            symbol = 'QQQx'
          )
        ) OR (
          -- Major crypto tokens
          mint_address = 'So11111111111111111111111111111111111111112' OR -- SOL
          mint_address = '3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh' OR -- wBTC
          mint_address = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' OR -- USDC
          mint_address = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'    -- USDT
        )
        ORDER BY 
          CASE 
            WHEN symbol LIKE '%x' THEN 1 
            WHEN symbol IN ('SOL', 'wBTC') THEN 2
            WHEN symbol IN ('USDC', 'USDT') THEN 3
            ELSE 4
          END,
          symbol ASC
      `);

      console.log('🔍 Database query result:', result.rows.length, 'rows found');
      console.log('🔍 Found tokens:', result.rows.map(r => ({ 
        symbol: r.symbol, 
        mint: r.mint_address.slice(0, 10) + '...' 
      })));

      if (result.rows.length === 0) {
        console.log('⚠️  No supported tokens found in database!');
        console.log('💡 Please run the xStock token update script to populate tokens');
        return [];
      }

      const tokens: TokenInfo[] = result.rows.map(row => ({
        mintAddress: row.mint_address,
        symbol: row.symbol,
        name: row.name,
        decimals: row.decimals,
        logoURI: row.logo_uri,
        category: this.getTokenCategory(row.symbol),
        isActive: true, // All tokens from database are considered active
        lastUpdated: row.last_updated
      }));

      console.log('🔍 Final tokens being returned:', tokens.map(t => ({ 
        symbol: t.symbol, 
        category: t.category,
        isActive: t.isActive 
      })));

      // Cache the result
      if (this.redisClient?.isOpen) {
        await this.redisClient.setEx(
          this.CACHE_KEY,
          this.CACHE_DURATION,
          JSON.stringify(tokens)
        );
        console.log('✅ Cached tokens for future requests');
      }

      return tokens;
    } catch (error) {
      console.error('❌ Error getting supported tokens:', error);
      throw error;
    }
  }

  /**
   * Get token info by mint address
   */
  async getTokenInfo(mintAddress: string): Promise<TokenInfo | null> {
    try {
      const result = await this.pool.query(`
        SELECT mint_address, name, symbol, decimals, logo_uri, last_updated
        FROM tokens
        WHERE mint_address = $1
      `, [mintAddress]);

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      return {
        mintAddress: row.mint_address,
        symbol: row.symbol,
        name: row.name,
        decimals: row.decimals,
        logoURI: row.logo_uri,
        category: this.getTokenCategory(row.symbol),
        isActive: this.isTokenActive(row.mint_address),
        lastUpdated: row.last_updated
      };
    } catch (error) {
      console.error('Error getting token info:', error);
      throw error;
    }
  }

  /**
   * Validate if two tokens can be paired
   */
  async validateTokenPair(tokenAMint: string, tokenBMint: string): Promise<{ isValid: boolean; error?: string }> {
    if (tokenAMint === tokenBMint) {
      return { isValid: false, error: 'Cannot pair the same token with itself' };
    }

    try {
      const tokenA = await this.getTokenInfo(tokenAMint);
      const tokenB = await this.getTokenInfo(tokenBMint);

      if (!tokenA) {
        return { isValid: false, error: 'Token A is not supported for pair trading' };
      }

      if (!tokenB) {
        return { isValid: false, error: 'Token B is not supported for pair trading' };
      }

      if (!tokenA.isActive) {
        return { isValid: false, error: `Token A (${tokenA.symbol}) is currently inactive` };
      }

      if (!tokenB.isActive) {
        return { isValid: false, error: `Token B (${tokenB.symbol}) is currently inactive` };
      }

      return { isValid: true };
    } catch (error) {
      console.error('Error validating token pair:', error);
      return { isValid: false, error: 'Error validating tokens' };
    }
  }

  /**
   * Get token category by symbol
   */
  private getTokenCategory(symbol: string): 'xstock' | 'crypto' | 'stablecoin' {
    if (symbol.endsWith('x')) {
      return 'xstock';
    }
    if (['USDC', 'USDT', 'BUSD', 'DAI', 'FRAX'].includes(symbol)) {
      return 'stablecoin';
    }
    return 'crypto';
  }

  /**
   * Check if token is active (all tokens from database are considered active)
   */
  private isTokenActive(mintAddress: string): boolean {
    // For now, all tokens in our curated database are considered active
    return true;
  }

  /**
   * Get active tokens by category
   */
  async getTokensByCategory(category: 'xstock' | 'crypto' | 'stablecoin'): Promise<TokenInfo[]> {
    const allTokens = await this.getSupportedTokens();
    return allTokens.filter(token => token.category === category && token.isActive);
  }

  /**
   * Update token active status
   */
  async updateTokenStatus(mintAddress: string, isActive: boolean): Promise<void> {
    // This would update the internal list and clear cache
    // For now, we'll just clear the cache to force refresh
    if (this.redisClient?.isOpen) {
      await this.redisClient.del(this.CACHE_KEY);
    }
  }

  /**
   * Get all categories with their tokens
   */
  async getTokensGroupedByCategory(): Promise<Record<string, TokenInfo[]>> {
    const allTokens = await this.getSupportedTokens();
    
    const grouped: Record<string, TokenInfo[]> = {
      xstock: [],
      crypto: [],
      stablecoin: []
    };

    allTokens.forEach(token => {
      if (token.isActive) {
        grouped[token.category].push(token);
      }
    });

    return grouped;
  }
}