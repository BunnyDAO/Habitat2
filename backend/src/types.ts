export interface TokenBalance {
  mint: string;
  balance: number;
  decimals: number;
  name?: string;
  symbol?: string;
  logoURI?: string;
  uiAmount?: number;
  usdValue?: number;
  lastUpdated?: string;
}

export interface HeliusTokenAccount {
  mint: string;
  amount: string;
  decimals: number;
  name?: string;
  symbol?: string;
  logoURI?: string;
}

export interface HeliusResponse {
  jsonrpc: string;
  id: string;
  result: {
    items: HeliusTokenAccount[];
  };
  error?: {
    message: string;
  };
} 