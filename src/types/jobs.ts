import { ProfitTracking } from './profit';

export enum JobType {
  WALLET_MONITOR = 'wallet-monitor',
  SAVED_WALLET = 'saved-wallet',
  PRICE_MONITOR = 'price-monitor',
  VAULT = 'vault',
  LEVELS = 'levels',
  PAIR_TRADE = 'pair-trade',
  DRIFT_PERP = 'drift-perp'
}

export interface ProfitSnapshot {
  timestamp: string;
  balance: number;
  price: number;
  profit: number;
}

export interface TradeRecord {
  timestamp: string;
  type: 'buy' | 'sell';
  amount: number;
  price: number;
  profit?: number;
}

export interface BaseJob {
  id: string;
  type: JobType;
  tradingWalletPublicKey: string;
  tradingWalletSecretKey: Uint8Array;
  isActive: boolean;
  lastActivity?: string;
  createdAt: string;
  name?: string;  // Optional name for any job type
  profitTracking: ProfitTracking;
}

// Helper function to ensure secret key is Uint8Array
export function ensureUint8Array(secretKey: number[] | Uint8Array): Uint8Array {
  if (secretKey instanceof Uint8Array) {
    return secretKey;
  }
  return new Uint8Array(secretKey);
}

export interface SavedWalletJob extends BaseJob {
  type: JobType.SAVED_WALLET;
  walletAddress: string;
  name?: string;  // Optional name for the saved wallet
  percentage?: number;  // Optional percentage (for when activated)
}

export interface WalletMonitoringJob extends BaseJob {
  type: JobType.WALLET_MONITOR;
  walletAddress: string;
  name?: string;  // Optional name for the monitored wallet
  percentage: number;  // Percentage of trading wallet's SOL to allocate
  allocatedAmount?: number;  // Amount of SOL allocated for mirroring
  mirroredTokens: {
    [mintAddress: string]: {
      balance: number;      // Current balance of the token
      decimals: number;     // Token decimals
      initialPrice?: number;
      currentPrice?: number;
    };
  };
  recentTransactions?: string[];  // Array of recently processed transaction signatures
}

export interface PriceMonitoringJob extends BaseJob {
  type: JobType.PRICE_MONITOR;
  targetPrice: number;
  direction: 'above' | 'below';
  percentageToSell: number;  // Percentage of SOL to sell when condition is met
  lastTriggerPrice?: number;  // Last price that triggered the job
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

export interface PairTradeJob extends BaseJob {
  type: JobType.PAIR_TRADE;
  tokenAMint: string;
  tokenBMint: string;
  tokenASymbol: string;
  tokenBSymbol: string;
  allocationPercentage: number;
  maxSlippage: number;
  autoRebalance: boolean;
  lastSwapTimestamp?: string;
  swapHistory: Array<{
    timestamp: string;
    fromToken: 'A' | 'B';
    toToken: 'A' | 'B';
    fromAmount: number;
    toAmount: number;
    price: number;
    profit: number;
  }>;
}

export interface DriftPerpPosition {
  timestamp: string;
  marketIndex: number;
  direction: 'long' | 'short';
  baseAssetAmount: number;
  quoteAssetAmount: number;
  entryPrice: number;
  currentPrice: number;
  unrealizedPnl: number;
  leverage: number;
  liquidationPrice: number;
  marginRatio: number;
}

export interface DriftPerpJob extends BaseJob {
  type: JobType.DRIFT_PERP;
  marketSymbol: string;
  marketIndex: number;
  direction: 'long' | 'short';
  allocationPercentage: number;
  entryPrice: number;
  exitPrice: number;
  leverage: number;
  stopLoss?: number;
  takeProfit?: number;
  maxSlippage: number;
  currentPosition?: DriftPerpPosition;
  positionHistory: DriftPerpPosition[];
  orderHistory: Array<{
    timestamp: string;
    type: 'open' | 'close' | 'liquidated';
    direction: 'long' | 'short';
    size: number;
    price: number;
    pnl?: number;
    signature: string;
  }>;
  isPositionOpen: boolean;
  lastActivityTimestamp?: string;
}

export type AnyJob = WalletMonitoringJob | SavedWalletJob | PriceMonitoringJob | VaultStrategy | LevelsStrategy | PairTradeJob | DriftPerpJob; 