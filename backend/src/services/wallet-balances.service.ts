import { Pool } from 'pg';
import { TokenBalance, WalletBalanceResponse } from '../types';
import { Connection, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { createClient } from 'redis';
import { TokenService } from './token.service';

export class WalletBalancesService {
  private connection: Connection;
  private redisClient: ReturnType<typeof createClient> | null;
  private readonly CACHE_TTL = 30; // 30 seconds
  private tokenService: TokenService;

  constructor(
    private pool: Pool,
    redisClient?: ReturnType<typeof createClient> | null,
    rpcUrl: string = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'
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
      
      console.log('Raw database results:', result.rows);
      
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
        console.log(`Processed balance for ${row.symbol}:`, balance);
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
      // For SOL, we don't need to check Jupiter
      if (mintAddress === 'So11111111111111111111111111111111111111112') {
        await this.insertOrUpdateBalance(walletAddress, mintAddress, amount, decimals, lastUpdated);
        return;
      }

      // Check if token exists in Jupiter
      const tokenMetadata = await this.tokenService.getTokenMetadata(mintAddress);
      
      // Only insert balance if token exists in Jupiter
      if (tokenMetadata) {
        await this.insertOrUpdateBalance(walletAddress, mintAddress, amount, decimals, lastUpdated);
      } else {
        console.log(`Skipping unknown token ${mintAddress} - not found in Jupiter`);
      }
    } catch (error) {
      console.error('Error updating wallet balance:', error);
      throw error;
    }
  }

  private async insertOrUpdateBalance(
    walletAddress: string,
    mintAddress: string,
    amount: number,
    decimals: number,
    lastUpdated: number
  ): Promise<void> {
    const query = `
      INSERT INTO wallet_balances (wallet_address, mint_address, amount, decimals, last_updated)
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
      amount,
      decimals,
      new Date(lastUpdated)
    ]);

    // Invalidate cache
    if (this.redisClient) {
      const cacheKey = this.getCacheKey(walletAddress);
      await this.redisClient.del(cacheKey);
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
      console.error('Error deleting wallet balances:', error);
      throw error;
    }
  }

  async populateWalletBalances(walletAddress: string): Promise<void> {
    try {
      // First get SOL balance
      const solBalance = await this.connection.getBalance(new PublicKey(walletAddress));
      const solBalanceInSol = solBalance / 1e9;
      
      // Update SOL balance
      if (solBalanceInSol > 0) {
        await this.updateBalance(
          walletAddress,
          'So11111111111111111111111111111111111111112', // Native SOL mint address
          solBalanceInSol,
          9, // SOL decimals
          Date.now()
        );
      }

      // Get token accounts
      const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(
        new PublicKey(walletAddress),
        { programId: TOKEN_PROGRAM_ID }
      );

      // Process each token account
      for (const { account } of tokenAccounts.value) {
        const parsedInfo = account.data.parsed.info;
        const tokenMint = parsedInfo.mint;
        const tokenAmount = parsedInfo.tokenAmount;
        
        // Only include tokens with non-zero balance
        if (tokenAmount.uiAmount > 0) {
          await this.updateBalance(
            walletAddress,
            tokenMint,
            tokenAmount.uiAmount,
            tokenAmount.decimals,
            Date.now()
          );
        }
      }

      // Invalidate cache after population
      if (this.redisClient) {
        const cacheKey = this.getCacheKey(walletAddress);
        await this.redisClient.del(cacheKey);
      }
    } catch (error) {
      console.error('Error populating wallet balances:', error);
      throw error;
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
} 