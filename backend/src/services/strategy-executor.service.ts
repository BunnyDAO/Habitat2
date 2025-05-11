import { Pool } from 'pg';
import { Keypair, PublicKey } from '@solana/web3.js';
import { createClient } from 'redis';
import { HeliusService } from './helius.service';
import { JobType, WalletMonitoringJob, PriceMonitoringJob, VaultStrategy, LevelsStrategy, Level } from '../types/jobs';
import { EncryptionService } from './encryption.service';
import { PriceService } from './price.service';

export class StrategyExecutorService {
  private static instance: StrategyExecutorService;
  private pool: Pool;
  private redisClient: ReturnType<typeof createClient> | null;
  private heliusService: HeliusService;
  private encryptionService: EncryptionService;
  private priceService: PriceService;
  private isRunning: boolean = false;

  private constructor(pool: Pool, redisClient: ReturnType<typeof createClient> | null, heliusService: HeliusService) {
    this.pool = pool;
    this.redisClient = redisClient;
    this.heliusService = heliusService;
    this.encryptionService = EncryptionService.getInstance();
    this.priceService = new PriceService();
  }

  public static getInstance(pool: Pool, redisClient: ReturnType<typeof createClient> | null, heliusService: HeliusService): StrategyExecutorService {
    if (!StrategyExecutorService.instance) {
      StrategyExecutorService.instance = new StrategyExecutorService(pool, redisClient, heliusService);
    }
    return StrategyExecutorService.instance;
  }

  public async start() {
    if (this.isRunning) {
      console.log('Strategy executor service is already running');
      return;
    }

    this.isRunning = true;
    console.log('Starting strategy executor service...');

    while (this.isRunning) {
      try {
        await this.processStrategies();
        // Wait for 1 minute before next iteration
        await new Promise(resolve => setTimeout(resolve, 60000));
      } catch (error) {
        console.error('Error in strategy executor service:', error);
        await this.logError('strategy_executor', error);
      }
    }
  }

  public stop() {
    this.isRunning = false;
    console.log('Stopping strategy executor service...');
  }

  private async processStrategies() {
    const client = await this.pool.connect();
    try {
      // Get all active strategies
      const result = await client.query(`
        SELECT s.*, tw.wallet_pubkey, tw.main_wallet_pubkey
        FROM strategies s
        JOIN trading_wallets tw ON s.trading_wallet_id = tw.id
        WHERE s.is_active = true
        AND (s.next_execution IS NULL OR s.next_execution <= NOW())
      `);

      for (const strategy of result.rows) {
        try {
          // Get wallet private key
          const privateKey = await this.encryptionService.getWalletPrivateKey(strategy.trading_wallet_id);
          const keypair = Keypair.fromSecretKey(Buffer.from(privateKey, 'base64'));

          // Execute strategy based on type
          switch (strategy.strategy_type) {
            case JobType.WALLET_MONITOR:
              await this.executeWalletMonitor(strategy, keypair);
              break;
            case JobType.PRICE_MONITOR:
              await this.executePriceMonitor(strategy, keypair);
              break;
            case JobType.VAULT:
              await this.executeVaultStrategy(strategy, keypair);
              break;
            case JobType.LEVELS:
              await this.executeLevelsStrategy(strategy, keypair);
              break;
            default:
              console.warn(`Unknown strategy type: ${strategy.strategy_type}`);
          }

          // Update strategy next execution time
          await client.query(`
            UPDATE strategies
            SET last_executed = NOW(),
                next_execution = NOW() + interval '1 hour'
            WHERE id = $1
          `, [strategy.id]);

        } catch (error) {
          console.error(`Error executing strategy ${strategy.id}:`, error);
          await this.logError('strategy_execution', error, { strategyId: strategy.id });
        }
      }
    } finally {
      client.release();
    }
  }

  private async executeWalletMonitor(strategy: WalletMonitoringJob, keypair: Keypair) {
    // Get recent transactions for monitored wallet
    const transactions = await this.heliusService.getTransactions(strategy.walletAddress);
    // Filter out already processed transactions
    const newTransactions = transactions.filter(tx => 
      !strategy.recentTransactions?.includes(tx.signature)
    );
    // Process new transactions
    for (const tx of newTransactions) {
      try {
        // Mirror the trade
        await this.mirrorTrade();
        // Update recent transactions list
        const strategyId = Number(strategy.id);
        if (isNaN(strategyId)) {
          console.error(`Strategy id is not numeric: ${strategy.id}`);
          continue;
        }
        await this.updateRecentTransactions(strategyId, tx.signature);
        // Log the mirror trade
        await this.logMirrorTrade(strategy, tx.signature);
      } catch (error) {
        console.error(`Error mirroring trade ${tx.signature}:`, error);
        await this.logError('mirror_trade', error, { 
          strategyId: strategy.id,
          transactionSignature: tx.signature 
        });
      }
    }
  }

  private async executePriceMonitor(strategy: PriceMonitoringJob, keypair: Keypair) {
    const currentPrice = await this.priceService.getSolPrice();
    const shouldExecute = strategy.direction === 'above' 
      ? currentPrice > strategy.targetPrice
      : currentPrice < strategy.targetPrice;
    if (shouldExecute) {
      try {
        await this.executePriceBasedTrade();
        await this.logPriceBasedTrade(strategy, currentPrice);
      } catch (error) {
        console.error(`Error executing price-based trade:`, error);
      }
    }
  }

