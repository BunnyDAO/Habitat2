export enum JobType {
  WALLET_MONITOR = 'wallet-monitor',
  PRICE_MONITOR = 'price-monitor',
  VAULT = 'vault',
  LEVELS = 'levels'
}

export interface BaseJob {
  id: string;
  type: JobType;
  tradingWalletPublicKey: string;
  tradingWalletSecretKey: Uint8Array;
  isActive: boolean;
  lastActivity?: string;
  createdAt: string;
  name?: string;
}

export interface WalletMonitoringJob extends BaseJob {
  type: JobType.WALLET_MONITOR;
  walletAddress: string;
  percentage: number;
  mirroredTokens: {
    [mintAddress: string]: {
      balance: number;
      decimals: number;
      initialPrice?: number;
      currentPrice?: number;
    };
  };
  recentTransactions?: string[];
}

export interface PriceMonitoringJob extends BaseJob {
  type: JobType.PRICE_MONITOR;
  targetPrice: number;
  direction: 'above' | 'below';
  percentageToSell: number;
  lastTriggerPrice?: number;
  triggerHistory?: {
    timestamp: string;
    price: number;
    amount: number;
    profit: number;
  }[];
}

export interface VaultStrategy extends BaseJob {
  type: JobType.VAULT;
  vaultPercentage: number;
}

export interface Level {
  price: number;
  percentage: number;
}

export interface LevelsStrategy extends BaseJob {
  type: JobType.LEVELS;
  levels: Level[];
  lastActivity?: string;
  lastTriggerPrice?: number;
}

export type AnyJob = WalletMonitoringJob | PriceMonitoringJob | VaultStrategy | LevelsStrategy; 