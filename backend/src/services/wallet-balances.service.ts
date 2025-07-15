import { Pool } from 'pg';
import { TokenBalance, WalletBalanceResponse } from '../types';
import { Connection, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { createClient } from 'redis';
import { TokenService } from './token.service';

interface TokenAccountInfo {
  mint: string;
  tokenAmount: {
    amount: string;
    decimals: number;
  };
}

interface ParsedTokenAccount {
  account: {
    data: {
      parsed: {
        info: TokenAccountInfo;
      };
    };
  };
}

export class WalletBalancesService {
  private connection: Connection;
  private redisClient: ReturnType<typeof createClient> | null;
  private readonly CACHE_TTL = 30; // 30 seconds
  private tokenService: TokenService;

  constructor(
    private pool: Pool,
    redisClient?: ReturnType<typeof createClient> | null,
    rpcUrl: string = process.env.HELIUS_RPC_URL || `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}` || process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'
  ) {
    this.connection = new Connection(rpcUrl, 'confirmed');
    this.redisClient = redisClient || null;
    this.tokenService = new TokenService(pool);
  }

  private getCacheKey(walletAddress: string): string {
    return `wallet:${walletAddress}:balances`;
  }

  private async getCachedBalances(walletAddress: string): Promise<WalletBalanceResponse | null> {
    if (!this.redisClient) return null;

    try {
      const cacheKey = this.getCacheKey(walletAddress);
      const cached = await this.redisClient.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (error) {
      console.error('Error getting cached balances:', error);
    }
    return null;
  }

  private async setCachedBalances(walletAddress: string, balances: WalletBalanceResponse): Promise<void> {
    if (!this.redisClient) return;

    try {
      const cacheKey = this.getCacheKey(walletAddress);
      await this.redisClient.set(cacheKey, JSON.stringify(balances), {
        EX: this.CACHE_TTL
      });
    } catch (error) {
      console.error('Error setting cached balances:', error);
    }
  }

  async getBalances(walletAddress: string): Promise<WalletBalanceResponse> {
    // Try to get from cache first
    const cached = await this.getCachedBalances(walletAddress);
    if (cached) {
      console.log(`Cache hit for wallet ${walletAddress}`);
      return cached;
    }

    console.log(`Cache miss for wallet ${walletAddress}, fetching from database...`);

    const query = `
      SELECT wb.mint_address, wb.amount, wb.decimals, wb.last_updated,
             t.logo_uri, t.name, t.symbol
      FROM wallet_balances wb
      LEFT JOIN tokens t ON wb.mint_address = t.mint_address
      WHERE wb.wallet_address = $1
    `;

    try {
      const result = await this.pool.query(query, [walletAddress]);
      
      //console.log('Raw database results:', result.rows);
      
      const balances: TokenBalance[] = result.rows.map(row => {
        const balance = {
          mint: row.mint_address,
          balance: parseFloat(row.amount),
          decimals: row.decimals,
          lastUpdated: row.last_updated,
          logoURI: row.logo_uri,
          name: row.name,
          symbol: row.symbol
        };
        //console.log(`Processed balance for ${row.symbol}:`, balance);
        return balance;
      });

      const response = {
        walletAddress,
        balances
      };

      // Cache the result
      await this.setCachedBalances(walletAddress, response);

      return response;
    } catch (error) {
      console.error('Error fetching wallet balances:', error);
      throw error;
    }
  }

  async updateBalance(
    walletAddress: string,
    mintAddress: string,
    amount: number,
    decimals: number,
    lastUpdated: number
  ): Promise<void> {
    try {
      console.log(`Updating balance for wallet ${walletAddress}, mint ${mintAddress}`);
      console.log(`Raw amount: ${amount}, decimals: ${decimals}`);

      // Calculate UI amount
      const uiAmount = amount / Math.pow(10, decimals);
      console.log(`Calculated UI amount: ${uiAmount}`);

      const query = `
        INSERT INTO wallet_balances (
          wallet_address, 
          mint_address, 
          amount, 
          decimals, 
          last_updated
        )
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (wallet_address, mint_address) 
        DO UPDATE SET
          amount = EXCLUDED.amount,
          decimals = EXCLUDED.decimals,
          last_updated = EXCLUDED.last_updated
      `;

      await this.pool.query(query, [
        walletAddress,
        mintAddress,
        amount.toString(), // Convert to string to preserve precision
        decimals,
        new Date(lastUpdated)
      ]);

      console.log(`Successfully updated balance for ${walletAddress}`);

      // Invalidate cache
      if (this.redisClient) {
        const cacheKey = this.getCacheKey(walletAddress);
        await this.redisClient.del(cacheKey);
        console.log(`Invalidated cache for ${walletAddress}`);
      }
    } catch (error) {
      console.error('Error updating wallet balance:', error);
      throw error;
    }
  }

  async deleteBalances(walletAddress: string): Promise<void> {
    const query = `
      DELETE FROM wallet_balances
      WHERE wallet_address = $1
    `;

    try {
      await this.pool.query(query, [walletAddress]);

      // Invalidate cache
      if (this.redisClient) {
        const cacheKey = this.getCacheKey(walletAddress);
        await this.redisClient.del(cacheKey);
      }
    } catch (error) {
      console.error('Error deleting balances:', error);
      throw error;
    }
  }

  async populateWalletBalances(walletAddress: string): Promise<void> {
    try {
      console.log(`Starting to populate balances for wallet: ${walletAddress}`);
      const updatedMints = new Set<string>();
      
      // Add rate limiting delay to prevent overwhelming the RPC
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // First get SOL balance with retry logic
      try {
        const solBalance = await this.getBalanceWithRetry(walletAddress);
        console.log(`Raw SOL balance: ${solBalance}`);
        updatedMints.add('So11111111111111111111111111111111111111112');
        // Update SOL balance - Note: solBalance is in lamports (raw units)
        await this.updateBalance(
          walletAddress,
          'So11111111111111111111111111111111111111112', // Native SOL mint address
          solBalance, // Pass raw lamports amount (can be zero)
          9, // SOL decimals
          Date.now()
        );
      } catch (error) {
        console.error(`Error fetching SOL balance for ${walletAddress}:`, error);
        // Continue with token balances even if SOL balance fails
      }

      // Get token accounts with retry logic
      try {
        console.log(`Fetching token accounts for ${walletAddress}`);
        const tokenAccounts = await this.getTokenAccountsWithRetry(walletAddress);

        console.log(`Found ${tokenAccounts.length} token accounts`);

        // Process each token account
        for (const account of tokenAccounts) {
          try {
            const parsedInfo = account.account.data.parsed.info;
            const tokenMint = parsedInfo.mint;
            const tokenAmount = parsedInfo.tokenAmount;
            updatedMints.add(tokenMint);
            // Always update balance, even if zero
            await this.updateBalance(
              walletAddress,
              tokenMint,
              Number(tokenAmount.amount), // Use raw token amount
              tokenAmount.decimals,
              Date.now()
            );
          } catch (error) {
            console.error(`Error processing token account:`, error);
            // Continue with next token even if one fails
          }
        }
      } catch (error) {
        console.error(`Error fetching token accounts for ${walletAddress}:`, error);
        throw new Error(`Failed to fetch token accounts: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }

      // --- NEW: Set balances to zero for tokens no longer present on-chain ---
      try {
        const dbResult = await this.pool.query(
          'SELECT mint_address FROM wallet_balances WHERE wallet_address = $1',
          [walletAddress]
        );
        for (const row of dbResult.rows) {
          if (!updatedMints.has(row.mint_address)) {
            // Set amount to zero for tokens no longer present
            await this.updateBalance(walletAddress, row.mint_address, 0, 0, Date.now());
            console.log(`Set balance to zero for missing token: ${row.mint_address}`);
          }
        }
      } catch (error) {
        console.error(`Error zeroing out missing tokens for ${walletAddress}:`, error);
      }
      // Invalidate cache after population
      if (this.redisClient) {
        const cacheKey = this.getCacheKey(walletAddress);
        await this.redisClient.del(cacheKey);
      }
      console.log(`Successfully populated balances for ${walletAddress}`);
    } catch (error) {
      console.error(`Error populating wallet balances for ${walletAddress}:`, error);
      throw new Error(`Failed to populate wallet balances: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async hideToken(walletAddress: string, mintAddress: string): Promise<void> {
    const query = `
      UPDATE wallet_balances 
      SET hidden = true 
      WHERE wallet_address = $1 AND mint_address = $2
    `;
    await this.pool.query(query, [walletAddress, mintAddress]);
  }

  async unhideToken(walletAddress: string, mintAddress: string): Promise<void> {
    const query = `
      UPDATE wallet_balances 
      SET hidden = false 
      WHERE wallet_address = $1 AND mint_address = $2
    `;
    await this.pool.query(query, [walletAddress, mintAddress]);
  }

  async getHiddenTokens(walletAddress: string): Promise<string[]> {
    const query = `
      SELECT mint_address 
      FROM wallet_balances 
      WHERE wallet_address = $1 AND hidden = true
    `;
    const result = await this.pool.query(query, [walletAddress]);
    return result.rows.map(row => row.mint_address);
  }

  // Helper method to get SOL balance with retry logic
  private async getBalanceWithRetry(walletAddress: string, maxRetries = 3): Promise<number> {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const balance = await this.connection.getBalance(new PublicKey(walletAddress));
        return balance;
      } catch (error) {
        console.error(`Attempt ${attempt + 1} failed to get balance for ${walletAddress}:`, error);
        if (attempt === maxRetries - 1) throw error;
        
        // Exponential backoff: 1s, 2s, 4s
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    throw new Error('All retry attempts failed');
  }

  // Helper method to get token accounts with retry logic
  private async getTokenAccountsWithRetry(walletAddress: string, maxRetries = 3): Promise<ParsedTokenAccount[]> {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(
          new PublicKey(walletAddress),
          { programId: TOKEN_PROGRAM_ID }
        );
        return tokenAccounts.value;
      } catch (error) {
        console.error(`Attempt ${attempt + 1} failed to get token accounts for ${walletAddress}:`, error);
        if (attempt === maxRetries - 1) throw error;
        
        // Exponential backoff: 1s, 2s, 4s
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    throw new Error('All retry attempts failed');
  }
} 