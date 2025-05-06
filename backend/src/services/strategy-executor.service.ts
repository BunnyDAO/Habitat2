import { Pool } from 'pg';
import { Connection, Keypair } from '@solana/web3.js';
import { createClient } from 'redis';
import { HeliusService } from './helius.service';
import { JobType, WalletMonitoringJob, PriceMonitoringJob, VaultStrategy, LevelsStrategy } from '../types/jobs';
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

  private constructor() {
    this.pool = new Pool();
    this.redisClient = null;
    this.heliusService = new HeliusService();
    this.encryptionService = EncryptionService.getInstance();
    this.priceService = new PriceService();
  }

  public static getInstance(): StrategyExecutorService {
    if (!StrategyExecutorService.instance) {
      StrategyExecutorService.instance = new StrategyExecutorService();
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

  private async executeWalletMonitor(strategy: any, keypair: Keypair) {
    const config = strategy.config as WalletMonitoringJob;
    
    // Get recent transactions for monitored wallet
    const transactions = await this.heliusService.getTransactions(config.walletAddress);
    
    // Filter out already processed transactions
    const newTransactions = transactions.filter(tx => 
      !config.recentTransactions?.includes(tx.signature)
    );
      
    // Process new transactions
    for (const tx of newTransactions) {
      try {
        // Mirror the trade
        await this.mirrorTrade(tx, keypair, config.percentage);
        
        // Update recent transactions list
        await this.updateRecentTransactions(strategy.id, tx.signature);
        
        // Log the mirror trade
        await this.logMirrorTrade(strategy, tx);
    } catch (error) {
        console.error(`Error mirroring trade ${tx.signature}:`, error);
        await this.logError('mirror_trade', error, { 
          strategyId: strategy.id,
          transactionSignature: tx.signature 
        });
      }
    }
  }

  private async executePriceMonitor(strategy: any, keypair: Keypair) {
    const config = strategy.config as PriceMonitoringJob;
    
    // Get current SOL price
    const currentPrice = await this.priceService.getSolPrice();
    
    // Check if price condition is met
    const shouldExecute = config.direction === 'above' 
      ? currentPrice > config.targetPrice
      : currentPrice < config.targetPrice;

    if (shouldExecute) {
      try {
        // Execute the trade
        await this.executePriceBasedTrade(keypair, config);
        
        // Log the trade
        await this.logPriceBasedTrade(strategy, currentPrice);
      } catch (error) {
        console.error(`Error executing price-based trade:`, error);
        await this.logError('price_trade', error, { 
          strategyId: strategy.id,
          currentPrice 
        });
      }
    }
  }

  private async executeVaultStrategy(strategy: any, keypair: Keypair) {
    const config = strategy.config as VaultStrategy;
    
    try {
      // Get current wallet balance
      const balance = await this.getWalletBalance(keypair.publicKey);
      
      // Calculate vault amount
      const vaultAmount = balance * (config.vaultPercentage / 100);
      
      // Execute vault trade if needed
      await this.executeVaultTrade(keypair, vaultAmount);
      
      // Log the vault trade
      await this.logVaultTrade(strategy, vaultAmount);
    } catch (error) {
      console.error(`Error executing vault strategy:`, error);
      await this.logError('vault_trade', error, { strategyId: strategy.id });
    }
  }

  private async executeLevelsStrategy(strategy: any, keypair: Keypair) {
    const config = strategy.config as LevelsStrategy;
    
    // Get current SOL price
    const currentPrice = await this.priceService.getSolPrice();
    
    // Find triggered level
    const triggeredLevel = config.levels.find(level => 
      Math.abs(currentPrice - level.price) < 0.01 // 1 cent threshold
    );

    if (triggeredLevel) {
      try {
        // Execute level-based trade
        await this.executeLevelTrade(keypair, triggeredLevel);
    
        // Log the level trade
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

  private async logError(context: string, error: any, metadata: any = {}) {
    const client = await this.pool.connect();
    try {
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
            message: error.message,
            stack: error.stack
          },
          metadata
        })
      ]);
    } finally {
      client.release();
    }
  }

  // Helper methods for trade execution and logging
  private async mirrorTrade(tx: any, keypair: Keypair, percentage: number) {
    // Implementation for mirroring trades
  }

  private async executePriceBasedTrade(keypair: Keypair, config: PriceMonitoringJob) {
    // Implementation for price-based trades
  }

  private async executeVaultTrade(keypair: Keypair, vaultAmount: number) {
    // Implementation for vault trades
  }

  private async executeLevelTrade(keypair: Keypair, level: any) {
    // Implementation for level-based trades
  }

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

  private async getWalletBalance(publicKey: string): Promise<number> {
    // Implementation for getting wallet balance
    return 0;
  }
} 