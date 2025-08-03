import { createClient } from '@supabase/supabase-js';
import { Pool } from 'pg';
import { Connection } from '@solana/web3.js';
import { WalletMonitorWorker } from '../workers/WalletMonitorWorker';
import { PriceMonitorWorker } from '../workers/PriceMonitorWorker';
import { VaultWorker } from '../workers/VaultWorker';
import { LevelsWorker } from '../workers/LevelsWorker';
import { PairTradeWorker } from '../workers/PairTradeWorker';
import { DriftPerpWorker } from '../workers/DriftPerpWorker';
import { EncryptionService } from '../services/encryption.service';
import { TokenService } from '../services/TokenService';
import { SwapService } from '../services/swap.service';
import { PriceFeedService } from '../api/v1/services/price-feed.service';
import { HeliusService } from '../services/helius.service';
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
  private workers: Map<string, WalletMonitorWorker | PriceMonitorWorker | VaultWorker | LevelsWorker | PairTradeWorker | DriftPerpWorker> = new Map();
  private isRunning: boolean = false;
  private appSecret: string;
  private encryptionService: EncryptionService;
  private tokenService: TokenService;
  private swapService: SwapService;
  private priceFeedService: PriceFeedService;
  private heliusService: HeliusService;
  private pool: Pool;
  private connection: Connection;

  constructor() {
    if (!process.env.APP_SECRET) {
      throw new Error('APP_SECRET environment variable is required');
    }
    this.appSecret = process.env.APP_SECRET;
    this.encryptionService = EncryptionService.getInstance();
    
    // Initialize database pool
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });
    
    // Initialize connection for services
    this.connection = new Connection(HELIUS_ENDPOINT);
    
    // Initialize HeliusService with API key from environment
    const heliusApiKey = process.env.HELIUS_API_KEY || 'dd2b28a0-d00e-44f1-bbda-23c042d7476a';
    this.heliusService = new HeliusService(heliusApiKey);
    
    // Initialize PriceFeedService
    this.priceFeedService = new PriceFeedService(null, this.heliusService);
    
    // Initialize TokenService
    this.tokenService = new TokenService(this.pool);
    
    // Initialize SwapService
    this.swapService = new SwapService(this.pool, this.connection);
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    console.log('Starting strategy daemon...');
    
    try {
      // Initial load of all active strategies
      await this.loadActiveStrategies();
      console.log('Initial strategy loading completed, starting polling loop...');

      // Start polling for changes
      while (this.isRunning) {
        try {
          console.log('Checking for strategy updates...');
          await this.checkForStrategyUpdates();
          console.log(`Next check in ${POLL_INTERVAL/1000} seconds`);
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
      // Get all active strategies from the database with trading wallet info
      const { data: strategies, error } = await supabase
        .from('strategies')
        .select(`
          *,
          trading_wallets!inner(
            wallet_pubkey,
            name
          )
        `)
        .eq('is_active', true);

      if (error) throw error;

      console.log(`Found ${strategies.length} active strategies`);

      // Start workers for each strategy
      for (const strategy of strategies as Record<string, any>[]) {
        try {
          await this.startWorkerForStrategy(strategy);
        } catch (error) {
          console.error(`Failed to start worker for strategy ${strategy.id}:`, error);
          // Continue with other strategies
        }
      }
      
      console.log(`Successfully loaded ${strategies.length} strategies, ${this.workers.size} workers started`);
    } catch (error) {
      console.error('Error loading active strategies:', error);
      throw error;
    }
    
    console.log('loadActiveStrategies completed, returning to main start() method...');
  }

  private async checkForStrategyUpdates(): Promise<void> {
    try {
      // Get all strategies that have been updated since last check
      const { data: strategies, error } = await supabase
        .from('strategies')
        .select(`
          *,
          trading_wallets!inner(
            wallet_pubkey,
            name
          )
        `);

      if (error) throw error;
      
      console.log(`Found ${strategies.length} total strategies in database`);

      for (const strategy of strategies) {
        const existingWorker = this.workers.get(strategy.id);
        console.log(`Checking strategy ${strategy.id} (${strategy.strategy_type}): is_active=${strategy.is_active}, hasWorker=${!!existingWorker}`);

        if (strategy.is_active) {
          if (!existingWorker) {
            // New active strategy, start worker
            console.log(`Found new active strategy ${strategy.id} (${strategy.strategy_type}), starting worker...`);
            try {
              await this.startWorkerForStrategy(strategy as Record<string, any>);
              console.log(`✅ Successfully started worker for strategy ${strategy.id}`);
            } catch (error) {
              console.error(`❌ Failed to start worker for new strategy ${strategy.id}:`, error);
              // Continue with other strategies
            }
          } else {
            // For Price Monitor strategies, restart the worker if it exists
            // This handles cases where the strategy auto-paused but worker is still in memory
            if (strategy.strategy_type === 'price-monitor') {
              console.log(`Price Monitor strategy ${strategy.id} already has a worker - restarting for fresh state...`);
              try {
                await existingWorker.stop();
                this.workers.delete(strategy.id);
                console.log(`Stopped existing worker for Price Monitor ${strategy.id}`);
                
                await this.startWorkerForStrategy(strategy as Record<string, any>);
                console.log(`✅ Successfully restarted Price Monitor worker for strategy ${strategy.id}`);
              } catch (error) {
                console.error(`❌ Failed to restart Price Monitor worker for strategy ${strategy.id}:`, error);
              }
            } else {
              console.log(`Strategy ${strategy.id} already has a worker running`);
            }
          }
          // Note: We don't update existing workers as they should be stateless
          // If a strategy needs to be updated, it should be stopped and restarted
        } else if (existingWorker) {
          // Strategy is no longer active, stop worker
          console.log(`Strategy ${strategy.id} is no longer active, stopping worker...`);
          await existingWorker.stop();
          this.workers.delete(strategy.id);
          console.log(`Stopped worker for strategy ${strategy.id}`);
        } else {
          console.log(`Strategy ${strategy.id} is inactive and has no worker (correct state)`);
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
      console.log(`Starting worker for strategy ${strategy.id} (${strategy.strategy_type})`);
      
      let secretKeyString: string;
      try {
        secretKeyString = await this.encryptionService.getWalletPrivateKey(strategy.trading_wallet_id);
      } catch (error) {
        console.error(`Error retrieving secret key for strategy ${strategy.id}:`, error);
        return;
      }

      if (!secretKeyString) {
        console.error(`Error: No secret key found for strategy ${strategy.id}`);
        return;
      }
      
      const secretKey = Uint8Array.from(Buffer.from(secretKeyString, 'base64'));

      if (!secretKey || secretKey.length !== 64) {
        console.error(`Error: Invalid secret key for strategy ${strategy.id}. Expected 64 bytes, got ${secretKey ? secretKey.length : 0}`);
        return;
      }
      
      console.log(`Secret key validation passed for strategy ${strategy.id}`)

      let worker: WalletMonitorWorker | PriceMonitorWorker | VaultWorker | LevelsWorker | PairTradeWorker | DriftPerpWorker;

      switch (strategy.strategy_type) {
        case 'wallet-monitor': {
          const job = {
            id: strategy.id,
            type: 'wallet-monitor',
            tradingWalletPublicKey: strategy.trading_wallets?.wallet_pubkey || strategy.current_wallet_pubkey,
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
          worker = new WalletMonitorWorker(job, HELIUS_ENDPOINT, strategy.main_wallet_pubkey, this.swapService);
          break;
        }
        case 'price-monitor': {
          console.log(`Creating PriceMonitorWorker for strategy ${strategy.id}`);
          console.log(`Price Monitor config:`, {
            targetPrice: strategy.config?.targetPrice,
            direction: strategy.config?.direction,
            percentageToSell: strategy.config?.percentageToSell,
            tradingWalletPublicKey: strategy.trading_wallets?.wallet_pubkey || strategy.current_wallet_pubkey
          });
          const job = {
            id: strategy.id,
            type: 'price-monitor',
            tradingWalletPublicKey: strategy.trading_wallets?.wallet_pubkey || strategy.current_wallet_pubkey,
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
            percentageToSell: strategy.config?.percentageToSell
          } as import('../types/jobs').PriceMonitoringJob;
          worker = new PriceMonitorWorker(job, HELIUS_ENDPOINT, this.swapService);
          console.log(`PriceMonitorWorker created for strategy ${strategy.id}, starting...`);
          break;
        }
        case 'vault': {
          console.log(`Creating VaultWorker for strategy ${strategy.id}`);
          const job = {
            id: strategy.id,
            type: 'vault',
            tradingWalletPublicKey: strategy.trading_wallets?.wallet_pubkey || strategy.current_wallet_pubkey,
            tradingWalletSecretKey: secretKey,
            mainWalletPublicKey: strategy.main_wallet_pubkey,
            isActive: true,
            createdAt: strategy.created_at,
            lastActivity: strategy.last_activity,
            vaultPercentage: strategy.config?.vaultPercentage || 5,
            profitTracking: {
              initialBalance: strategy.initial_balance || 0,
              currentBalance: strategy.current_balance || 0,
              totalProfit: strategy.total_profit || 0,
              profitHistory: strategy.profit_history || [],
              trades: strategy.trades || []
            }
          } as import('../types/jobs').VaultStrategy;
          worker = new VaultWorker(job, HELIUS_ENDPOINT);
          break;
        }
        case 'levels': {
          console.log(`Creating LevelsWorker for strategy ${strategy.id}`);
          const job = {
            id: strategy.id,
            type: 'levels',
            tradingWalletPublicKey: strategy.trading_wallets?.wallet_pubkey || strategy.current_wallet_pubkey,
            tradingWalletSecretKey: secretKey,
            isActive: true,
            createdAt: strategy.created_at,
            lastActivity: strategy.last_activity,
            levels: strategy.config?.levels || [],
            profitTracking: {
              initialBalance: strategy.initial_balance || 0,
              currentBalance: strategy.current_balance || 0,
              totalProfit: strategy.total_profit || 0,
              profitHistory: strategy.profit_history || [],
              trades: strategy.trades || []
            }
          } as import('../types/jobs').LevelsStrategy;
          worker = new LevelsWorker(job, HELIUS_ENDPOINT, this.swapService, this.priceFeedService);
          break;
        }
        case 'pair-trade': {
          console.log(`Creating PairTradeWorker for strategy ${strategy.id}`);
          const job = {
            id: strategy.id,
            type: 'pair-trade',
            tradingWalletPublicKey: strategy.trading_wallets?.wallet_pubkey || strategy.current_wallet_pubkey,
            tradingWalletSecretKey: secretKey,
            isActive: true,
            createdAt: strategy.created_at,
            lastActivity: strategy.last_activity,
            tokenAMint: strategy.config?.tokenAMint,
            tokenBMint: strategy.config?.tokenBMint,
            tokenASymbol: strategy.config?.tokenASymbol,
            tokenBSymbol: strategy.config?.tokenBSymbol,
            allocationPercentage: strategy.config?.allocationPercentage || 50,
            maxSlippage: strategy.config?.maxSlippage || 1.0,
            currentToken: strategy.config?.currentToken || 'A',
            swapHistory: strategy.swap_history || [],
            lastSwapTimestamp: strategy.last_swap_timestamp,
            profitTracking: {
              initialBalance: strategy.initial_balance || 0,
              currentBalance: strategy.current_balance || 0,
              totalProfit: strategy.total_profit || 0,
              profitHistory: strategy.profit_history || [],
              trades: strategy.trades || []
            }
          } as import('../types/jobs').PairTradeJob;
          worker = new PairTradeWorker(job, HELIUS_ENDPOINT, this.pool, this.swapService);
          break;
        }
        case 'drift-perp': {
          console.log(`Creating DriftPerpWorker for strategy ${strategy.id}`);
          const job = {
            id: strategy.id,
            type: 'drift-perp',
            tradingWalletPublicKey: strategy.trading_wallets?.wallet_pubkey || strategy.current_wallet_pubkey,
            tradingWalletSecretKey: secretKey,
            isActive: true,
            createdAt: strategy.created_at,
            lastActivity: strategy.last_activity,
            marketSymbol: strategy.config?.marketSymbol || 'SOL-PERP',
            marketIndex: strategy.config?.marketIndex || 0,
            direction: strategy.config?.direction || 'long',
            allocationPercentage: strategy.config?.allocationPercentage || 50,
            entryPrice: strategy.config?.entryPrice,
            exitPrice: strategy.config?.exitPrice,
            leverage: strategy.config?.leverage || 1,
            stopLoss: strategy.config?.stopLoss,
            takeProfit: strategy.config?.takeProfit,
            positionSize: strategy.config?.positionSize || 0,
            entryTimestamp: strategy.config?.entryTimestamp,
            exitTimestamp: strategy.config?.exitTimestamp,
            realizedPnl: strategy.config?.realizedPnl || 0,
            fees: strategy.config?.fees || 0,
            maxSlippage: strategy.config?.maxSlippage || 2.0,
            positionHistory: strategy.config?.positionHistory || [],
            orderHistory: strategy.config?.orderHistory || [],
            isPositionOpen: strategy.config?.isPositionOpen || false,
            profitTracking: {
              initialBalance: strategy.initial_balance || 0,
              currentBalance: strategy.current_balance || 0,
              totalProfit: strategy.total_profit || 0,
              profitHistory: strategy.profit_history || [],
              trades: strategy.trades || []
            }
          } as import('../types/jobs').DriftPerpJob;
          worker = new DriftPerpWorker(job, HELIUS_ENDPOINT, this.tokenService, this.pool);
          break;
        }
        default:
          console.warn(`Unknown strategy type: ${strategy.strategy_type}`);
          return;
      }

      // Start the worker
      console.log(`Attempting to start worker for strategy ${strategy.id}...`);
      await worker.start();
      this.workers.set(strategy.id, worker);
      console.log(`✅ Successfully started ${strategy.strategy_type} worker for strategy ${strategy.id}`);

    } catch (error) {
      console.error(`❌ Failed to start worker for strategy ${strategy.id}:`, error);
      console.error(`Error details:`, error instanceof Error ? (error.stack || error.message) : String(error));
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

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Start the daemon
daemon.start().catch(error => {
  console.error('Fatal error starting daemon:', error);
  process.exit(1);
}); 