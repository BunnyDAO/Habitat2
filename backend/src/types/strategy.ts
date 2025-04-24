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
}

export interface StrategyConfig {
  type: string;
  parameters: any;
}

export interface DCAConfig extends StrategyConfig {
  type: 'DCA';
  parameters: {
    tokenMint: string;
    amount: number;
    interval: number; // in minutes
    maxPrice?: number;
    minPrice?: number;
  };
}

export interface GridConfig extends StrategyConfig {
  type: 'GRID';
  parameters: {
    tokenMint: string;
    upperPrice: number;
    lowerPrice: number;
    gridSize: number;
    amountPerGrid: number;
  };
}

export type AnyStrategyConfig = DCAConfig | GridConfig; 