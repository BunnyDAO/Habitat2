import { Pool } from 'pg';
import { createClient } from 'redis';
import dotenv from 'dotenv';
import { HeliusService } from './helius.service';
import { TokenBalance } from '../types';

dotenv.config();

export class WalletMonitorService {
  private pool: Pool;
  private redisClient: ReturnType<typeof createClient> | null;
  private heliusService: HeliusService;
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
    this.heliusService = new HeliusService(heliusApiKey, redisClient);
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

    // Initial population of active wallets from database
    await this.updateActiveWallets();

    while (this.isRunning) {
      try {
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
      // Get all trading wallets from the database
      const result = await this.pool.query(`
        SELECT DISTINCT tw.wallet_pubkey 
        FROM trading_wallets tw
        JOIN users u ON tw.main_wallet_pubkey = u.main_wallet_pubkey
      `);
      
      this.activeWallets = new Set(result.rows.map(row => row.wallet_pubkey));
      console.log(`Found ${this.activeWallets.size} active trading wallets`);
    } catch (error) {
      console.error('Error updating active wallets:', error);
    }
  }

  private async updateWalletBalances(walletAddress: string) {
    console.log(`Updating balances for wallet: ${walletAddress}`);
    
    try {
      // Get balances using HeliusService
      const balances: TokenBalance[] = await this.heliusService.getWalletBalances(walletAddress);
      
      // Start a transaction
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');

        // Update wallet_balances table
        for (const balance of balances) {
          await client.query(`
            INSERT INTO wallet_balances (wallet_address, mint_address, amount, last_updated)
            VALUES ($1, $2, $3, NOW())
            ON CONFLICT (wallet_address, mint_address) 
            DO UPDATE SET 
              amount = EXCLUDED.amount,
              last_updated = NOW()
          `, [walletAddress, balance.mint, balance.balance]);
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