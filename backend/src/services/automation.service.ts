import { Pool } from 'pg';
import { EncryptionService } from './encryption.service';
import { Connection, Keypair } from '@solana/web3.js';
import { StrategyService } from './strategy.service';

export class AutomationService {
  private static instance: AutomationService;
  private pool: Pool;
  private encryptionService: EncryptionService;
  private strategyService: StrategyService;
  private connection: Connection;
  private isRunning: boolean = false;

  private constructor() {
    this.pool = new Pool();
    this.encryptionService = EncryptionService.getInstance();
    this.strategyService = StrategyService.getInstance();
    this.connection = new Connection(process.env.RPC_ENDPOINT || '');
  }

  public static getInstance(): AutomationService {
    if (!AutomationService.instance) {
      AutomationService.instance = new AutomationService();
    }
    return AutomationService.instance;
  }

  public async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    console.log('Starting automation service...');

    while (this.isRunning) {
      try {
        await this.processActiveStrategies();
        // Wait for 1 minute before next iteration
        await new Promise(resolve => setTimeout(resolve, 60000));
      } catch (error) {
        console.error('Error in automation service:', error);
        // Log error to transactions table
        await this.logError('automation_service', error);
      }
    }
  }

  public stop(): void {
    this.isRunning = false;
    console.log('Stopping automation service...');
  }

  private async processActiveStrategies(): Promise<void> {
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

          // Execute strategy
          const executionResult = await this.strategyService.executeStrategy(
            strategy.id,
            keypair,
            this.connection
          );

          // Log successful execution
          await this.logStrategyExecution(strategy, executionResult);

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

  private async logStrategyExecution(strategy: any, result: any): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(`
        INSERT INTO transactions (
          trading_wallet_id,
          main_wallet_pubkey,
          wallet_pubkey,
          strategy_id,
          signature,
          type,
          amount,
          token_mint,
          timestamp,
          details
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9)
      `, [
        strategy.trading_wallet_id,
        strategy.main_wallet_pubkey,
        strategy.wallet_pubkey,
        strategy.id,
        result.signature || 'strategy_execution',
        'strategy_execution',
        result.amount || 0,
        result.tokenMint || 'system',
        JSON.stringify({
          strategyType: strategy.strategy_type,
          config: strategy.config,
          result: result,
          executionTime: new Date().toISOString()
        })
      ]);
    } finally {
      client.release();
    }
  }

  private async logError(context: string, error: any, metadata: any = {}): Promise<void> {
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
} 