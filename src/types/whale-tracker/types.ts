export interface WhaleWallet {
  address: string;
  tokenHoldings: TokenHolding[];
  lastTradeTimestamp?: number;
  profitableTradesCount?: number;
  totalTradesCount?: number;
  profitabilityRate?: number;
}

export interface TokenHolding {
  mint: string;
  amount: number;
  symbol?: string;
  name?: string;
}

export interface Trade {
  timestamp: number;
  tokenIn: {
    mint: string;
    amount: number;
    symbol?: string;
  };
  tokenOut: {
    mint: string;
    amount: number;
    symbol?: string;
  };
  isProfit?: boolean;
  profitPercentage?: number;
}

export interface WhaleTrackerConfig {
  minTokenAmount: number;
  targetTokenMint: string;
  timeframe: number; // in days
  profitabilityThreshold?: number;
}

export interface WhaleAnalytics {
  address: string;
  profitableTrades: number;
  totalTrades: number;
  profitabilityRate: number;
  averageProfitPercentage: number;
  lastTradeTimestamp: number;
  recentTrades: Trade[];
} 