  private async executeVaultStrategy(strategy: VaultStrategy, keypair: Keypair) {
    try {
      const balance = await this.getWalletBalance(keypair.publicKey);
      const vaultAmount = balance * (strategy.vaultPercentage / 100);
      await this.executeVaultTrade();
      await this.logVaultTrade(strategy, vaultAmount);
    } catch (error) {
      console.error(`Error executing vault strategy:`, error);
      await this.logError('vault_trade', error, { strategyId: strategy.id });
    }
  }

  private async executeLevelsStrategy(strategy: LevelsStrategy, keypair: Keypair) {
    const currentPrice = await this.priceService.getSolPrice();
    const triggeredLevel = strategy.levels.find(level => 
      Math.abs(currentPrice - level.price) < 0.01
    );
    if (triggeredLevel) {
      try {
        await this.executeLevelTrade();
        await this.logLevelTrade(strategy, triggeredLevel, currentPrice);
      } catch (error) {
        console.error(`Error executing level trade:`, error);
        await this.logError('level_trade', error, { 
          strategyId: strategy.id,
          level: triggeredLevel,
          currentPrice 
        });
      }
    }
  }

  private async logError(context: string, error: unknown, metadata: Record<string, unknown> = {}) {
    const client = await this.pool.connect();
    try {
      let message = 'Unknown error';
      let stack = '';
      if (error && typeof error === 'object' && 'message' in error) {
        message = (error as any).message;
        stack = (error as any).stack;
      }
      await client.query(`
        INSERT INTO transactions (
          type,
          amount,
          token_mint,
          timestamp,
          details
        ) VALUES ($1, $2, $3, NOW(), $4)
      `, [
        'error',
        0,
        'system',
        JSON.stringify({
          context,
          error: {
            message,
            stack
          },
          metadata
        })
      ]);
    } finally {
      client.release();
    }
  }

  // Helper methods for trade execution and logging
  private async mirrorTrade() {
    // Implementation for mirroring trades
  }

  private async executePriceBasedTrade() {
    // Implementation for price-based trades
  }

  private async executeVaultTrade() {
    // Implementation for vault trades
  }

  private async executeLevelTrade() {}
  

  private async updateRecentTransactions(strategyId: number, signature: string) {
    const client = await this.pool.connect();
    try {
      await client.query(`
        UPDATE strategies
        SET config = jsonb_set(
          config,
          '{recentTransactions}',
          COALESCE(config->'recentTransactions', '[]'::jsonb) || $1::jsonb
        )
        WHERE id = $2
      `, [JSON.stringify(signature), strategyId]);
    } finally {
      client.release();
    }
  }

  private async logMirrorTrade(strategy: WalletMonitoringJob, txSignature: string) {
    const client = await this.pool.connect();
    try {
      const strategyId = Number(strategy.id);
      if (isNaN(strategyId)) {
        console.error(`Strategy id is not numeric: ${strategy.id}`);
        return;
      }
      await client.query(`
        INSERT INTO strategy_logs (
          strategy_id,
          type,
          details
        ) VALUES ($1, $2, $3)
      `, [
        strategyId,
        'mirror_trade',
        JSON.stringify({
          transactionSignature: txSignature,
          timestamp: new Date().toISOString()
        })
      ]);
    } finally {
      client.release();
    }
  }

  private async logPriceBasedTrade(strategy: PriceMonitoringJob, currentPrice: number) {
    const client = await this.pool.connect();
    try {
      await client.query(`
        INSERT INTO strategy_logs (
          strategy_id,
          type,
          details
        ) VALUES ($1, $2, $3)
      `, [
        strategy.id,
        'price_trade',
        JSON.stringify({
          currentPrice,
          timestamp: new Date().toISOString()
        })
      ]);
    } finally {
      client.release();
    }
  }

  private async logVaultTrade(strategy: VaultStrategy, vaultAmount: number) {
    const client = await this.pool.connect();
    try {
      await client.query(`
        INSERT INTO strategy_logs (
          strategy_id,
          type,
          details
        ) VALUES ($1, $2, $3)
      `, [
        strategy.id,
        'vault_trade',
        JSON.stringify({
          vaultAmount,
          timestamp: new Date().toISOString()
        })
      ]);
    } finally {
      client.release();
    }
  }

  private async logLevelTrade(strategy: LevelsStrategy, triggeredLevel: Level, currentPrice: number) {
    const client = await this.pool.connect();
    try {
      await client.query(`
        INSERT INTO strategy_logs (
          strategy_id,
          type,
          details
        ) VALUES ($1, $2, $3)
      `, [
        strategy.id,
        'level_trade',
        JSON.stringify({
          triggeredLevel,
          currentPrice,
          timestamp: new Date().toISOString()
        })
      ]);
    } finally {
      client.release();
    }
  }

  private async getWalletBalance(publicKey: PublicKey): Promise<number> {
    const balances = await this.heliusService.getWalletBalances(publicKey.toBase58());
    const solBalance = balances.find(b => b.mint === 'So11111111111111111111111111111111111111112');
    return solBalance?.balance || 0;
  }
} 