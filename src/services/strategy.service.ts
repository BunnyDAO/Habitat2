import { Connection, PublicKey } from '@solana/web3.js';
import { strategyApiService } from './api/strategy.service';
import { JobType, WalletMonitoringJob, PriceMonitoringJob, VaultStrategy, LevelsStrategy } from '../types/jobs';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { TradingWallet } from '../types/wallet';
import type { ProfitTracking } from '../types/profit';

// Base Job interface that all strategy types extend
type Job = WalletMonitoringJob | VaultStrategy | LevelsStrategy;

interface BaseStrategyParams {
  tradingWallet: TradingWallet;
  initialBalance: number;
  solPrice: number;
}

interface WalletMonitorParams extends BaseStrategyParams {
  walletAddress: string;
  percentage: number;
}

interface PriceMonitorParams extends BaseStrategyParams {
  targetPrice: number;
  direction: 'above' | 'below';
  percentageToSell: number;
}

interface VaultParams extends BaseStrategyParams {
  vaultPercentage: number;
}

interface LevelsParams extends BaseStrategyParams {
  levels: Array<{ price: number; percentage: number }>;
}

export class StrategyService {
  private static instance: StrategyService;
  private connection: Connection;
  private jobs: Map<string, Job> = new Map();
  private lastJobId = 0;

  private constructor(connection: Connection) {
    this.connection = connection;
  }

  static getInstance(connection: Connection): StrategyService {
    if (!StrategyService.instance) {
      StrategyService.instance = new StrategyService(connection);
    }
    return StrategyService.instance;
  }

  private generateUniqueId(prefix: string): string {
    this.lastJobId++;
    return `${prefix}_${Date.now()}_${this.lastJobId}`;
  }

  private createInitialProfitTracking(initialBalance: number, solPrice: number): ProfitTracking {
    return {
      initialBalance,
      initialValue: initialBalance * solPrice,
      currentBalance: initialBalance,
      currentValue: initialBalance * solPrice,
      totalProfitSOL: 0,
      totalProfitUSD: 0,
      percentageChange: 0,
      lastUpdated: new Date().toISOString()
    };
  }

  private findExistingStrategy(tradingWalletPublicKey: string, type: JobType): Job | undefined {
    return Array.from(this.jobs.values()).find(
      job => job.tradingWalletPublicKey === tradingWalletPublicKey && job.type === type
    );
  }

  private updateExistingJob<T extends Job>(existingJob: T, newConfig: Partial<T>): T {
    const updatedJob = { ...existingJob, ...newConfig, updatedAt: new Date().toISOString() };
    this.jobs.set(existingJob.id, updatedJob);
    return updatedJob;
  }

  async createWalletMonitorStrategy(params: WalletMonitorParams): Promise<WalletMonitoringJob> {
    // Check for existing strategy
    const existingJob = this.findExistingStrategy(params.tradingWallet.publicKey, JobType.WALLET_MONITOR);
    
    if (existingJob && existingJob.type === JobType.WALLET_MONITOR) {
      // Update existing job
      const updatedJob = this.updateExistingJob<WalletMonitoringJob>(existingJob, {
        walletAddress: params.walletAddress,
        percentage: params.percentage,
        isActive: true
      });

      // Update in backend
      await strategyApiService.createStrategy({
        tradingWalletPublicKey: params.tradingWallet.publicKey,
        strategy_type: JobType.WALLET_MONITOR,
        config: {
          walletAddress: params.walletAddress,
          percentage: params.percentage
        }
      });

      return updatedJob;
    }

    // Create new job if none exists
    const newJob: WalletMonitoringJob = {
      id: this.generateUniqueId('wm'),
      type: JobType.WALLET_MONITOR,
      walletAddress: params.walletAddress,
      percentage: params.percentage,
      tradingWalletPublicKey: params.tradingWallet.publicKey,
      tradingWalletSecretKey: params.tradingWallet.secretKey,
      isActive: true,
      createdAt: new Date().toISOString(),
      recentTransactions: [],
      mirroredTokens: {},
      profitTracking: this.createInitialProfitTracking(params.initialBalance, params.solPrice)
    };

    // Save to backend
    await strategyApiService.createStrategy({
      tradingWalletPublicKey: params.tradingWallet.publicKey,
      strategy_type: JobType.WALLET_MONITOR,
      config: {
        walletAddress: params.walletAddress,
        percentage: params.percentage
      }
    });

    this.jobs.set(newJob.id, newJob);
    return newJob;
  }

