import { createClient } from '@supabase/supabase-js';
import { WalletMonitorWorker } from '../workers/WalletMonitorWorker';
import { PriceMonitorWorker } from '../workers/PriceMonitorWorker';
import { VaultWorker } from '../workers/VaultWorker';
import { LevelsWorker } from '../workers/LevelsWorker';
import { EncryptionService } from '../services/encryption.service';
import dotenv from 'dotenv';

dotenv.config();

const POLL_INTERVAL = 60000; // 1 minute
const HELIUS_ENDPOINT = process.env.HELIUS_RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=dd2b28a0-d00e-44f1-bbda-23c042d7476a';

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

class StrategyDaemon {
  private workers: Map<string, WalletMonitorWorker | PriceMonitorWorker | VaultWorker | LevelsWorker> = new Map();
  private isRunning: boolean = false;
  private appSecret: string;
  private encryptionService: EncryptionService;

  constructor() {
    if (!process.env.APP_SECRET) {
      throw new Error('APP_SECRET environment variable is required');
    }
    this.appSecret = process.env.APP_SECRET;
    this.encryptionService = EncryptionService.getInstance();
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    console.log('Starting strategy daemon...');
    
    try {
      // Initial load of all active strategies
      await this.loadActiveStrategies();

      // Start polling for changes
      while (this.isRunning) {
        try {
          await this.checkForStrategyUpdates();
          await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
        } catch (error) {
          console.error('Error in daemon loop:', error);
          await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL * 2));
        }
      }
    } catch (error) {
      console.error('Fatal error in strategy daemon:', error);
      this.isRunning = false;
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;
    
    console.log('Stopping strategy daemon...');
    this.isRunning = false;

    // Stop all workers
    for (const [id, worker] of this.workers) {
      try {
        await worker.stop();
        console.log(`Stopped worker for strategy ${id}`);
      } catch (error) {
        console.error(`Error stopping worker for strategy ${id}:`, error);
      }
    }

    this.workers.clear();
  }

  private async loadActiveStrategies(): Promise<void> {
    try {
      // Get all active strategies from the database
      const { data: strategies, error } = await supabase
        .from('strategies')
        .select('*')
        .eq('is_active', true);

      if (error) throw error;

      console.log(`Found ${strategies.length} active strategies`);

      // Start workers for each strategy
      for (const strategy of strategies as Record<string, any>[]) {
        await this.startWorkerForStrategy(strategy);
      }
    } catch (error) {
      console.error('Error loading active strategies:', error);
      throw error;
    }
  }

  private async checkForStrategyUpdates(): Promise<void> {
    try {
      // Get all strategies that have been updated since last check
      const { data: strategies, error } = await supabase
        .from('strategies')
        .select('*');

      if (error) throw error;

      for (const strategy of strategies) {
        const existingWorker = this.workers.get(strategy.id);

        if (strategy.is_active) {
          if (!existingWorker) {
            // New active strategy, start worker
            await this.startWorkerForStrategy(strategy as Record<string, any>);
          }
          // Note: We don't update existing workers as they should be stateless
          // If a strategy needs to be updated, it should be stopped and restarted
        } else if (existingWorker) {
          // Strategy is no longer active, stop worker
          await existingWorker.stop();
          this.workers.delete(strategy.id);
          console.log(`Stopped worker for strategy ${strategy.id}`);
        }
      }

      // Clean up workers for deleted strategies
      const strategyIds = new Set(strategies.map(s => s.id));
      for (const [id, worker] of this.workers) {
        if (!strategyIds.has(id)) {
          await worker.stop();
          this.workers.delete(id);
          console.log(`Removed worker for deleted strategy ${id}`);
        }
      }
    } catch (error) {
      console.error('Error checking for strategy updates:', error);
      throw error;
    }
  }

  private async startWorkerForStrategy(strategy: Record<string, any>): Promise<void> {
    try {
      // Debug log to see strategy data
      console.log(`Starting worker for strategy ${strategy.id}:`, {
        type: strategy.strategy_type,
        trading_wallet_id: strategy.trading_wallet_id,
        trading_wallet_public_key: strategy.main_wallet_pubkey
      });

      if (!strategy.strategy_type) {
        console.error(`Skipping strategy ${strategy.id}: Strategy type is undefined`);
        return;
      }

      // Get the encrypted secret key for the trading wallet
      const { data: walletData, error: walletError } = await supabase
        .from('encrypted_wallet_keys')
        .select('session_key_encrypted, wallet_keys_encrypted')
        .eq('trading_wallet_id', strategy.trading_wallet_id)
        .single();

      if (walletError || !walletData) {
        console.error(`Skipping strategy ${strategy.id}: Could not find encrypted key (session_key_encrypted, wallet_keys_encrypted) for trading wallet ${strategy.trading_wallet_id}`);
        return; // Skip this strategy
      }

      // Use the encryption service to decrypt the keys
      const secretKeyString = await this.encryptionService.getWalletPrivateKey(strategy.trading_wallet_id);
      const secretKey = Uint8Array.from(Buffer.from(secretKeyString, 'base64'));

      if (!secretKey || secretKey.length !== 64) {
        console.error(`Error: Invalid secret key for strategy ${strategy.id}. Expected 64 bytes, got ${secretKey ? secretKey.length : 0}`);
        return;
      }

      let worker: WalletMonitorWorker | PriceMonitorWorker | VaultWorker | LevelsWorker;

      switch (strategy.strategy_type) {
        case 'wallet-monitor': {
          const job = {
            id: strategy.id,
            type: 'wallet-monitor',
            tradingWalletPublicKey: strategy.main_wallet_pubkey,
            tradingWalletSecretKey: secretKey,
            isActive: true,
            createdAt: strategy.created_at,
            lastActivity: strategy.last_activity,
            profitTracking: {
              initialBalance: strategy.initial_balance || 0,
              currentBalance: strategy.current_balance || 0,
              totalProfit: strategy.total_profit || 0,
              profitHistory: strategy.profit_history || [],
              trades: strategy.trades || []
            },
            walletAddress: strategy.config?.walletAddress,
            percentage: strategy.config?.percentage,
            mirroredTokens: strategy.mirrored_tokens || {},
            recentTransactions: strategy.recent_transactions || []
          } as import('../types/jobs').WalletMonitoringJob;
          worker = new WalletMonitorWorker(job, HELIUS_ENDPOINT, strategy.main_wallet_pubkey);
          break;
        }
        case 'price-monitor': {
          const job = {
            id: strategy.id,
            type: 'price-monitor',
            tradingWalletPublicKey: strategy.main_wallet_pubkey,
            tradingWalletSecretKey: secretKey,
            isActive: true,
            createdAt: strategy.created_at,
            lastActivity: strategy.last_activity,
            profitTracking: {
              initialBalance: strategy.initial_balance || 0,
              currentBalance: strategy.current_balance || 0,
              totalProfit: strategy.total_profit || 0,
              profitHistory: strategy.profit_history || [],
              trades: strategy.trades || []
            },
            targetPrice: strategy.config?.targetPrice,
            direction: strategy.config?.direction,
            percentageToSell: strategy.config?.percentageToSell,
            lastTriggerPrice: strategy.last_trigger_price,
            triggerHistory: strategy.trigger_history || []
          } as import('../types/jobs').PriceMonitoringJob;
          worker = new PriceMonitorWorker(job, HELIUS_ENDPOINT);
          break;
        }
        case 'vault': {
          const job = {
            id: strategy.id,
            type: 'vault',
            tradingWalletPublicKey: strategy.main_wallet_pubkey,
            tradingWalletSecretKey: secretKey,
            isActive: true,
            createdAt: strategy.created_at,
            lastActivity: strategy.last_activity,
            profitTracking: {
              initialBalance: strategy.initial_balance || 0,
              currentBalance: strategy.current_balance || 0,
              totalProfit: strategy.total_profit || 0,
              profitHistory: strategy.profit_history || [],
              trades: strategy.trades || []
            },
            vaultPercentage: strategy.config?.vaultPercentage
          } as import('../types/jobs').VaultStrategy;
          worker = new VaultWorker(job, HELIUS_ENDPOINT);
          break;
        }
        case 'levels': {
          const job = {
            id: strategy.id,
            type: 'levels',
            tradingWalletPublicKey: strategy.main_wallet_pubkey,
            tradingWalletSecretKey: secretKey,
            isActive: true,
            createdAt: strategy.created_at,
            lastActivity: strategy.last_activity,
            profitTracking: {
              initialBalance: strategy.initial_balance || 0,
              currentBalance: strategy.current_balance || 0,
              totalProfit: strategy.total_profit || 0,
              profitHistory: strategy.profit_history || [],
              trades: strategy.trades || []
            },
            levels: strategy.config?.levels || [],
            lastTriggerPrice: strategy.last_trigger_price
          } as import('../types/jobs').LevelsStrategy;
          worker = new LevelsWorker(job, HELIUS_ENDPOINT);
          break;
        }
        default:
          throw new Error(`Unknown strategy type: ${strategy.strategy_type}`);
      }

      // Start the worker
      await worker.start();
      this.workers.set(strategy.id, worker);
      console.log(`Started worker for strategy ${strategy.id} (${strategy.strategy_type}) [SUCCESS]`);

    } catch (error) {
      console.error(`Error starting worker for strategy ${strategy.id}:`, error);
      throw error;
    }
  }
}

// Create and start the daemon
const daemon = new StrategyDaemon();

// Handle shutdown signals
process.on('SIGINT', async () => {
  console.log('Received SIGINT signal');
  await daemon.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Received SIGTERM signal');
  await daemon.stop();
  process.exit(0);
});

// Start the daemon
daemon.start().catch(error => {
  console.error('Fatal error starting daemon:', error);
  process.exit(1);
}); 