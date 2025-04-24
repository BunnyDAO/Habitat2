import { Connection, PublicKey } from '@solana/web3.js';
import { strategyApiService } from './api/strategy.service';
import { JobType, WalletMonitoringJob, PriceMonitoringJob, VaultStrategy, LevelsStrategy } from '../types/jobs';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { TradingWallet } from '../types/wallet';
import type { ProfitTracking } from '../types/profit';

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

  private constructor(connection: Connection) {
    this.connection = connection;
  }

  public static getInstance(connection: Connection): StrategyService {
    if (!StrategyService.instance) {
      StrategyService.instance = new StrategyService(connection);
    }
    return StrategyService.instance;
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

  async createWalletMonitorStrategy(params: WalletMonitorParams): Promise<WalletMonitoringJob> {
    const newJob: WalletMonitoringJob = {
      id: Date.now().toString(),
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
    const newJob: VaultStrategy = {
      id: Date.now().toString(),
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

    return newJob;
  }

  async createLevelsStrategy(params: LevelsParams): Promise<LevelsStrategy> {
    const newJob: LevelsStrategy = {
      id: Date.now().toString(),
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

    return newJob;
  }
} 