  async createPriceMonitorStrategy(params: PriceMonitorParams): Promise<PriceMonitoringJob> {
    const newJob: PriceMonitoringJob = {
      id: Date.now().toString(),
      type: JobType.PRICE_MONITOR,
      tradingWalletPublicKey: params.tradingWallet.publicKey,
      tradingWalletSecretKey: params.tradingWallet.secretKey,
      targetPrice: params.targetPrice,
      direction: params.direction,
      percentageToSell: params.percentageToSell,
      isActive: true,
      createdAt: new Date().toISOString(),
      profitTracking: this.createInitialProfitTracking(params.initialBalance, params.solPrice)
    };

    // Save to backend
    await strategyApiService.createStrategy({
      tradingWalletPublicKey: params.tradingWallet.publicKey,
      strategy_type: JobType.PRICE_MONITOR,
      config: {
        targetPrice: params.targetPrice,
        direction: params.direction,
        percentageToSell: params.percentageToSell
      }
    });

    return newJob;
  }

  async createVaultStrategy(params: VaultParams): Promise<VaultStrategy> {
    // Check for existing strategy
    const existingJob = this.findExistingStrategy(params.tradingWallet.publicKey, JobType.VAULT);
    
    if (existingJob && existingJob.type === JobType.VAULT) {
      // Update existing job
      const updatedJob = this.updateExistingJob<VaultStrategy>(existingJob, {
        vaultPercentage: params.vaultPercentage,
        isActive: true
      });

      // Update in backend
      await strategyApiService.createStrategy({
        tradingWalletPublicKey: params.tradingWallet.publicKey,
        strategy_type: JobType.VAULT,
        config: {
          vaultPercentage: params.vaultPercentage
        }
      });

      return updatedJob;
    }

    // Create new job if none exists
    const newJob: VaultStrategy = {
      id: this.generateUniqueId('vault'),
      type: JobType.VAULT,
      tradingWalletPublicKey: params.tradingWallet.publicKey,
      tradingWalletSecretKey: params.tradingWallet.secretKey,
      vaultPercentage: params.vaultPercentage,
      isActive: true,
      createdAt: new Date().toISOString(),
      profitTracking: this.createInitialProfitTracking(params.initialBalance, params.solPrice)
    };

    // Save to backend
    await strategyApiService.createStrategy({
      tradingWalletPublicKey: params.tradingWallet.publicKey,
      strategy_type: JobType.VAULT,
      config: {
        vaultPercentage: params.vaultPercentage
      }
    });

    this.jobs.set(newJob.id, newJob);
    return newJob;
  }

  async createLevelsStrategy(params: LevelsParams): Promise<LevelsStrategy> {
    // Check for existing strategy
    const existingJob = this.findExistingStrategy(params.tradingWallet.publicKey, JobType.LEVELS);
    
    if (existingJob && existingJob.type === JobType.LEVELS) {
      // Update existing job
      const updatedJob = this.updateExistingJob<LevelsStrategy>(existingJob, {
        levels: params.levels,
        isActive: true
      });

      // Update in backend
      await strategyApiService.createStrategy({
        tradingWalletPublicKey: params.tradingWallet.publicKey,
        strategy_type: JobType.LEVELS,
        config: {
          levels: params.levels
        }
      });

      return updatedJob;
    }

    // Create new job if none exists
    const newJob: LevelsStrategy = {
      id: this.generateUniqueId('levels'),
      type: JobType.LEVELS,
      tradingWalletPublicKey: params.tradingWallet.publicKey,
      tradingWalletSecretKey: params.tradingWallet.secretKey,
      levels: params.levels,
      isActive: true,
      createdAt: new Date().toISOString(),
      profitTracking: this.createInitialProfitTracking(params.initialBalance, params.solPrice)
    };

    // Save to backend
    await strategyApiService.createStrategy({
      tradingWalletPublicKey: params.tradingWallet.publicKey,
      strategy_type: JobType.LEVELS,
      config: {
        levels: params.levels
      }
    });

    this.jobs.set(newJob.id, newJob);
    return newJob;
  }
} 