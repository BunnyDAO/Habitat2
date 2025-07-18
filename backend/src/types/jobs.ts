export enum JobType {
  WALLET_MONITOR = 'wallet-monitor',
  PRICE_MONITOR = 'price-monitor',
  VAULT = 'vault',
  LEVELS = 'levels',
  PAIR_TRADE = 'pair-trade'
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
  tokenAMint: string;           // First token mint address
  tokenBMint: string;           // Second token mint address
  tokenASymbol: string;         // Display symbol (e.g., "TSLAx")
  tokenBSymbol: string;         // Display symbol (e.g., "wBTC")
  allocationPercentage: number; // Percentage of wallet to use (1-100)
  currentToken: 'A' | 'B';      // Which token currently held
  maxSlippage: number;          // Max slippage for swaps (default: 1%)
  autoRebalance: boolean;       // Future: auto-rebalancing feature
  lastSwapTimestamp?: string;   // Last time a swap occurred
  swapHistory: {
    timestamp: string;
    fromToken: 'A' | 'B';
    toToken: 'A' | 'B';
    fromAmount: number;
    toAmount: number;
    price: number;
    profit: number;
  }[];
}

export interface ProfitTracking {
  initialBalance: number;
  currentBalance: number;
  totalProfit: number;
  profitHistory: ProfitSnapshot[];
  trades: TradeRecord[];
}

export type AnyJob = WalletMonitoringJob | PriceMonitoringJob | VaultStrategy | LevelsStrategy | PairTradeJob; 