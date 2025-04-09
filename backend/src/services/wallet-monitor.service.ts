import { Pool } from 'pg';
import { createClient } from 'redis';
import dotenv from 'dotenv';

dotenv.config();

export class WalletMonitorService {
  private pool: Pool;
  private redisClient: ReturnType<typeof createClient> | null;
  private heliusApiKey: string;
  private activeWallets: Set<string>;
  private updateInterval: number;
  private isRunning: boolean;

  constructor(
    pool: Pool,
    redisClient: ReturnType<typeof createClient> | null,
    heliusApiKey: string,
    updateInterval = 5000 // 5 seconds default
  ) {
    this.pool = pool;
    this.redisClient = redisClient;
    this.heliusApiKey = heliusApiKey;
    this.updateInterval = updateInterval;
    this.activeWallets = new Set();
    this.isRunning = false;
  }

  async start() {
    if (this.isRunning) {
      console.log('Service is already running');
      return;
    }

    this.isRunning = true;
    console.log('Starting wallet monitor service...');

    while (this.isRunning) {
      try {
        // Get list of active wallets from database
        await this.updateActiveWallets();
        
        // Update balances for each wallet
        for (const wallet of this.activeWallets) {
          await this.updateWalletBalances(wallet);
        }

        // Wait for next update interval
        await new Promise(resolve => setTimeout(resolve, this.updateInterval));
      } catch (error) {
        console.error('Error in wallet monitor service:', error);
        // Wait before retrying on error
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  stop() {
    this.isRunning = false;
    console.log('Stopping wallet monitor service...');
  }

  private async updateActiveWallets() {
    try {
      // Get wallets that have been active in the last 24 hours
      const result = await this.pool.query(`
        SELECT DISTINCT wallet_address 
        FROM wallet_balances 
        WHERE last_updated > NOW() - INTERVAL '24 hours'
      `);
      
      this.activeWallets = new Set(result.rows.map(row => row.wallet_address));
    } catch (error) {
      console.error('Error updating active wallets:', error);
    }
  }

  private async updateWalletBalances(walletAddress: string) {
    console.log(`Updating balances for wallet: ${walletAddress}`);
    
    try {
      // Get SOL balance
      const solResponse = await fetch('https://api.mainnet-beta.solana.com', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: '1',
          method: 'getBalance',
          params: [walletAddress],
        }),
      });

      if (!solResponse.ok) {
        throw new Error(`SOL balance API error: ${solResponse.statusText}`);
      }

      const solData = await solResponse.json();
      const solBalance = solData.result.value;

      // Get token accounts
      const tokenResponse = await fetch('https://api.mainnet-beta.solana.com', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: '1',
          method: 'getTokenAccountsByOwner',
          params: [
            walletAddress,
            {
              programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
            },
            {
              encoding: 'jsonParsed'
            }
          ],
        }),
      });

      if (!tokenResponse.ok) {
        throw new Error(`Token accounts API error: ${tokenResponse.statusText}`);
      }

      const tokenData = await tokenResponse.json();
      
      // Start a transaction
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');

        // Insert SOL balance
        await client.query(`
          INSERT INTO wallet_balances (wallet_address, mint_address, amount, last_updated)
          VALUES ($1, $2, $3, NOW())
          ON CONFLICT (wallet_address, mint_address) 
          DO UPDATE SET 
            amount = EXCLUDED.amount,
            last_updated = NOW()
        `, [
          walletAddress,
          'So11111111111111111111111111111111111111112',
          solBalance / 1e9 // Convert lamports to SOL
        ]);

        // Process token accounts
        for (const item of tokenData.result.value) {
          const tokenInfo = item.account.data.parsed.info;
          const amount = tokenInfo.tokenAmount.uiAmount;
          const mintAddress = tokenInfo.mint;

          // Insert or update balance
          await client.query(`
            INSERT INTO wallet_balances (wallet_address, mint_address, amount, last_updated)
            VALUES ($1, $2, $3, NOW())
            ON CONFLICT (wallet_address, mint_address) 
            DO UPDATE SET 
              amount = EXCLUDED.amount,
              last_updated = NOW()
          `, [walletAddress, mintAddress, amount]);
        }

        await client.query('COMMIT');

        // Cache the wallet portfolio view result in Redis
        if (this.redisClient?.isOpen) {
          const portfolioResult = await client.query(`
            SELECT wb.*, t.symbol, t.name, t.logo_uri, tp.current_price_usd
            FROM wallet_balances wb
            LEFT JOIN tokens t ON wb.mint_address = t.mint_address
            LEFT JOIN token_prices tp ON wb.mint_address = tp.mint_address
            WHERE wb.wallet_address = $1
          `, [walletAddress]);

          await this.redisClient.setEx(
            `portfolio:${walletAddress}`,
            5, // 5 seconds TTL
            JSON.stringify(portfolioResult.rows)
          );
        }

      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }

    } catch (error) {
      console.error(`Error updating wallet ${walletAddress}:`, error);
    }
  }

  // Method to manually add a wallet to monitor
  async addWallet(walletAddress: string) {
    this.activeWallets.add(walletAddress);
    await this.updateWalletBalances(walletAddress);
  }
} 