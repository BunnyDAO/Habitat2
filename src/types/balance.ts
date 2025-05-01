export interface TokenBalance {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI?: string;
  balance: number;
  uiBalance: number;
  usdValue: number;
  lastUpdated: string;
}

export interface WalletBalance {
  walletAddress: string;
  balances: {
    [mintAddress: string]: TokenBalance;
  };
}

// For future use with WebSocket/SSE updates
export interface BalanceUpdate {
  walletAddress: string;
  mintAddress: string;
  newAmount: number;
  timestamp: number;
}

// Response type from the backend
export interface WalletBalanceResponse {
  walletAddress: string;
  balances: TokenBalance[];
}

export interface WalletBalanceMap {
  [mintAddress: string]: TokenBalance;
}

export interface WalletBalanceUpdate {
  walletAddress: string;
  mintAddress: string;
  amount: number;
  decimals: number;
  lastUpdated: number;
} 