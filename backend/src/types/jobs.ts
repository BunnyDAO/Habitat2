export enum JobType {
  WALLET_MONITOR = 'wallet-monitor',
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
  vaultPercentage: number; // Must be capped at 5%
  mainWalletPublicKey: string; // User's main connected wallet for vault transfers
}

export interface LevelExecution {
  timestamp: string;
  triggerPrice: number;
  amountTraded: number;       // SOL amount (positive = bought, negative = sold)
  usdcValue: number;          // USDC value of the trade
  signature: string;
  success: boolean;
  errorMessage?: string;
}

export interface Level {
  id: string;
  type: 'limit_buy' | 'stop_loss' | 'take_profit';
  price: number;
  
  // Buy mode specific
  usdcAmount?: number;        // Fixed USDC amount to spend
  
  // Sell mode specific  
  solPercentage?: number;     // Percentage of current SOL holdings to sell
  
  // Execution state
  executed: boolean;
  executedCount: number;      // How many times this level has triggered
  executedAt?: string;        // Last execution timestamp
  cooldownUntil?: string;     // Timestamp when level can retrigger
  permanentlyDisabled: boolean;
  
  // Execution results
  executionHistory: LevelExecution[];
}

export interface ProfitEntry {
  timestamp: string;
  balanceChange: number;
  totalBalance: number;
  triggerLevel?: string;      // Which level caused this change
}

export interface TradeEntry {
  timestamp: string;
  type: 'buy' | 'sell';
  amount: number;             // SOL amount
  price: number;              // SOL price at execution
  usdcValue: number;
  levelId: string;
  profit: number;             // Realized profit/loss
}

export interface LevelsStrategy extends BaseJob {
  type: JobType.LEVELS;
  mode: 'buy' | 'sell';
  
  // Strategy settings
  autoRestartAfterComplete: boolean;
  cooldownHours: number; // Per-level cooldown to prevent spam
  maxRetriggers: number; // Max times a level can execute before permanent disable
  
  // Level management
  levels: Level[];
  
  // Execution tracking
  completedLevels: number;
  totalLevels: number;
  lastExecutionTime?: string;
  strategyStartTime: string;
  lastActivity?: string;
  lastTriggerPrice?: number;
  
  // Performance tracking (extends base with additional fields)
  profitTracking: ProfitTracking & {
    initialUsdcBalance?: number; // For BUY mode
    initialSolBalance?: number;  // For SELL mode
    profitHistory: ProfitEntry[];
    trades: TradeEntry[];
  };
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

export interface DriftPerpPosition {
  timestamp: string;
  marketIndex: number;
  direction: 'long' | 'short';
  baseAssetAmount: number;  // Position size in base asset
  quoteAssetAmount: number; // Position value in quote asset (USDC)
  entryPrice: number;
  currentPrice: number;
  unrealizedPnl: number;
  leverage: number;
  liquidationPrice: number;
  marginRatio: number;
}

export interface DriftPerpJob extends BaseJob {
  type: JobType.DRIFT_PERP;
  marketSymbol: string;         // e.g., "SOL-PERP", "BTC-PERP", "ETH-PERP"
  marketIndex: number;          // Drift market index for the perpetal
  direction: 'long' | 'short';  // Position direction
  allocationPercentage: number; // Percentage of SOL to allocate (1-100)
  entryPrice: number;           // Target entry price
  exitPrice: number;            // Target exit price
  leverage: number;             // Leverage multiplier (1-10x)
  stopLoss?: number;            // Optional stop loss price
  takeProfit?: number;          // Optional take profit price
  maxSlippage: number;          // Max acceptable slippage (default: 1%)
  currentPosition?: DriftPerpPosition; // Current active position
  positionHistory: DriftPerpPosition[]; // Historical positions
  orderHistory: {
    timestamp: string;
    type: 'open' | 'close' | 'liquidated';
    direction: 'long' | 'short';
    size: number;
    price: number;
    pnl?: number;
    signature: string;
  }[];
  isPositionOpen: boolean;      // Whether position is currently active
  lastActivityTimestamp?: string;
}

export interface ProfitTracking {
  initialBalance: number;
  currentBalance: number;
  totalProfit: number;
  profitHistory: ProfitSnapshot[];
  trades: TradeRecord[];
}

export type AnyJob = WalletMonitoringJob | PriceMonitoringJob | VaultStrategy | LevelsStrategy | PairTradeJob | DriftPerpJob; 