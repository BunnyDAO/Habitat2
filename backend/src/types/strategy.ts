export interface Strategy {
  id: number;
  trading_wallet_id: number;
  main_wallet_pubkey: string;
  strategy_type: string;
  config: StrategyConfig;
  is_active: boolean;
  name?: string;
  version: number;
  created_at: string;
  updated_at: string;
  current_wallet_pubkey?: string;
  original_wallet_pubkey?: string;
  position?: number;
  is_lackey?: boolean;
  last_executed?: string | null;
  next_execution?: string | null;
}

export interface StrategyConfig {
  type: string;
  parameters: any;
}

export interface WalletMonitorConfig extends StrategyConfig {
  type: 'wallet-monitor';
  parameters: {
    targetWallet: string;
    percentage: number;
    maxAmount?: number;
    includeTokens?: string[];
    excludeTokens?: string[];
  };
}

export interface PriceMonitorConfig extends StrategyConfig {
  type: 'price-monitor';
  parameters: {
    tokenMint: string;
    buyPrice?: number;
    sellPrice?: number;
    amount: number;
    stopLoss?: number;
    takeProfit?: number;
  };
}

export interface VaultConfig extends StrategyConfig {
  type: 'vault';
  parameters: {
    percentage: number;
    minBalance: number;
    rebalanceFrequency: number; // in hours
    securityLevel: 'low' | 'medium' | 'high';
  };
}

export interface LevelsConfig extends StrategyConfig {
  type: 'levels';
  parameters: {
    tokenMint: string;
    levels: {
      price: number;
      amount: number;
      action: 'buy' | 'sell';
    }[];
    resetOnComplete: boolean;
  };
}

export type AnyStrategyConfig = WalletMonitorConfig | PriceMonitorConfig | VaultConfig | LevelsConfig; 