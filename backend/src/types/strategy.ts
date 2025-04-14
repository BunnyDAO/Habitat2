export interface StrategyConfig {
  type: 'DCA' | 'GRID';
  parameters: {
    [key: string]: any;
  };
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
    gridSize: number;
    upperPrice: number;
    lowerPrice: number;
    amountPerGrid: number;
  };
}

export interface Strategy {
  id: number;
  tradingWalletId: number;
  mainWalletPubkey: string;
  strategyType: string;
  config: string; // JSON string of StrategyConfig
  isActive: boolean;
  name?: string;
  createdAt: Date;
  updatedAt: Date;
} 