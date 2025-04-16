export interface TokenHolding {
  mint: string;
  amount: number;
  symbol?: string;
}

export interface WhaleWallet {
  address: string;
  tokenHoldings: TokenHolding[];
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
  profit?: number;
  profitPercentage?: number;
}

export interface WhaleTrackerConfig {
  minTradeSize?: number;
  minProfitPercentage?: number;
  timeframe?: number;
  includeFailedTrades?: boolean;
}

export interface WhaleAnalytics {
  totalTrades: number;
  profitableTrades: number;
  totalVolume: number;
  averageTradeSize: number;
  winRate: number;
  averageProfitPercentage: number;
  largestTrade: number;
  mostTradedToken: string;
  mostProfitableToken: string;
} 